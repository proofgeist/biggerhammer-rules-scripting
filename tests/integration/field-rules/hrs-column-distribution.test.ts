/**
 * Group M: Hours Column Distribution Tests
 *
 * Verifies that the hrsColumn0-5 fields are correctly populated on
 * billable/payable entries after rules are applied.
 *
 * Column mapping (from schema comments):
 *   hrsColumn0 = hours_ST  (standard time)
 *   hrsColumn1 = hours_OT  (overtime)
 *   hrsColumn2 = hours_DT  (double time)
 *   hrsColumn3 = hours_NT  (night time)
 *   hrsColumn4 = hours_MP  (meal penalty)
 *   hrsColumn5 = hours_DR  (drive time)
 *
 * Tests read contract config at runtime and skip when the relevant
 * rule is not configured.
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

const TEST_DATE_M1 = "2027-10-01";
const TEST_DATE_M2 = "2027-10-02";
const TEST_DATE_M3 = "2027-10-03";

describe("Hours Column Distribution", () => {
	const createdTcdIds: string[] = [];

	afterAll(async () => {
		await cleanupAll(createdTcdIds);
	});

	it("M1: straight-time only — hrsColumn0 populated, columns 1-5 are zero", async () => {
		const contactId = requireEnv("TEST_CONTACT_ID");
		const eventId = requireEnv("TEST_EVENT_ID");
		const contractId = requireEnv("TEST_CONTRACT_ID_WORKED");

		const contract = await getContract(contractId);
		const nightEnd = contract.time_night_end;
		const nightEndHrs = nightEnd ? parseTimeToHours(nightEnd) : 0;
		const nightStart = contract.time_night_start;
		const nightStartHrs = nightStart ? parseTimeToHours(nightStart) : 24;

		console.log(
			`Contract: night_start=${nightStart}, night_end=${nightEnd}`,
		);

		// 09:00-13:00 must be fully outside the night window for a pure ST test
		if (nightEndHrs > 9 || nightStartHrs < 13) {
			console.warn(
				`Skipping M1: Night window (${nightStart}-${nightEnd}) overlaps with 09:00-13:00 test range.`,
			);
			return;
		}

		const tcd = await createTimeCard({
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_M1,
		});
		const tcdId = assertId(tcd);
		createdTcdIds.push(tcdId);

		// 4-hour daytime clock — no OT, no night, no penalties
		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_M1,
			timeIn: "09:00:00",
			timeOut: "13:00:00",
		});

		const result = await applyRules(tcdId);
		expect(result.error).toBe(0);

		const tcls = await getResultTCLs(tcdId);

		// Diagnostic logging
		for (const r of tcls.billable) {
			console.log(
				`  Bill: ${r.time_in}-${r.time_out} ` +
					`hrsColumn0=${r.hrsColumn0} hrsColumn1=${r.hrsColumn1} ` +
					`hrsColumn2=${r.hrsColumn2} hrsColumn3=${r.hrsColumn3} ` +
					`hrsColumn4=${r.hrsColumn4} hrsColumn5=${r.hrsColumn5}`,
			);
		}

		// Every billable entry should carry standard time only
		for (const r of tcls.billable) {
			expect(
				r.hrsColumn0,
				`Billable entry ${r.time_in}-${r.time_out} should have hrsColumn0 (ST) > 0`,
			).toBeGreaterThan(0);

			expect(
				r.hrsColumn1 ?? 0,
				`Billable entry ${r.time_in}-${r.time_out} should have hrsColumn1 (OT) = 0`,
			).toBe(0);

			expect(
				r.hrsColumn2 ?? 0,
				`Billable entry ${r.time_in}-${r.time_out} should have hrsColumn2 (DT) = 0`,
			).toBe(0);

			expect(
				r.hrsColumn3 ?? 0,
				`Billable entry ${r.time_in}-${r.time_out} should have hrsColumn3 (NT) = 0`,
			).toBe(0);

			expect(
				r.hrsColumn4 ?? 0,
				`Billable entry ${r.time_in}-${r.time_out} should have hrsColumn4 (MP) = 0`,
			).toBe(0);

			expect(
				r.hrsColumn5 ?? 0,
				`Billable entry ${r.time_in}-${r.time_out} should have hrsColumn5 (DR) = 0`,
			).toBe(0);
		}
	});

	it("M2: OT distribution — hrsColumn0 (ST) and hrsColumn1 (OT) both populated", async () => {
		const contactId = requireEnv("TEST_CONTACT_ID");
		const eventId = requireEnv("TEST_EVENT_ID");
		const contractId = requireEnv("TEST_CONTRACT_ID_WORKED");

		const contract = await getContract(contractId);
		const hrsL1 = contract.hrs_overtime_daily_L1 ?? 0;

		console.log(`Contract: OT L1=${hrsL1}`);

		if (hrsL1 <= 0) {
			console.warn(
				"Skipping M2: hrs_overtime_daily_L1 not configured.",
			);
			return;
		}

		// 10-hr clock starting at 07:00 — must exceed L1
		const totalHrs = 10;
		if (totalHrs <= hrsL1) {
			console.warn(
				`Skipping M2: 10-hr shift does not exceed L1 threshold (${hrsL1}).`,
			);
			return;
		}

		const tcd = await createTimeCard({
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_M2,
		});
		const tcdId = assertId(tcd);
		createdTcdIds.push(tcdId);

		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_M2,
			timeIn: "07:00:00",
			timeOut: "17:00:00",
		});

		const result = await applyRules(tcdId);
		expect(result.error).toBe(0);

		const tcls = await getResultTCLs(tcdId);

		// Diagnostic logging
		for (const r of tcls.billable) {
			console.log(
				`  Bill: ${r.time_in}-${r.time_out} ` +
					`hrsColumn0=${r.hrsColumn0} hrsColumn1=${r.hrsColumn1} ` +
					`hrsColumn2=${r.hrsColumn2} hrsColumn3=${r.hrsColumn3} ` +
					`hrsColumn4=${r.hrsColumn4} hrsColumn5=${r.hrsColumn5} ` +
					`isOTDailyL1=${r.isOTDailyL1}`,
			);
		}

		// At least one billable entry should carry standard time
		const stEntries = tcls.billable.filter(
			(r) => (r.hrsColumn0 ?? 0) > 0,
		);
		expect(
			stEntries.length,
			"At least one billable entry should have hrsColumn0 (ST) > 0",
		).toBeGreaterThanOrEqual(1);

		// At least one billable entry should carry overtime
		const otEntries = tcls.billable.filter(
			(r) => (r.hrsColumn1 ?? 0) > 0,
		);
		expect(
			otEntries.length,
			"At least one billable entry should have hrsColumn1 (OT) > 0",
		).toBeGreaterThanOrEqual(1);
	});

	it("M3: night rate distribution — hrsColumn3 (NT) populated", async () => {
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
				"Skipping M3: Night rate not configured on this contract.",
			);
			return;
		}

		const nightEndHrs = parseTimeToHours(nightEnd);

		// We need a clock fully within the early night window (midnight to nightEnd).
		// E.g., if nightEnd is 06:00, clock from 01:00 to 05:00.
		if (nightEndHrs <= 2) {
			console.warn(
				`Skipping M3: Night end (${nightEnd}) too early for a test clock within the early window.`,
			);
			return;
		}

		// Clock from 01:00 to nightEnd - 1 hr (fully within early night window)
		const clockOutHrs = nightEndHrs - 1;
		if (clockOutHrs <= 1) {
			console.warn("Skipping M3: Night window too narrow for test.");
			return;
		}
		const clockOutStr = `${String(Math.floor(clockOutHrs)).padStart(2, "0")}:00:00`;

		console.log(`Clock: 01:00:00 - ${clockOutStr} (early night window)`);

		const tcd = await createTimeCard({
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_M3,
		});
		const tcdId = assertId(tcd);
		createdTcdIds.push(tcdId);

		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_M3,
			timeIn: "01:00:00",
			timeOut: clockOutStr,
		});

		const result = await applyRules(tcdId);
		expect(result.error).toBe(0);

		const tcls = await getResultTCLs(tcdId);

		// Diagnostic logging
		for (const r of tcls.billable) {
			console.log(
				`  Bill: ${r.time_in}-${r.time_out} ` +
					`hrsColumn0=${r.hrsColumn0} hrsColumn1=${r.hrsColumn1} ` +
					`hrsColumn2=${r.hrsColumn2} hrsColumn3=${r.hrsColumn3} ` +
					`hrsColumn4=${r.hrsColumn4} hrsColumn5=${r.hrsColumn5} ` +
					`isNightRate=${r.isNightRate}`,
			);
		}

		// At least one billable entry should carry night-rate hours
		const ntEntries = tcls.billable.filter(
			(r) => (r.hrsColumn3 ?? 0) > 0,
		);
		expect(
			ntEntries.length,
			"At least one billable entry should have hrsColumn3 (NT) > 0",
		).toBeGreaterThanOrEqual(1);
	});
});
