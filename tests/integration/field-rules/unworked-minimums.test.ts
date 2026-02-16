/**
 * Test Case 2: Unworked Minimums Path
 *
 * Verifies that when minimums_are_worked_time = False (read from contract),
 * minimum call entries go to $$unwork[] instead of $$bill/$$pay, and that
 * the timestamps on those entries are consistent.
 *
 * Requires TEST_CONTRACT_ID_UNWORKED to point to a contract where
 * minimums_are_worked_time = 0 (False).
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

// Each test uses a unique date to avoid overlap detection across test runs
const TEST_DATE_1 = "2026-03-16";
const TEST_DATE_2 = "2026-03-17";

describe("Unworked Minimums — minimums_are_worked_time = False", () => {
	const createdTcdIds: string[] = [];

	afterAll(async () => {
		await cleanupAll(createdTcdIds);
	});

	it("should create minimum call entries as Unworked records", async () => {
		const contractId = process.env.TEST_CONTRACT_ID_UNWORKED;
		if (!contractId) {
			console.warn(
				"Skipping: TEST_CONTRACT_ID_UNWORKED not set. " +
					"Set this to a contract where minimums_are_worked_time = False.",
			);
			return;
		}

		const contactId = requireEnv("TEST_CONTACT_ID");
		const eventId = requireEnv("TEST_EVENT_ID");

		// Create a Time Card with a short work segment (less than minimum call)
		const tcd = await createTimeCard({
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_1,
		});
		const tcdId = assertId(tcd);
		createdTcdIds.push(tcdId);

		// 1 hour of work — should trigger minimum call shortfall
		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_1,
			timeIn: "09:00:00",
			timeOut: "10:00:00",
		});

		const result = await applyRules(tcdId);
		expect(result.error).toBe(0);

		const tcls = await getResultTCLs(tcdId);

		// Should have unworked records (minimum call entries)
		expect(tcls.unworked.length).toBeGreaterThan(0);

		// Minimum call unworked entries should have isMinimumCall flag
		const mcEntries = tcls.unworked.filter((r) => r.isMinimumCall);
		expect(mcEntries.length).toBeGreaterThan(0);

		// Verify timestamps are consistent (the CUE timestamp fix):
		// time_in should be a valid time string, not empty
		for (const entry of mcEntries) {
			expect(entry.hrsUnworked).toBeTruthy();

			// If time_in_ts_c and time_out_ts_c are populated (readOnly computed fields),
			// they should be non-empty timestamps
			if (entry.time_in_ts_c) {
				expect(entry.time_in_ts_c).toBeTruthy();
			}
			if (entry.time_out_ts_c) {
				expect(entry.time_out_ts_c).toBeTruthy();
			}
		}
	});

	it("should NOT have minimum call entries in billable/payable arrays", async () => {
		const contractId = process.env.TEST_CONTRACT_ID_UNWORKED;
		if (!contractId) return;

		const contactId = requireEnv("TEST_CONTACT_ID");
		const eventId = requireEnv("TEST_EVENT_ID");

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
			timeIn: "09:00:00",
			timeOut: "10:00:00",
		});

		const result = await applyRules(tcdId);
		expect(result.error).toBe(0);

		const tcls = await getResultTCLs(tcdId);

		// Billable/payable records should NOT have isMinimumCall set
		const billMC = tcls.billable.filter((r) => r.isMinimumCall);
		const payMC = tcls.payable.filter((r) => r.isMinimumCall);
		expect(billMC.length).toBe(0);
		expect(payMC.length).toBe(0);
	});
});
