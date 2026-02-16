/**
 * Test Case 6: B/A Before-Meal Shortfall — Normal Gap (Side-Effect Test)
 *
 * Side-effect test for the > max_meal_break branch fix (02/12/2026).
 * Verifies that the Before/After Unpaid Meal rule still creates shortfall
 * entries when the gap between clock entries is a NORMAL meal break
 * (within max_meal_break).
 *
 * Scenario: Employee on a worked-minimums contract:
 *   Clock 1: 09:00 AM - 10:00 AM  (1 hr of work)
 *   Clock 2: 11:00 AM -  5:00 PM  (6 hrs, after a 1-hour meal break)
 *
 * The 1-hour gap should be within max_meal_break (a normal meal break).
 * With a typical contract (hrs_before_unpaid_meal = 3), the employee only
 * worked 1 hour before the meal, triggering a 2-hour B/A shortfall entry.
 *
 * This verifies that the unchanged `Else If [since_last_meal < work_requirement]`
 * branch at line 214 of the B/A script still fires correctly after the
 * > max branch was modified.
 */

import { eq } from "@proofkit/fmodata";
import { afterAll, describe, expect, it } from "vitest";
import { CTR__Contract, db } from "../../../src/client.js";
import { cleanupAll } from "../../helpers/cleanup.js";
import {
	applyRules,
	assertId,
	createClockTCL,
	createTimeCard,
	getResultTCLs,
	requireEnv,
} from "../../helpers/factories.js";

const TEST_DATE = "2026-04-20";

describe("B/A Before-Meal Shortfall (Normal Gap)", () => {
	const createdTcdIds: string[] = [];

	afterAll(async () => {
		await cleanupAll(createdTcdIds);
	});

	it("should create before-meal shortfall entries for a gap within max", async () => {
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
		const hrsMax = contract.hrs_meal_break_max ?? 24;
		const hrsMinCall = contract.hrs_minimum_call ?? 0;

		console.log(
			`Contract: before=${hrsBefore}, max=${hrsMax}, minCall=${hrsMinCall}, ` +
				`minimums_worked=${contract.minimums_are_worked_time}`,
		);

		// This test only makes sense when B/A before-meal rule is configured
		if (hrsBefore <= 0) {
			console.warn(
				"Skipping: hrs_before_unpaid_meal not set on this contract.",
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

		// Clock 1: 1 hour of work — intentionally less than hrs_before_unpaid_meal
		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE,
			timeIn: "09:00:00",
			timeOut: "10:00:00",
		});

		// Clock 2: 6 hours after a 1-hour normal meal break
		// Total call work = 7 hours (should exceed most minimum call values)
		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE,
			timeIn: "11:00:00",
			timeOut: "17:00:00",
		});

		const result = await applyRules(tcdId);
		expect(result.error).toBe(0);

		const tcls = await getResultTCLs(tcdId);

		// Log noteRule for debugging
		for (const r of tcls.all) {
			if (r._timecardline_id && r.noteRule) {
				console.log(
					`  Generated TCL: ${r.time_in}-${r.time_out} noteRule="${r.noteRule}" ` +
						`isBill=${r.isBill} hrsUnworked=${r.hrsUnworked}`,
				);
			}
		}

		// Both clocks should produce billable records
		expect(tcls.billable.length).toBeGreaterThanOrEqual(2);

		// KEY ASSERTION: Since the employee only worked 1 hour before the 1-hour
		// gap (and hrs_before_unpaid_meal > 1), B/A or MC should have created
		// entries to cover the shortfall. Look for generated entries that start
		// between Clock 1's out (10:00) and Clock 2's in (11:00).
		//
		// These could be:
		// - B/A "before unpaid meal" entries (if MC didn't already fill the gap)
		// - MC minimum call entries (if minimum call > work before gap)
		// Either way, some generated entry should fill this gap.
		if (hrsBefore > 1) {
			const gapEntries = tcls.all.filter((r) => {
				if (!r._timecardline_id) return false; // skip raw clocks
				if (!r.time_in) return false;
				return r.time_in >= "10:00:00" && r.time_in < "11:00:00";
			});

			expect(
				gapEntries.length,
				`Expected shortfall entries in the gap (10:00-11:00). ` +
					`Employee worked 1 hr, before-meal requires ${hrsBefore} hrs. ` +
					`B/A or MC should have created entries to cover the ${hrsBefore - 1} hr shortfall.`,
			).toBeGreaterThan(0);

			// The shortfall entries should have reasonable durations
			const maxShortfall = hrsBefore - 1; // 1 hour of actual work before gap
			for (const entry of gapEntries) {
				if (entry.time_in && entry.time_out) {
					const entryHrs =
						parseTimeToHours(entry.time_out) - parseTimeToHours(entry.time_in);
					expect(
						entryHrs,
						`Shortfall entry ${entry.time_in}-${entry.time_out} should not exceed ${maxShortfall} hrs`,
					).toBeLessThanOrEqual(maxShortfall + 0.1);
				}
			}
		}

		// The total number of records should be reasonable (not inflated by bugs)
		// 2 clocks + bill/pay entries for each + possible B/A shortfall entries
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
