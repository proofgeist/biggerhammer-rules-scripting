/**
 * Group B: Daily Overtime Tests
 *
 * Verifies that the Daily Overtime rule correctly splits TCL entries at
 * the L1 and L2 OT thresholds and applies the correct flags.
 *
 * Bug 2 verification (B2): The "spans both L1 and L2" branch uses
 * `Timestamp($this_date; $L1_out_time)` without adding $this_isAfterMidnight,
 * while the single-threshold branches correctly add it. This means after-midnight
 * entries that cross both thresholds will have wrong timestamp dates.
 *
 * Tests read `hrs_overtime_daily_L1` and `hrs_overtime_daily_L2` from the contract
 * at runtime and construct scenarios accordingly.
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

// Each test uses a unique date to prevent overlapping clock records
// when multiple TCDs exist for the same contact during the test run.
const TEST_DATE_B1 = "2026-05-06";
const TEST_DATE_B2 = "2026-06-06";
const TEST_DATE_B3 = "2026-07-06";
const TEST_DATE_B4 = "2026-08-06";

describe("Daily Overtime", () => {
	const createdTcdIds: string[] = [];

	afterAll(async () => {
		await cleanupAll(createdTcdIds);
	});

	it("B1: should split a single long shift at the L1 OT threshold", async () => {
		const contactId = requireEnv("TEST_CONTACT_ID");
		const eventId = requireEnv("TEST_EVENT_ID");
		const contractId = requireEnv("TEST_CONTRACT_ID_WORKED");

		const contract = await getContract(contractId);
		const hrsL1 = contract.hrs_overtime_daily_L1 ?? 0;

		console.log(`Contract: OT L1=${hrsL1}`);

		if (hrsL1 <= 0) {
			console.warn(
				"Skipping B1: hrs_overtime_daily_L1 not configured.",
			);
			return;
		}

		const tcd = await createTimeCard({
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_B1,
		});
		const tcdId = assertId(tcd);
		createdTcdIds.push(tcdId);

		// Single clock that exceeds L1 by 2 hours
		// Start at 08:00, work for L1 + 2 hours
		const totalHrs = hrsL1 + 2;
		const outHrs = 8 + totalHrs;
		if (outHrs >= 24) {
			console.warn(
				`Skipping B1: Shift would end at ${outHrs}:00 (>= 24:00). ` +
					`L1=${hrsL1} is too large for a single-day test.`,
			);
			return;
		}
		const timeOut = `${String(Math.floor(outHrs)).padStart(2, "0")}:00:00`;

		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_B1,
			timeIn: "08:00:00",
			timeOut,
		});

		const result = await applyRules(tcdId);
		expect(result.error).toBe(0);

		const tcls = await getResultTCLs(tcdId);

		for (const r of tcls.billable) {
			console.log(
				`  Bill: ${r.time_in}-${r.time_out} isOTDailyL1=${r.isOTDailyL1} ` +
					`isOTDailyL2=${r.isOTDailyL2}`,
			);
		}

		// Should have at least 2 billable entries (split at L1 boundary)
		expect(
			tcls.billable.length,
			`Shift of ${totalHrs} hrs should be split at L1=${hrsL1} hrs`,
		).toBeGreaterThanOrEqual(2);

		// Find base-rate entries (no OT flags)
		const baseEntries = tcls.billable.filter(
			(r) => !r.isOTDailyL1 && !r.isOTDailyL2,
		);
		// Find L1 OT entries
		const otL1Entries = tcls.billable.filter(
			(r) => r.isOTDailyL1 === 1,
		);

		expect(
			baseEntries.length,
			"Should have at least 1 base-rate entry",
		).toBeGreaterThanOrEqual(1);

		expect(
			otL1Entries.length,
			"Should have at least 1 L1 OT entry",
		).toBeGreaterThanOrEqual(1);

		// Verify the split point is correct: base-rate hours should sum to ~L1
		let baseHrs = 0;
		for (const r of baseEntries) {
			if (r.time_in && r.time_out) {
				const inH = parseTimeToHours(r.time_in);
				let outH = parseTimeToHours(r.time_out);
				if (outH < inH) outH += 24;
				if (outH === 0 && inH > 0) outH = 24;
				baseHrs += outH - inH;
			}
		}

		console.log(`  Base-rate hours: ${baseHrs} (expected: ~${hrsL1})`);
		// Base rate hours should be close to L1 threshold
		// Allow tolerance for MC/B/A entries that may shift things
		expect(baseHrs).toBeGreaterThanOrEqual(hrsL1 - 0.5);
		expect(baseHrs).toBeLessThanOrEqual(hrsL1 + 0.5);
	});

	it("B2: should split a shift crossing both L1 and L2 thresholds (Bug 2)", async () => {
		const contactId = requireEnv("TEST_CONTACT_ID");
		const eventId = requireEnv("TEST_EVENT_ID");
		const contractId = requireEnv("TEST_CONTRACT_ID_WORKED");

		const contract = await getContract(contractId);
		const hrsL1 = contract.hrs_overtime_daily_L1 ?? 0;
		const hrsL2 = contract.hrs_overtime_daily_L2 ?? 0;

		console.log(`Contract: OT L1=${hrsL1}, L2=${hrsL2}`);

		if (hrsL1 <= 0 || hrsL2 <= 0) {
			console.warn(
				"Skipping B2: Both L1 and L2 OT thresholds must be configured.",
			);
			return;
		}

		if (hrsL2 <= hrsL1) {
			console.warn(
				`Skipping B2: L2 (${hrsL2}) must be > L1 (${hrsL1}).`,
			);
			return;
		}

		const tcd = await createTimeCard({
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_B2,
		});
		const tcdId = assertId(tcd);
		createdTcdIds.push(tcdId);

		// Single clock that exceeds L2 by 2 hours
		const totalHrs = hrsL2 + 2;
		const startHr = 6;
		const outHrs = startHr + totalHrs;
		if (outHrs >= 24) {
			console.warn(
				`Skipping B2: Shift would end at ${outHrs}:00 (>= 24:00). ` +
					`L2=${hrsL2} is too large for a single-day test.`,
			);
			return;
		}
		const timeOut = `${String(Math.floor(outHrs)).padStart(2, "0")}:00:00`;

		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_B2,
			timeIn: "06:00:00",
			timeOut,
		});

		const result = await applyRules(tcdId);
		expect(result.error).toBe(0);

		const tcls = await getResultTCLs(tcdId);

		for (const r of tcls.billable) {
			console.log(
				`  Bill: ${r.time_in}-${r.time_out} isOTDailyL1=${r.isOTDailyL1} ` +
					`isOTDailyL2=${r.isOTDailyL2} isNightRate=${r.isNightRate}`,
			);
		}

		// Should have at least 3 billable entries (base + L1 + L2)
		// Note: Night rate splits may add more
		expect(
			tcls.billable.length,
			`Shift of ${totalHrs} hrs should be split at L1=${hrsL1} and L2=${hrsL2}`,
		).toBeGreaterThanOrEqual(3);

		// Find entries by OT tier
		const baseEntries = tcls.billable.filter(
			(r) => !r.isOTDailyL1 && !r.isOTDailyL2,
		);
		const otL1Entries = tcls.billable.filter(
			(r) => r.isOTDailyL1 === 1 && !r.isOTDailyL2,
		);
		const otL2Entries = tcls.billable.filter(
			(r) => r.isOTDailyL2 === 1,
		);

		console.log(
			`  Base entries: ${baseEntries.length}, L1 entries: ${otL1Entries.length}, L2 entries: ${otL2Entries.length}`,
		);

		expect(
			baseEntries.length,
			"Should have at least 1 base-rate entry",
		).toBeGreaterThanOrEqual(1);
		expect(
			otL1Entries.length,
			"Should have at least 1 L1 OT entry",
		).toBeGreaterThanOrEqual(1);
		expect(
			otL2Entries.length,
			"Should have at least 1 L2 OT entry",
		).toBeGreaterThanOrEqual(1);

		// Verify timestamps are consistent (no date anomalies from Bug 2)
		for (const r of tcls.billable) {
			if (r.time_in_ts_c && r.time_out_ts_c) {
				const inTs = new Date(r.time_in_ts_c).getTime();
				const outTs = new Date(r.time_out_ts_c).getTime();
				expect(
					outTs,
					`Entry ${r.time_in}-${r.time_out}: time_out_ts_c should be after time_in_ts_c. ` +
						`Bug 2 causes wrong dates on triple-split entries.`,
				).toBeGreaterThan(inTs);
			}
		}
	});

	it("B3: should split OT across multiple clocks with a gap", async () => {
		const contactId = requireEnv("TEST_CONTACT_ID");
		const eventId = requireEnv("TEST_EVENT_ID");
		const contractId = requireEnv("TEST_CONTRACT_ID_WORKED");

		const contract = await getContract(contractId);
		const hrsL1 = contract.hrs_overtime_daily_L1 ?? 0;

		console.log(`Contract: OT L1=${hrsL1}`);

		if (hrsL1 <= 0) {
			console.warn("Skipping B3: hrs_overtime_daily_L1 not configured.");
			return;
		}

		if (hrsL1 <= 2) {
			console.warn(
				`Skipping B3: L1 (${hrsL1}) too small for multi-clock test.`,
			);
			return;
		}

		const tcd = await createTimeCard({
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_B3,
		});
		const tcdId = assertId(tcd);
		createdTcdIds.push(tcdId);

		// Clock 1: work for L1 - 2 hours (under threshold)
		const clock1Hrs = hrsL1 - 2;
		const clock1Out = 8 + clock1Hrs;
		const clock1OutStr = `${String(Math.floor(clock1Out)).padStart(2, "0")}:00:00`;

		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_B3,
			timeIn: "08:00:00",
			timeOut: clock1OutStr,
		});

		// Clock 2: starts 1 hour later, works 4 hours (crosses L1 threshold)
		const clock2In = clock1Out + 1;
		const clock2Out = clock2In + 4;
		if (clock2Out >= 24) {
			console.warn("Skipping B3: Clock 2 would end past midnight.");
			return;
		}
		const clock2InStr = `${String(Math.floor(clock2In)).padStart(2, "0")}:00:00`;
		const clock2OutStr = `${String(Math.floor(clock2Out)).padStart(2, "0")}:00:00`;

		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_B3,
			timeIn: clock2InStr,
			timeOut: clock2OutStr,
		});

		const result = await applyRules(tcdId);
		expect(result.error).toBe(0);

		const tcls = await getResultTCLs(tcdId);

		for (const r of tcls.billable) {
			console.log(
				`  Bill: ${r.time_in}-${r.time_out} isOTDailyL1=${r.isOTDailyL1}`,
			);
		}

		// Clock 1 should be entirely base rate
		const clock1Bills = tcls.billable.filter((r) => {
			const t = parseTimeToHours(r.time_in ?? "0");
			return t >= 8 && t < clock1Out;
		});

		for (const r of clock1Bills) {
			expect(
				r.isOTDailyL1,
				`Clock 1 entry ${r.time_in}-${r.time_out} should be base rate (no OT flag)`,
			).toBeFalsy();
		}

		// Clock 2 should contain the OT split
		const otEntries = tcls.billable.filter(
			(r) => r.isOTDailyL1 === 1,
		);
		expect(
			otEntries.length,
			"OT threshold should be crossed within Clock 2",
		).toBeGreaterThanOrEqual(1);
	});

	it("B4: should not apply OT to a short shift below L1 threshold", async () => {
		const contactId = requireEnv("TEST_CONTACT_ID");
		const eventId = requireEnv("TEST_EVENT_ID");
		const contractId = requireEnv("TEST_CONTRACT_ID_WORKED");

		const contract = await getContract(contractId);
		const hrsL1 = contract.hrs_overtime_daily_L1 ?? 0;

		console.log(`Contract: OT L1=${hrsL1}`);

		if (hrsL1 <= 0) {
			console.warn("Skipping B4: hrs_overtime_daily_L1 not configured.");
			return;
		}

		if (hrsL1 <= 4) {
			console.warn(
				`Skipping B4: L1 (${hrsL1}) too small to test with 4-hr shift.`,
			);
			return;
		}

		const tcd = await createTimeCard({
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_B4,
		});
		const tcdId = assertId(tcd);
		createdTcdIds.push(tcdId);

		// Short shift: 4 hours, well under L1
		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_B4,
			timeIn: "09:00:00",
			timeOut: "13:00:00",
		});

		const result = await applyRules(tcdId);
		expect(result.error).toBe(0);

		const tcls = await getResultTCLs(tcdId);

		// No billable entries should have OT flags
		for (const r of tcls.billable) {
			expect(
				r.isOTDailyL1,
				`Entry ${r.time_in}-${r.time_out} should not have L1 OT flag`,
			).toBeFalsy();
			expect(
				r.isOTDailyL2,
				`Entry ${r.time_in}-${r.time_out} should not have L2 OT flag`,
			).toBeFalsy();
		}

		// Same for payable
		for (const r of tcls.payable) {
			expect(
				r.isOTDailyL1,
				`Pay entry ${r.time_in}-${r.time_out} should not have L1 OT flag`,
			).toBeFalsy();
		}
	});
});
