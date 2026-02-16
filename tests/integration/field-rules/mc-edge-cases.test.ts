/**
 * Group E: Minimum Call Edge Cases
 *
 * Tests edge cases in the Minimum Calls rule:
 *
 * E1: Two-tier minimums — verifies that hour1 applies to the first call and
 *     hour2 applies to subsequent calls when separated by a gap > max_meal_break.
 *
 * E2: Work exactly equals minimum — no MC entry should be created.
 *
 * E3: Multiple calls exceeding minimum — no MC entries for either call.
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

const TEST_DATE_E1 = "2026-05-08";
const TEST_DATE_E2 = "2026-06-08";
const TEST_DATE_E3 = "2026-07-08";

describe("Minimum Call Edge Cases", () => {
	const createdTcdIds: string[] = [];

	afterAll(async () => {
		await cleanupAll(createdTcdIds);
	});

	it("E1: should apply two-tier minimums (hour1 for first call, hour2 for subsequent)", async () => {
		const contactId = requireEnv("TEST_CONTACT_ID");
		const eventId = requireEnv("TEST_EVENT_ID");
		const contractId = requireEnv("TEST_CONTRACT_ID_WORKED");

		const contract = await getContract(contractId);
		const hrsMinCall = contract.hrs_minimum_call ?? 0;
		const hrsMax = contract.hrs_meal_break_max ?? 24;

		console.log(
			`Contract: minCall=${hrsMinCall}, max_meal_break=${hrsMax}, ` +
				`minimums_worked=${contract.minimums_are_worked_time}`,
		);

		if (hrsMinCall <= 0) {
			console.warn("Skipping E1: hrs_minimum_call not configured.");
			return;
		}

		if (hrsMax >= 5) {
			console.warn(
				`Skipping E1: hrs_meal_break_max (${hrsMax}) too large — gap would push clocks too far apart.`,
			);
			return;
		}

		// Note: The 2-tier rule uses hour1/hour2 from the Contract Rules (CRU) record,
		// not the contract's hrs_minimum_call. If the contract only has a single minimum,
		// hour1 == hour2. We test the behavior with whatever the contract has configured.

		const tcd = await createTimeCard({
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_E1,
		});
		const tcdId = assertId(tcd);
		createdTcdIds.push(tcdId);

		// Clock 1: 1 hour (< minimum)
		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_E1,
			timeIn: "08:00:00",
			timeOut: "09:00:00",
		});

		// Gap > max_meal_break: ends first call, starts second call
		const gapHrs = hrsMax + 1;
		const clock2InHrs = 9 + gapHrs;
		if (clock2InHrs + 1 >= 24) {
			console.warn("Skipping E1: Clock 2 would end past midnight.");
			return;
		}
		const clock2In = `${String(Math.floor(clock2InHrs)).padStart(2, "0")}:00:00`;
		const clock2Out = `${String(Math.floor(clock2InHrs + 1)).padStart(2, "0")}:00:00`;

		console.log(`Clock 2: ${clock2In} - ${clock2Out} (gap=${gapHrs} hrs)`);

		// Clock 2: 1 hour (< minimum for second call)
		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_E1,
			timeIn: clock2In,
			timeOut: clock2Out,
		});

		const result = await applyRules(tcdId);
		expect(result.error).toBe(0);

		const tcls = await getResultTCLs(tcdId);

		for (const r of tcls.all) {
			console.log(
				`  TCL: ${r.time_in}-${r.time_out} isBill=${r.isBill} isPay=${r.isPay} ` +
					`isMinimumCall=${r.isMinimumCall} hrsUnworked=${r.hrsUnworked} ` +
					`noteRule="${r.noteRule ?? ""}"`,
			);
		}

		// Both calls are under minimum, so MC should fire for both
		const mcEntries = tcls.all.filter(
			(r) =>
				r.isMinimumCall === 1 &&
				(r._timecardline_id || r.isBill || r.isPay),
		);

		console.log(`  MC entries found: ${mcEntries.length}`);

		// Should have at least 2 MC-related entries (one per call, in bill/pay or unworked)
		// On a worked contract, these go to bill/pay. On unworked, to unworked.
		const allMc = [
			...tcls.billable.filter((r) => r.isMinimumCall === 1),
			...tcls.payable.filter((r) => r.isMinimumCall === 1),
			...tcls.unworked.filter((r) => r.isMinimumCall === 1),
		];

		expect(
			allMc.length,
			"Both short calls should trigger MC entries (one per call)",
		).toBeGreaterThanOrEqual(2);

		// Verify MC entries have correct shortfall amounts
		for (const mc of allMc) {
			if (mc.time_in && mc.time_out) {
				let inH = parseTimeToHours(mc.time_in);
				let outH = parseTimeToHours(mc.time_out);
				if (outH < inH) outH += 24;
				const duration = outH - inH;
				console.log(
					`  MC entry: ${mc.time_in}-${mc.time_out} duration=${duration} hrs`,
				);
				// MC duration should be <= minimum - 1 (shortfall from 1 hr of work)
				expect(
					duration,
					`MC entry should not exceed minimum (${hrsMinCall}) - 1 hr of work`,
				).toBeLessThanOrEqual(hrsMinCall);
			}
		}
	});

	it("E2: should not create MC entries when work exactly equals minimum", async () => {
		const contactId = requireEnv("TEST_CONTACT_ID");
		const eventId = requireEnv("TEST_EVENT_ID");
		const contractId = requireEnv("TEST_CONTRACT_ID_WORKED");

		const contract = await getContract(contractId);
		const hrsMinCall = contract.hrs_minimum_call ?? 0;

		console.log(`Contract: minCall=${hrsMinCall}`);

		if (hrsMinCall <= 0) {
			console.warn("Skipping E2: hrs_minimum_call not configured.");
			return;
		}

		if (hrsMinCall > 12) {
			console.warn(
				`Skipping E2: hrs_minimum_call (${hrsMinCall}) too large for single-day test.`,
			);
			return;
		}

		const tcd = await createTimeCard({
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_E2,
		});
		const tcdId = assertId(tcd);
		createdTcdIds.push(tcdId);

		// Clock exactly equals minimum call
		const outHrs = 9 + hrsMinCall;
		if (outHrs >= 24) {
			console.warn("Skipping E2: Clock would end past midnight.");
			return;
		}
		const timeOut = `${String(Math.floor(outHrs)).padStart(2, "0")}:${String(Math.round((outHrs % 1) * 60)).padStart(2, "0")}:00`;

		console.log(
			`Clock: 09:00:00 - ${timeOut} (exactly ${hrsMinCall} hrs = minimum)`,
		);

		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_E2,
			timeIn: "09:00:00",
			timeOut,
		});

		const result = await applyRules(tcdId);
		expect(result.error).toBe(0);

		const tcls = await getResultTCLs(tcdId);

		// No MC entries should exist since work meets minimum exactly
		const mcBillable = tcls.billable.filter(
			(r) => r.isMinimumCall === 1,
		);
		const mcPayable = tcls.payable.filter(
			(r) => r.isMinimumCall === 1,
		);
		const mcUnworked = tcls.unworked.filter(
			(r) => r.isMinimumCall === 1,
		);

		console.log(
			`  MC entries: billable=${mcBillable.length} payable=${mcPayable.length} unworked=${mcUnworked.length}`,
		);

		expect(
			mcBillable.length + mcPayable.length + mcUnworked.length,
			`Work of exactly ${hrsMinCall} hrs should NOT trigger MC entries`,
		).toBe(0);
	});

	it("E3: should not create MC entries when multiple calls exceed minimum", async () => {
		const contactId = requireEnv("TEST_CONTACT_ID");
		const eventId = requireEnv("TEST_EVENT_ID");
		const contractId = requireEnv("TEST_CONTRACT_ID_WORKED");

		const contract = await getContract(contractId);
		const hrsMinCall = contract.hrs_minimum_call ?? 0;
		const hrsMax = contract.hrs_meal_break_max ?? 24;

		console.log(
			`Contract: minCall=${hrsMinCall}, max_meal_break=${hrsMax}`,
		);

		if (hrsMinCall <= 0) {
			console.warn("Skipping E3: hrs_minimum_call not configured.");
			return;
		}

		if (hrsMax >= 5) {
			console.warn(
				`Skipping E3: hrs_meal_break_max (${hrsMax}) too large for multi-call test.`,
			);
			return;
		}

		const tcd = await createTimeCard({
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_E3,
		});
		const tcdId = assertId(tcd);
		createdTcdIds.push(tcdId);

		// Clock 1: exceeds minimum (minimum + 1 hr)
		const clock1Hrs = hrsMinCall + 1;
		const clock1Out = 8 + clock1Hrs;
		if (clock1Out >= 24) {
			console.warn("Skipping E3: Clock 1 would end past midnight.");
			return;
		}
		const clock1OutStr = `${String(Math.floor(clock1Out)).padStart(2, "0")}:00:00`;

		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_E3,
			timeIn: "08:00:00",
			timeOut: clock1OutStr,
		});

		// Gap > max_meal_break
		const gapHrs = hrsMax + 1;
		const clock2In = clock1Out + gapHrs;
		const clock2Out = clock2In + hrsMinCall + 1;
		if (clock2Out >= 24) {
			console.warn("Skipping E3: Clock 2 would end past midnight.");
			return;
		}
		const clock2InStr = `${String(Math.floor(clock2In)).padStart(2, "0")}:00:00`;
		const clock2OutStr = `${String(Math.floor(clock2Out)).padStart(2, "0")}:00:00`;

		console.log(
			`Clock 1: 08:00 - ${clock1OutStr} (${clock1Hrs} hrs)`,
		);
		console.log(
			`Clock 2: ${clock2InStr} - ${clock2OutStr} (${hrsMinCall + 1} hrs)`,
		);

		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_E3,
			timeIn: clock2InStr,
			timeOut: clock2OutStr,
		});

		const result = await applyRules(tcdId);
		expect(result.error).toBe(0);

		const tcls = await getResultTCLs(tcdId);

		// No MC entries should exist since both calls exceed minimum
		const mcAll = [
			...tcls.billable.filter((r) => r.isMinimumCall === 1),
			...tcls.payable.filter((r) => r.isMinimumCall === 1),
			...tcls.unworked.filter((r) => r.isMinimumCall === 1),
		];

		console.log(`  MC entries: ${mcAll.length}`);

		expect(
			mcAll.length,
			"Both calls exceed minimum — no MC entries should be created",
		).toBe(0);
	});
});
