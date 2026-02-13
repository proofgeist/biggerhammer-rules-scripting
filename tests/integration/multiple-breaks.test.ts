/**
 * Test Case 1: Multiple Breaks — Root Cause Fix
 *
 * Verifies that the stale $tcl_loop / $record_count fix in Before/After Unpaid
 * Meal correctly processes all Clock lines on a time card with 3+ breaks.
 *
 * Uses a contract where minimums_are_worked_time = True (the "worked" path).
 */
import { afterAll, describe, expect, it } from "vitest";
import { cleanupAll } from "../helpers/cleanup.js";
import {
	applyRules,
	assertId,
	createClockTCL,
	createTimeCard,
	getResultTCLs,
	requireEnv,
} from "../helpers/factories.js";

// Each test uses a unique date to avoid overlap detection across test runs
const TEST_DATE_1 = "2026-03-02";
const TEST_DATE_2 = "2026-03-03";

describe("Multiple Breaks — Root Cause Fix", () => {
	const createdTcdIds: string[] = [];

	afterAll(async () => {
		await cleanupAll(createdTcdIds);
	});

	it("should process all 3 Clock lines without skipping the last one", async () => {
		const contactId = requireEnv("TEST_CONTACT_ID");
		const eventId = requireEnv("TEST_EVENT_ID");
		const contractId = requireEnv("TEST_CONTRACT_ID_WORKED");

		// 1. Create a Time Card
		const tcd = await createTimeCard({
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_1,
		});
		const tcdId = assertId(tcd);
		createdTcdIds.push(tcdId);

		// 2. Create 3 Clock lines with gaps (simulating breaks)
		//    3:00 AM - 8:00 AM  (5 hours)
		//    9:00 AM - 9:30 AM  (0.5 hours, 1 hour break before)
		//    8:45 PM - 11:45 PM (3 hours, long break before)
		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_1,
			timeIn: "03:00:00",
			timeOut: "08:00:00",
		});
		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_1,
			timeIn: "09:00:00",
			timeOut: "09:30:00",
		});
		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_1,
			timeIn: "20:45:00",
			timeOut: "23:45:00",
		});

		// 3. Apply rules
		const result = await applyRules(tcdId);
		expect(result.error).toBe(0);

		// 4. Fetch and verify results
		const tcls = await getResultTCLs(tcdId);

		// Should have 3 Clock records
		expect(tcls.clock.length).toBe(3);

		// Should have at least 3 billable records (one per Clock line, possibly more
		// from before/after unpaid meal adjustments or minimum call entries)
		expect(tcls.billable.length).toBeGreaterThanOrEqual(3);

		// The last Clock line (20:45 - 23:45) must have produced a billable record.
		// This is the record that was being skipped by the stale counter bug.
		const lastClockBillable = tcls.billable.find(
			(r) => r.time_in === "20:45:00" || r.time_out === "23:45:00",
		);
		expect(lastClockBillable).toBeDefined();
	});

	it("should also produce payable records for all Clock lines", async () => {
		const contactId = requireEnv("TEST_CONTACT_ID");
		const eventId = requireEnv("TEST_EVENT_ID");
		const contractId = requireEnv("TEST_CONTRACT_ID_WORKED");

		const tcd = await createTimeCard({
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_2,
		});
		const tcdId = assertId(tcd);
		createdTcdIds.push(tcdId);

		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_2,
			timeIn: "03:00:00",
			timeOut: "08:00:00",
		});
		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_2,
			timeIn: "09:00:00",
			timeOut: "09:30:00",
		});
		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_2,
			timeIn: "20:45:00",
			timeOut: "23:45:00",
		});

		const result = await applyRules(tcdId);
		expect(result.error).toBe(0);

		const tcls = await getResultTCLs(tcdId);

		expect(tcls.payable.length).toBeGreaterThanOrEqual(3);

		const lastClockPayable = tcls.payable.find(
			(r) => r.time_in === "20:45:00" || r.time_out === "23:45:00",
		);
		expect(lastClockPayable).toBeDefined();
	});
});
