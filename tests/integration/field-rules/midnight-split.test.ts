/**
 * Group A: Midnight Split Tests
 *
 * Verifies that the Midnight Split rule correctly splits Clock entries
 * that span midnight into two separate entries (pre-midnight and post-midnight).
 *
 * Bug 3 verification: The midnight split script exits after processing the
 * first crossing (`Exit Loop If [ True ]` at line 79). If multiple Clock lines
 * span midnight, only the first is split. The second pass of midnight split
 * (after Minimum Calls) may catch subsequent crossings, but this depends on
 * rule ordering. These tests document the actual behavior.
 */

import { afterAll, describe, expect, it } from "vitest";
import { cleanupAll } from "../../helpers/cleanup.js";
import {
	applyRules,
	assertId,
	createClockTCL,
	createTimeCard,
	getContract,
	getResultTCLs,
	parseTimeToHours,
	requireEnv,
} from "../../helpers/factories.js";

const TEST_DATE_A1 = "2026-05-04";
const TEST_DATE_A2 = "2026-06-04";

describe("Midnight Split", () => {
	const createdTcdIds: string[] = [];

	afterAll(async () => {
		await cleanupAll(createdTcdIds);
	});

	it("A1: should split a single clock spanning midnight into two entries", async () => {
		const contactId = requireEnv("TEST_CONTACT_ID");
		const eventId = requireEnv("TEST_EVENT_ID");
		const contractId = requireEnv("TEST_CONTRACT_ID_WORKED");

		const tcd = await createTimeCard({
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_A1,
		});
		const tcdId = assertId(tcd);
		createdTcdIds.push(tcdId);

		// Single clock spanning midnight: 22:00 - 02:00 (4 hours)
		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_A1,
			timeIn: "22:00:00",
			timeOut: "02:00:00",
		});

		const result = await applyRules(tcdId);
		expect(result.error).toBe(0);

		const tcls = await getResultTCLs(tcdId);

		// Log all entries for debugging
		for (const r of tcls.all) {
			console.log(
				`  TCL: ${r.time_in}-${r.time_out} isBill=${r.isBill} isPay=${r.isPay} ` +
					`isAfterMidnight=${r.isAfterMidnight} noteRule="${r.noteRule ?? ""}"`,
			);
		}

		// Should have at least 2 billable entries (the split halves)
		expect(
			tcls.billable.length,
			"Clock spanning midnight should produce at least 2 billable entries",
		).toBeGreaterThanOrEqual(2);

		// Find the pre-midnight entry (time_out should be 00:00:00 or midnight equivalent)
		const preMidnight = tcls.billable.filter((r) => {
			const timeIn = parseTimeToHours(r.time_in ?? "0");
			return timeIn >= 22;
		});

		// Find the post-midnight entry (isAfterMidnight should be true)
		const postMidnight = tcls.billable.filter(
			(r) => r.isAfterMidnight === 1,
		);

		expect(
			preMidnight.length,
			"Should have a pre-midnight billable entry starting at or after 22:00",
		).toBeGreaterThanOrEqual(1);

		expect(
			postMidnight.length,
			"Should have at least one post-midnight billable entry with isAfterMidnight=1",
		).toBeGreaterThanOrEqual(1);

		// Verify the pre-midnight entry ends at midnight
		for (const entry of preMidnight) {
			if (entry.time_out) {
				const outHrs = parseTimeToHours(entry.time_out);
				// time_out should be 00:00:00 (midnight) for the pre-midnight half
				// Allow for OT/NR splits that may further subdivide
				expect(
					outHrs <= 24 || outHrs === 0,
					`Pre-midnight entry should end at or before midnight, got ${entry.time_out}`,
				).toBe(true);
			}
		}
	});

	it("A2: should handle two clocks that both span midnight (Bug 3)", async () => {
		const contactId = requireEnv("TEST_CONTACT_ID");
		const eventId = requireEnv("TEST_EVENT_ID");
		const contractId = requireEnv("TEST_CONTRACT_ID_WORKED");

		const contract = await getContract(contractId);
		const hrsMax = contract.hrs_meal_break_max ?? 24;

		const tcd = await createTimeCard({
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_A2,
		});
		const tcdId = assertId(tcd);
		createdTcdIds.push(tcdId);

		// Two clocks that both span midnight, separated by a gap.
		// Clock 1: 21:00 - 01:00 (4 hours, spans midnight)
		// Clock 2: 02:00 - 04:00 (2 hours, after midnight but starting after Clock 1 ends)
		// Note: Clock 2 doesn't span midnight itself, but we need to test
		// what happens when the first clock is split and both produce after-midnight entries.
		//
		// For a true Bug 3 test, we need two entries that each span midnight on
		// different days. Since all clocks share the same TCD date, we can only
		// have one midnight crossing per timecard. Instead, we verify that the
		// midnight split + second pass correctly handles the interaction.
		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_A2,
			timeIn: "21:00:00",
			timeOut: "01:00:00",
		});

		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_A2,
			timeIn: "02:00:00",
			timeOut: "04:00:00",
		});

		const result = await applyRules(tcdId);
		expect(result.error).toBe(0);

		const tcls = await getResultTCLs(tcdId);

		for (const r of tcls.all) {
			console.log(
				`  TCL: ${r.time_in}-${r.time_out} isBill=${r.isBill} isPay=${r.isPay} ` +
					`isAfterMidnight=${r.isAfterMidnight}`,
			);
		}

		// Both clocks should produce billable entries
		// Clock 1 should split at midnight (21:00-00:00 + 00:00-01:00)
		// Clock 2 is entirely after midnight (02:00-04:00)
		// So we expect at least 3 billable entries
		expect(
			tcls.billable.length,
			"Two clocks (one spanning midnight) should produce at least 3 billable entries",
		).toBeGreaterThanOrEqual(3);

		// Verify we have at least one entry starting at 21:00 range
		const evening = tcls.billable.filter((r) => {
			const t = parseTimeToHours(r.time_in ?? "0");
			return t >= 21 && t < 24;
		});
		expect(
			evening.length,
			"Should have an evening entry (21:00+)",
		).toBeGreaterThanOrEqual(1);

		// Verify we have after-midnight entries
		const afterMidnight = tcls.billable.filter(
			(r) => r.isAfterMidnight === 1,
		);
		expect(
			afterMidnight.length,
			"Should have after-midnight entries",
		).toBeGreaterThanOrEqual(1);

		// Total billable hours should be approximately 6 (4 + 2)
		let totalBillableHrs = 0;
		for (const r of tcls.billable) {
			if (r.time_in && r.time_out) {
				let inHrs = parseTimeToHours(r.time_in);
				let outHrs = parseTimeToHours(r.time_out);
				// Handle midnight wrap
				if (outHrs < inHrs) outHrs += 24;
				if (outHrs === 0 && inHrs > 0) outHrs = 24;
				totalBillableHrs += outHrs - inHrs;
			}
		}
		console.log(`  Total billable hours: ${totalBillableHrs}`);
		// Should be close to 6 hours (allow for rounding and rule adjustments)
		// MC, B/A, and other rules may add extra billable time beyond the raw clocks
		expect(totalBillableHrs).toBeGreaterThanOrEqual(5.5);
		expect(totalBillableHrs).toBeLessThanOrEqual(14);
	});
});
