/**
 * Test Case 5: Night Shift + Meal Break + Evening Return
 *
 * Scenario: Employee works a split day on a worked-minimums contract:
 *   Clock 1: 3:00 AM - 8:00 AM  (5 hrs, starts in night rate period)
 *   Clock 2: 9:00 AM - 9:30 AM  (0.5 hrs, after a 1-hour meal break)
 *   Clock 3: 8:45 PM - 11:45 PM (3 hrs, returns for evening shift)
 *
 * The 1-hour gap (8:00–9:00 AM) is a normal meal break.
 * The 11.25-hour gap (9:30 AM–8:45 PM) far exceeds the max meal break
 * and should be treated as a new call, not an unpaid meal dismissal.
 *
 * Expected correct behavior:
 * - An after-meal shortfall entry at 09:30 is correct: employee worked
 *   0.5 hrs after the meal but the contract requires 2 hrs, so a 1.5 hr
 *   worked entry is created before the new-call reset.
 * - No entries should span deep into the gap (e.g., nothing starting
 *   after ~11:00 AM and before 8:45 PM).
 * - Night rate should split Clock 1 at the contract's night boundary
 *   (e.g., 3:00–6:00 AM night, 6:00–8:00 AM standard).
 * - MC may add a shortfall entry for Call 2 (3 hrs < 5 hr minimum).
 *
 * History: Originally this test asserted zero entries in the 09:30–20:45
 * dead zone. That was correct when the > max branch silently dropped
 * after-meal shortfalls. After the 02/16/2026 fix to flush pending
 * shortfalls at new-call boundaries, the 09:30 entry is legitimate.
 */
import { afterAll, describe, expect, it } from "vitest";
import { cleanupAll } from "../../helpers/cleanup.js";
import {
	applyRules,
	assertId,
	createClockTCL,
	createTimeCard,
	getResultTCLs,
	requireEnv,
} from "../../helpers/factories.js";

const TEST_DATE = "2026-04-13";

describe("Night Shift + Meal Break + Evening Return", () => {
	const createdTcdIds: string[] = [];

	afterAll(async () => {
		await cleanupAll(createdTcdIds);
	});

	it("should not create B/A shortfall entries in the long gap between calls", async () => {
		const contactId = requireEnv("TEST_CONTACT_ID");
		const eventId = requireEnv("TEST_EVENT_ID");
		const contractId = requireEnv("TEST_CONTRACT_ID_WORKED");

		const tcd = await createTimeCard({
			contactId,
			eventId,
			contractId,
			date: TEST_DATE,
		});
		const tcdId = assertId(tcd);
		createdTcdIds.push(tcdId);

		// Clock 1: Night shift — 3:00 AM to 8:00 AM (5 hours)
		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE,
			timeIn: "03:00:00",
			timeOut: "08:00:00",
		});

		// Clock 2: After 1-hour meal break — 9:00 AM to 9:30 AM (0.5 hours)
		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE,
			timeIn: "09:00:00",
			timeOut: "09:30:00",
		});

		// Clock 3: Evening return (new call) — 8:45 PM to 11:45 PM (3 hours)
		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE,
			timeIn: "20:45:00",
			timeOut: "23:45:00",
		});

		const result = await applyRules(tcdId);
		expect(result.error).toBe(0);

		const tcls = await getResultTCLs(tcdId);

		// All 3 Clock lines should produce billable records
		for (const clock of tcls.clock) {
			const hasBillable = tcls.billable.some(
				(r) => r._timecardline_id === clock.__id,
			);
			expect(
				hasBillable,
				`Clock ${clock.time_in}-${clock.time_out} should have bill records`,
			).toBe(true);
		}

		// The after-meal shortfall at 09:30 is legitimate (1.5 hrs worked entry).
		// But no entries should start deep in the gap (after ~12:00 and before 20:45).
		// The old bug created a huge entry spanning the entire 11-hour gap.
		const deepGapEntries = tcls.all.filter((r) => {
			if (!r._timecardline_id) return false;
			if (!r.time_in) return false;
			return r.time_in >= "12:00:00" && r.time_in < "20:45:00";
		});
		expect(
			deepGapEntries,
			"No bill/pay entries should start between 12:00 PM and 8:45 PM (deep gap between calls)",
		).toHaveLength(0);

		// With 8.5 hours of actual clock time and a possible MC shortfall of ~2 hours
		// for Call 2, total billable entries should be reasonable. Night rate and OT
		// splits increase the entry count but not the total hours.
		// The buggy output produces 16 entries; correct should be roughly 6-10.
		expect(tcls.billable.length).toBeLessThanOrEqual(10);
	});
});
