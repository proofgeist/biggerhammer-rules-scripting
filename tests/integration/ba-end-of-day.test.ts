/**
 * Test Case 7: B/A After-Meal Shortfall at End of Day (Side-Effect Test)
 *
 * Side-effect test for the > max_meal_break branch fix (02/12/2026).
 * Verifies that Part 3 of the B/A script ("After Unpaid Meal" rule)
 * still fires correctly at the end of the time card.
 *
 * Scenario: Employee on a worked-minimums contract:
 *   Clock 1: 09:00 AM - 02:00 PM  (5 hrs of work — enough to satisfy before-meal)
 *   Clock 2: 03:00 PM - 03:30 PM  (0.5 hrs, after a 1-hour meal break)
 *
 * The employee worked enough BEFORE the meal (5 hrs >= hrs_before_unpaid_meal),
 * so B/A Part 2 should NOT fire for before-meal shortfall.
 *
 * But the employee only worked 0.5 hours AFTER the meal. If
 * hrs_after_unpaid_meal > 0.5 (typical value is 2), Part 3 should create
 * an "after unpaid meal" shortfall entry at the end of the time card.
 *
 * This verifies that Part 3 (lines 339-368) still works correctly after
 * the > max branch was modified. The bucket values ($meal_counter,
 * $since_unpaid_meal) that Part 3 depends on must be set correctly during
 * the Part 2 loop for Part 3 to fire.
 */

import { eq } from "@proofkit/fmodata";
import { afterAll, describe, expect, it } from "vitest";
import { CTR__Contract, db } from "../../src/client.js";
import { cleanupAll } from "../helpers/cleanup.js";
import {
	applyRules,
	assertId,
	createClockTCL,
	createTimeCard,
	getResultTCLs,
	requireEnv,
} from "../helpers/factories.js";

const TEST_DATE = "2026-04-27";

describe("B/A After-Meal Shortfall at End of Day", () => {
	const createdTcdIds: string[] = [];

	afterAll(async () => {
		await cleanupAll(createdTcdIds);
	});

	it("should create after-meal shortfall entries when employee works little after meal", async () => {
		const contactId = requireEnv("TEST_CONTACT_ID");
		const eventId = requireEnv("TEST_EVENT_ID");
		const contractId = requireEnv("TEST_CONTRACT_ID_WORKED");

		// Read contract to understand rule values
		const contractResult = await db
			.from(CTR__Contract)
			.list()
			.where(eq(CTR__Contract.__id, contractId))
			.execute();

		if (contractResult.error) {
			throw new Error(`Failed to read contract: ${contractResult.error}`);
		}
		const contract = contractResult.data[0];

		const hrsBefore = contract.hrs_before_unpaid_meal ?? 0;
		const hrsAfter = contract.hrs_after_unpaid_meal ?? 0;
		const hrsMax = contract.hrs_meal_break_max ?? 24;
		const hrsMinCall = contract.hrs_minimum_call ?? 0;

		console.log(
			`Contract: before=${hrsBefore}, after=${hrsAfter}, max=${hrsMax}, ` +
				`minCall=${hrsMinCall}, minimums_worked=${contract.minimums_are_worked_time}`,
		);

		// This test requires the after-unpaid-meal rule to be configured
		if (hrsAfter <= 0) {
			console.warn("Skipping: hrs_after_unpaid_meal not set on this contract.");
			return;
		}

		// The after-meal rule must require more than 0.5 hours (our Clock 2 duration)
		if (hrsAfter <= 0.5) {
			console.warn(
				`Skipping: hrs_after_unpaid_meal (${hrsAfter}) <= 0.5. ` +
					`Employee's 0.5 hr post-meal work would satisfy the rule.`,
			);
			return;
		}

		// The 1-hour gap must be within max_meal_break
		if (1.0 >= hrsMax) {
			console.warn(
				`Skipping: 1-hour gap >= max_meal_break (${hrsMax}). ` +
					`Cannot test normal gap handling.`,
			);
			return;
		}

		const tcd = await createTimeCard({
			contactId,
			eventId,
			contractId,
			date: TEST_DATE,
		});
		const tcdId = assertId(tcd);
		createdTcdIds.push(tcdId);

		// Clock 1: 5 hours — enough to satisfy hrs_before_unpaid_meal
		// (so Part 2 doesn't fire for before-meal shortfall)
		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE,
			timeIn: "09:00:00",
			timeOut: "14:00:00",
		});

		// Clock 2: 0.5 hours after a 1-hour normal meal break
		// (less than hrs_after_unpaid_meal, triggering Part 3)
		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE,
			timeIn: "15:00:00",
			timeOut: "15:30:00",
		});

		const result = await applyRules(tcdId);
		expect(result.error).toBe(0);

		const tcls = await getResultTCLs(tcdId);

		// Log noteRule for debugging
		for (const r of tcls.all) {
			if (r._timecardline_id && r.noteRule) {
				console.log(
					`  Generated TCL: ${r.time_in}-${r.time_out} noteRule="${r.noteRule}" ` +
						`isBill=${r.isBill} isPay=${r.isPay} hrsUnworked=${r.hrsUnworked}`,
				);
			}
		}

		// Both clocks should produce billable records
		expect(tcls.billable.length).toBeGreaterThanOrEqual(2);

		// KEY ASSERTION: Part 3 should create "after unpaid meal" entries.
		// These entries start at Clock 2's out (15:30) and extend for the shortfall.
		// The shortfall = hrs_after_unpaid_meal - 0.5 (actual work after meal).
		const afterMealEntries = tcls.all.filter((r) => {
			if (!r._timecardline_id) return false; // skip raw clocks
			if (!r.time_in) return false;
			// After-meal entries start at or after Clock 2's out time
			return r.time_in >= "15:30:00";
		});

		const expectedShortfall = hrsAfter - 0.5;

		expect(
			afterMealEntries.length,
			`Expected after-meal shortfall entries starting at 15:30. ` +
				`Employee worked 0.5 hr after meal, rule requires ${hrsAfter} hrs. ` +
				`Shortfall of ${expectedShortfall} hrs should generate entries.`,
		).toBeGreaterThan(0);

		// The after-meal entries should have reasonable durations
		for (const entry of afterMealEntries) {
			if (entry.time_in && entry.time_out) {
				const entryHrs =
					parseTimeToHours(entry.time_out) - parseTimeToHours(entry.time_in);
				// After-meal shortfall should not exceed the full rule value
				expect(
					entryHrs,
					`After-meal entry ${entry.time_in}-${entry.time_out} should not exceed ${hrsAfter} hrs`,
				).toBeLessThanOrEqual(hrsAfter + 0.1);
			}
		}

		// The total number of records should be reasonable
		// 2 clocks + bill/pay entries for each + after-meal shortfall entries
		expect(tcls.all.length).toBeLessThanOrEqual(16);
	});
});

function parseTimeToHours(time: string): number {
	const parts = time.split(":");
	return (
		parseInt(parts[0], 10) +
		parseInt(parts[1], 10) / 60 +
		parseInt(parts[2] ?? "0", 10) / 3600
	);
}
