/**
 * Group L: Ignore Flag Tests
 *
 * Verifies that per-line ignore flags correctly prevent rules from applying
 * to specific clock entries. Each test creates a clock TCL with an ignore
 * flag set and asserts that the corresponding rule does NOT fire for that
 * clock's resulting billable/payable entries.
 *
 * L1: ignoreOvertime — prevents daily OT flags from being set
 * L2: ignoreNightRate — prevents night rate from being applied
 * L3: ignoreMinimumCall — prevents MC entries from being created
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

const TEST_DATE_L1 = "2027-09-01";
const TEST_DATE_L2 = "2027-09-02";
const TEST_DATE_L3 = "2027-09-03";

describe("Ignore Flags", () => {
	const createdTcdIds: string[] = [];

	afterAll(async () => {
		await cleanupAll(createdTcdIds);
	});

	it("L1: ignoreOvertime should prevent OT flags on a long shift", async () => {
		const contactId = requireEnv("TEST_CONTACT_ID");
		const eventId = requireEnv("TEST_EVENT_ID");
		const contractId = requireEnv("TEST_CONTRACT_ID_WORKED");

		const contract = await getContract(contractId);
		const hrsL1 = contract.hrs_overtime_daily_L1 ?? 0;

		console.log(`Contract: OT L1=${hrsL1}`);

		if (hrsL1 <= 0) {
			console.warn(
				"Skipping L1: hrs_overtime_daily_L1 not configured on this contract.",
			);
			return;
		}

		// Create a 10-hour shift (07:00-17:00) which should exceed L1 threshold
		// but with ignoreOvertime=true, no OT flags should be set.
		const totalHrs = 10;
		const outHrs = 7 + totalHrs; // 17:00
		if (hrsL1 >= totalHrs) {
			console.warn(
				`Skipping L1: OT L1 threshold (${hrsL1}) >= shift length (${totalHrs}). ` +
					`Shift would not trigger OT even without the ignore flag.`,
			);
			return;
		}

		const tcd = await createTimeCard({
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_L1,
		});
		const tcdId = assertId(tcd);
		createdTcdIds.push(tcdId);

		const clock = await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_L1,
			timeIn: "07:00:00",
			timeOut: "17:00:00",
			ignoreOvertime: true,
		});
		const clockId = clock.__id;

		console.log(
			`Created clock ${clockId}: 07:00-17:00 (${totalHrs} hrs) with ignoreOvertime=true`,
		);

		const result = await applyRules(tcdId);
		expect(result.error).toBe(0);

		const tcls = await getResultTCLs(tcdId);

		// Log all billable entries for diagnostics
		for (const r of tcls.billable) {
			console.log(
				`  Bill: ${r.time_in}-${r.time_out} isOTDailyL1=${r.isOTDailyL1} ` +
					`isOTDailyL2=${r.isOTDailyL2} _timecardline_id=${r._timecardline_id}`,
			);
		}

		// Filter billable entries that trace back to our clock via _timecardline_id
		const clockBillEntries = tcls.billable.filter(
			(r) => r._timecardline_id === clockId,
		);

		console.log(
			`  Billable entries from this clock: ${clockBillEntries.length}`,
		);

		// None of the billable entries from this clock should have OT flags
		for (const r of clockBillEntries) {
			expect(
				r.isOTDailyL1,
				`Entry ${r.time_in}-${r.time_out} should NOT have isOTDailyL1 when ignoreOvertime is set`,
			).toBeFalsy();
			expect(
				r.isOTDailyL2,
				`Entry ${r.time_in}-${r.time_out} should NOT have isOTDailyL2 when ignoreOvertime is set`,
			).toBeFalsy();
		}

		// Also check all billable entries (in case _timecardline_id linkage differs)
		const otEntries = tcls.billable.filter(
			(r) => r.isOTDailyL1 === 1 || r.isOTDailyL2 === 1,
		);
		console.log(`  Total OT entries across all billable: ${otEntries.length}`);

		expect(
			otEntries.length,
			"No billable entries should have OT flags when ignoreOvertime is set on the only clock",
		).toBe(0);
	});

	it("L2: ignoreNightRate should prevent night rate on a night-window clock", async () => {
		const contactId = requireEnv("TEST_CONTACT_ID");
		const eventId = requireEnv("TEST_EVENT_ID");
		const contractId = requireEnv("TEST_CONTRACT_ID_WORKED");

		const contract = await getContract(contractId);
		const nightStart = contract.time_night_start;
		const nightEnd = contract.time_night_end;
		const multNight = contract.mult_night ?? 0;

		console.log(
			`Contract: night_start=${nightStart}, night_end=${nightEnd}, mult_night=${multNight}`,
		);

		if (!nightStart || !nightEnd || multNight <= 0) {
			console.warn(
				"Skipping L2: Night rate not configured on this contract.",
			);
			return;
		}

		const nightEndHrs = parseTimeToHours(nightEnd);

		// We need a clock fully within the early night window (midnight to nightEnd).
		// E.g., if nightEnd is 06:00, clock from 01:00 to 05:00 is fully within.
		if (nightEndHrs <= 2) {
			console.warn(
				`Skipping L2: Night end (${nightEnd}) too early for a test clock within the window.`,
			);
			return;
		}

		// Clock from 01:00 to nightEnd - 1 hr (fully within early night window)
		const clockOutHrs = nightEndHrs - 1;
		if (clockOutHrs <= 1) {
			console.warn("Skipping L2: Night window too narrow for test.");
			return;
		}
		const clockOutStr = `${String(Math.floor(clockOutHrs)).padStart(2, "0")}:00:00`;

		const tcd = await createTimeCard({
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_L2,
		});
		const tcdId = assertId(tcd);
		createdTcdIds.push(tcdId);

		const clock = await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_L2,
			timeIn: "01:00:00",
			timeOut: clockOutStr,
			ignoreNightRate: true,
		});
		const clockId = clock.__id;

		console.log(
			`Created clock ${clockId}: 01:00-${clockOutStr} with ignoreNightRate=true ` +
				`(night window: ${nightStart}-${nightEnd})`,
		);

		const result = await applyRules(tcdId);
		expect(result.error).toBe(0);

		const tcls = await getResultTCLs(tcdId);

		// Log all billable entries for diagnostics
		for (const r of tcls.billable) {
			console.log(
				`  Bill: ${r.time_in}-${r.time_out} isNightRate=${r.isNightRate} ` +
					`_timecardline_id=${r._timecardline_id}`,
			);
		}

		// Filter billable entries that trace back to our clock
		const clockBillEntries = tcls.billable.filter(
			(r) => r._timecardline_id === clockId,
		);

		console.log(
			`  Billable entries from this clock: ${clockBillEntries.length}`,
		);

		// None of the billable entries from this clock should have night rate
		for (const r of clockBillEntries) {
			expect(
				r.isNightRate,
				`Entry ${r.time_in}-${r.time_out} should NOT have isNightRate when ignoreNightRate is set`,
			).toBeFalsy();
		}

		// Also check all billable entries since this is the only clock on the TCD
		const nightRateEntries = tcls.billable.filter(
			(r) => r.isNightRate === 1,
		);
		console.log(
			`  Total night rate entries across all billable: ${nightRateEntries.length}`,
		);

		expect(
			nightRateEntries.length,
			"No billable entries should have isNightRate when ignoreNightRate is set on the only clock",
		).toBe(0);
	});

	it("L3: ignoreMinimumCall should prevent MC entries for a short shift", async () => {
		const contactId = requireEnv("TEST_CONTACT_ID");
		const eventId = requireEnv("TEST_EVENT_ID");
		const contractId = requireEnv("TEST_CONTRACT_ID_WORKED");

		const contract = await getContract(contractId);
		const hrsMinCall = contract.hrs_minimum_call ?? 0;

		console.log(`Contract: hrs_minimum_call=${hrsMinCall}`);

		if (hrsMinCall <= 0) {
			console.warn(
				"Skipping L3: hrs_minimum_call not configured on this contract.",
			);
			return;
		}

		if (hrsMinCall <= 1) {
			console.warn(
				`Skipping L3: hrs_minimum_call (${hrsMinCall}) is <= 1 hr. ` +
					`A 1-hour clock would not be short enough to trigger MC.`,
			);
			return;
		}

		const tcd = await createTimeCard({
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_L3,
		});
		const tcdId = assertId(tcd);
		createdTcdIds.push(tcdId);

		// Create a 1-hour clock (08:00-09:00) which is less than the minimum call,
		// but with ignoreMinimumCall=true so MC should NOT fire.
		const clock = await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_L3,
			timeIn: "08:00:00",
			timeOut: "09:00:00",
			ignoreMinimumCall: true,
		});
		const clockId = clock.__id;

		console.log(
			`Created clock ${clockId}: 08:00-09:00 (1 hr < minimum ${hrsMinCall} hrs) ` +
				`with ignoreMinimumCall=true`,
		);

		const result = await applyRules(tcdId);
		expect(result.error).toBe(0);

		const tcls = await getResultTCLs(tcdId);

		// Log all entries for diagnostics
		for (const r of tcls.all) {
			console.log(
				`  TCL: ${r.time_in}-${r.time_out} isBill=${r.isBill} isPay=${r.isPay} ` +
					`isMinimumCall=${r.isMinimumCall} hrsUnworked=${r.hrsUnworked} ` +
					`_timecardline_id=${r._timecardline_id}`,
			);
		}

		// No MC entries should exist anywhere (billable, payable, or unworked)
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

		const totalMc = mcBillable.length + mcPayable.length + mcUnworked.length;

		expect(
			totalMc,
			`1-hour clock (< ${hrsMinCall} hr minimum) with ignoreMinimumCall=true ` +
				`should NOT produce any MC entries`,
		).toBe(0);
	});
});
