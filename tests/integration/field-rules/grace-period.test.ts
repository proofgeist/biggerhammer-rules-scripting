/**
 * Group O: Grace Period Tests
 *
 * Verifies that the grace period feature (mins_grace_period on the contract)
 * is handled correctly by the rules engine. Grace period allows small overages
 * at shift start/end to be absorbed without generating additional adjustments.
 *
 * Tests read `mins_grace_period` from the contract at runtime and skip if
 * the value is 0 or not configured.
 *
 * O1: Discovery/documentation test — clock with slight overages on both ends
 * O2: Exact boundary clock — no grace adjustment should be needed
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
	requireEnv,
} from "../../helpers/factories.js";

const TEST_DATE_O1 = "2027-11-01";
const TEST_DATE_O2 = "2027-11-02";

describe("Grace Period", () => {
	const createdTcdIds: string[] = [];

	afterAll(async () => {
		await cleanupAll(createdTcdIds);
	});

	it("O1: grace period behavior with slight overages on both ends", async () => {
		const contactId = requireEnv("TEST_CONTACT_ID");
		const eventId = requireEnv("TEST_EVENT_ID");
		const contractId = requireEnv("TEST_CONTRACT_ID_WORKED");

		const contract = await getContract(contractId);
		const minsGrace = contract.mins_grace_period ?? 0;

		console.log(`Contract: mins_grace_period=${minsGrace}`);

		if (!minsGrace || minsGrace === 0) {
			console.warn(
				"Skipping O1: mins_grace_period is 0 or not configured on this contract.",
			);
			return;
		}

		// Create a clock from 07:54 to 16:06 — a shift with slight overages
		// on both ends relative to a typical 08:00-16:00 schedule.
		const tcd = await createTimeCard({
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_O1,
		});
		const tcdId = assertId(tcd);
		createdTcdIds.push(tcdId);

		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_O1,
			timeIn: "07:54:00",
			timeOut: "16:06:00",
		});

		const result = await applyRules(tcdId);
		expect(result.error).toBe(0);

		const tcls = await getResultTCLs(tcdId);

		// Log all entries with their time_in/time_out and noteGracePeriod for diagnostics
		for (const r of tcls.billable) {
			console.log(
				`  Bill: ${r.time_in}-${r.time_out} noteGracePeriod="${r.noteGracePeriod ?? ""}" ` +
					`isBill=${r.isBill} _timecardline_id=${r._timecardline_id}`,
			);
		}
		for (const r of tcls.payable) {
			console.log(
				`  Pay:  ${r.time_in}-${r.time_out} noteGracePeriod="${r.noteGracePeriod ?? ""}" ` +
					`isPay=${r.isPay} _timecardline_id=${r._timecardline_id}`,
			);
		}

		// Primary assertion: the engine does not crash
		expect(result.error).toBe(0);

		// Secondary assertion: billable entries are produced
		expect(
			tcls.billable.length,
			"Clock 07:54-16:06 should produce at least one billable entry",
		).toBeGreaterThanOrEqual(1);
	});

	it("O2: no grace adjustment when clock is exactly on boundaries", async () => {
		const contactId = requireEnv("TEST_CONTACT_ID");
		const eventId = requireEnv("TEST_EVENT_ID");
		const contractId = requireEnv("TEST_CONTRACT_ID_WORKED");

		const contract = await getContract(contractId);
		const minsGrace = contract.mins_grace_period ?? 0;

		console.log(`Contract: mins_grace_period=${minsGrace}`);

		if (!minsGrace || minsGrace === 0) {
			console.warn(
				"Skipping O2: mins_grace_period is 0 or not configured on this contract.",
			);
			return;
		}

		// Create a clock from exactly 08:00 to 16:00 — no overage, so grace
		// period should not need to adjust anything.
		const tcd = await createTimeCard({
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_O2,
		});
		const tcdId = assertId(tcd);
		createdTcdIds.push(tcdId);

		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_O2,
			timeIn: "08:00:00",
			timeOut: "16:00:00",
		});

		const result = await applyRules(tcdId);
		expect(result.error).toBe(0);

		const tcls = await getResultTCLs(tcdId);

		// Billable entries should be produced
		expect(
			tcls.billable.length,
			"Clock 08:00-16:00 should produce at least one billable entry",
		).toBeGreaterThanOrEqual(1);

		// noteGracePeriod should be empty/falsy on all entries since no
		// adjustment was needed.
		for (const r of tcls.billable) {
			console.log(
				`  Bill: ${r.time_in}-${r.time_out} noteGracePeriod="${r.noteGracePeriod ?? ""}"`,
			);
			expect(
				r.noteGracePeriod,
				`Billable entry ${r.time_in}-${r.time_out} should have no grace period note ` +
					`when clock is exactly on boundaries`,
			).toBeFalsy();
		}

		for (const r of tcls.payable) {
			console.log(
				`  Pay:  ${r.time_in}-${r.time_out} noteGracePeriod="${r.noteGracePeriod ?? ""}"`,
			);
			expect(
				r.noteGracePeriod,
				`Payable entry ${r.time_in}-${r.time_out} should have no grace period note ` +
					`when clock is exactly on boundaries`,
			).toBeFalsy();
		}
	});
});
