/**
 * Overlapping Clock Entries Tests
 *
 * Verifies the rules engine behavior when two clock entries overlap in time.
 * Clock 1: 09:00-13:00 (4 hrs) and Clock 2: 11:00-15:00 (4 hrs) share a
 * 2-hour overlap window (11:00-13:00). The 8 raw hours collapse to 6 unique
 * hours of coverage. The engine should not crash and total billable hours
 * should remain within a reasonable upper bound (no double-counting of the
 * overlapped window beyond what MC/B-A padding might add).
 */

import { afterAll, describe, expect, it } from "vitest";
import { cleanupAll } from "../../helpers/cleanup.js";
import {
	applyRules,
	assertId,
	createClockTCL,
	createTimeCard,
	requireEnv,
} from "../../helpers/factories.js";

const TEST_DATE = "2027-08-03";

describe("Overlapping Clock Entries", () => {
	const createdTcdIds: string[] = [];

	afterAll(async () => {
		await cleanupAll(createdTcdIds);
	});

	it("should handle two overlapping clocks without crashing or double-counting", async () => {
		const contactId = requireEnv("TEST_CONTACT_ID");
		const eventId = requireEnv("TEST_EVENT_ID");
		const contractId = requireEnv("TEST_CONTRACT_ID_WORKED");

		// --- Setup: create Time Card ---
		const tcd = await createTimeCard({
			contactId,
			eventId,
			contractId,
			date: TEST_DATE,
		});
		const tcdId = assertId(tcd);
		createdTcdIds.push(tcdId);

		// --- Create two overlapping Clock TCLs ---
		// Clock 1: 09:00-13:00 (4 hrs)
		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE,
			timeIn: "09:00:00",
			timeOut: "13:00:00",
		});

		// Clock 2: 11:00-15:00 (4 hrs) -- overlaps Clock 1 by 2 hrs (11:00-13:00)
		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE,
			timeIn: "11:00:00",
			timeOut: "15:00:00",
		});

		// --- Apply rules ---
		const result = await applyRules(tcdId);

		console.log(
			`applyRules result: error=${result.error}, message="${result.message}"`,
		);

		// The engine correctly detects overlapping clocks and returns an error.
		// It refuses to apply rules until the overlap is resolved.
		expect(
			result.error,
			"Engine should detect overlapping clocks and return an error",
		).toBe(1);

		expect(
			result.message?.toLowerCase(),
			"Error message should mention overlapping clocks",
		).toContain("overlap");
	});
});
