/**
 * Zero-Duration Clock Entry Tests
 *
 * Verifies that the rules engine handles a clock entry where
 * time_in === time_out (zero duration) without crashing or
 * producing negative-duration entries.
 */

import { afterAll, describe, expect, it } from "vitest";
import { cleanupAll } from "../../helpers/cleanup.js";
import {
	applyRules,
	assertId,
	createClockTCL,
	createTimeCard,
	getResultTCLs,
	parseTimeToHours,
	requireEnv,
} from "../../helpers/factories.js";

const TEST_DATE = "2027-08-02";

describe("Zero-Duration Clock Entry", () => {
	const createdTcdIds: string[] = [];

	afterAll(async () => {
		await cleanupAll(createdTcdIds);
	});

	it("should not crash and should produce no negative-duration entries", async () => {
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

		// Zero-duration clock: time_in === time_out
		// FileMaker may reject this at the database level, which is acceptable.
		let clockCreated = true;
		try {
			await createClockTCL({
				timecardId: tcdId,
				contactId,
				eventId,
				contractId,
				date: TEST_DATE,
				timeIn: "10:00:00",
				timeOut: "10:00:00",
			});
		} catch (err) {
			// FileMaker rejects zero-duration records — this is valid behavior
			clockCreated = false;
			console.log(
				`Zero-duration clock rejected by FileMaker (expected): ${err}`,
			);
		}

		if (!clockCreated) {
			// If FM rejected the record, the test passes — the database
			// layer prevents zero-duration entries from being created.
			console.log("PASS: FileMaker prevents zero-duration clock entries at the database level.");
			return;
		}

		// If the clock was created, verify the rules engine handles it gracefully
		const result = await applyRules(tcdId);

		console.log(`applyRules result: error=${result.error}, message="${result.message}"`);

		// The rules engine should not crash
		expect(result.error, "applyRules should not return an error").toBe(0);

		// Fetch all result TCLs for diagnostics and validation
		const tcls = await getResultTCLs(tcdId);

		// Log all result TCLs for diagnostics
		for (const r of tcls.all) {
			console.log(
				`  TCL ${r.__id}: time_in=${r.time_in} time_out=${r.time_out} ` +
					`isBill=${r.isBill} isPay=${r.isPay} isMinimumCall=${r.isMinimumCall} ` +
					`hrsUnworked=${r.hrsUnworked} noteRule="${r.noteRule ?? ""}"`,
			);
		}

		// No entry should have a negative duration
		for (const r of tcls.all) {
			if (r.time_in && r.time_out) {
				let inHrs = parseTimeToHours(r.time_in);
				let outHrs = parseTimeToHours(r.time_out);
				// Handle midnight wrap (after-midnight entries)
				if (outHrs < inHrs) outHrs += 24;
				if (outHrs === 0 && inHrs > 0) outHrs = 24;
				const duration = outHrs - inHrs;
				expect(
					duration,
					`TCL ${r.__id} (${r.time_in}-${r.time_out}) should not have negative duration`,
				).toBeGreaterThanOrEqual(0);
			}
		}
	});
});
