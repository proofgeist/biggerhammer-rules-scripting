/**
 * Group F: Rule Interaction Tests
 *
 * Tests compound scenarios where multiple rules interact:
 *
 * F1: MC + Daily OT interaction — checks whether MC hours count toward
 *     OT threshold based on minimums_included_in_OT contract setting.
 *
 * F2: Midnight split + B/A interaction — verifies that entries split at
 *     midnight are correctly evaluated by the B/A rule.
 *
 * F3: Long day where MC + B/A + OT + Night Rate all potentially apply —
 *     verifies no errors and no double-counting.
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

const TEST_DATE_F1 = "2026-05-09";
const TEST_DATE_F2 = "2026-06-09";
const TEST_DATE_F3 = "2026-07-09";

describe("Rule Interactions", () => {
	const createdTcdIds: string[] = [];

	afterAll(async () => {
		await cleanupAll(createdTcdIds);
	});

	it("F1: should handle MC + Daily OT interaction based on minimums_included_in_OT", async () => {
		const contactId = requireEnv("TEST_CONTACT_ID");
		const eventId = requireEnv("TEST_EVENT_ID");
		const contractId = requireEnv("TEST_CONTRACT_ID_WORKED");

		const contract = await getContract(contractId);
		const hrsMinCall = contract.hrs_minimum_call ?? 0;
		const hrsL1 = contract.hrs_overtime_daily_L1 ?? 0;
		const minsIncludedOT = contract.minimums_included_in_OT;

		console.log(
			`Contract: minCall=${hrsMinCall}, OT L1=${hrsL1}, ` +
				`minimums_included_in_OT=${minsIncludedOT}, ` +
				`minimums_worked=${contract.minimums_are_worked_time}`,
		);

		if (hrsMinCall <= 0 || hrsL1 <= 0) {
			console.warn(
				"Skipping F1: Both hrs_minimum_call and hrs_overtime_daily_L1 must be configured.",
			);
			return;
		}

		// We need a clock short enough to trigger MC but combined with MC
		// the total approaches or exceeds OT threshold.
		// Clock: 1 hour (< minimum). MC will pad to at least hrsMinCall.
		// If hrsMinCall is close to hrsL1, the combination may cross OT.
		// For a cleaner test: work for L1 - 1 hour, so MC pad + work = L1 + (minCall - 1).
		// But we need work < minCall for MC to fire.
		// Strategy: work 1 hour. MC adds (minCall - 1) hrs. Total = minCall.
		// Then check if MC entries have OT flags.

		if (hrsMinCall >= hrsL1) {
			// MC alone could push into OT territory
			console.log(
				"Note: MC minimum >= OT threshold. MC entries alone could trigger OT.",
			);
		}

		const tcd = await createTimeCard({
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_F1,
		});
		const tcdId = assertId(tcd);
		createdTcdIds.push(tcdId);

		// Single short clock: 1 hour
		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_F1,
			timeIn: "08:00:00",
			timeOut: "09:00:00",
		});

		const result = await applyRules(tcdId);
		expect(result.error).toBe(0);

		const tcls = await getResultTCLs(tcdId);

		for (const r of tcls.all) {
			console.log(
				`  TCL: ${r.time_in}-${r.time_out} isBill=${r.isBill} isPay=${r.isPay} ` +
					`isMinimumCall=${r.isMinimumCall} isOTDailyL1=${r.isOTDailyL1} ` +
					`hrsUnworked=${r.hrsUnworked}`,
			);
		}

		// Find MC entries
		const mcBill = tcls.billable.filter((r) => r.isMinimumCall === 1);
		const mcUnworked = tcls.unworked.filter(
			(r) => r.isMinimumCall === 1,
		);

		if (contract.minimums_are_worked_time) {
			// Worked minimums: MC entries go to bill/pay
			if (minsIncludedOT) {
				// MC should be eligible for OT (if combined hours exceed L1)
				console.log(
					"minimums_included_in_OT=true: MC hours should count toward OT.",
				);
			} else {
				// MC entries should NOT have OT flags regardless of hours
				for (const mc of mcBill) {
					expect(
						mc.isOTDailyL1,
						`MC entry should NOT have OT flag when minimums_included_in_OT is false`,
					).toBeFalsy();
				}
				console.log(
					"minimums_included_in_OT=false: MC entries correctly excluded from OT.",
				);
			}
		} else {
			// Unworked minimums: MC entries go to unworked
			// OT should not apply to unworked entries (KL 5/23/22 fix)
			for (const mc of mcUnworked) {
				expect(
					mc.isOTDailyL1,
					"Unworked MC entry should not have OT flag",
				).toBeFalsy();
			}
		}

		// Script should complete without error regardless
		expect(result.error).toBe(0);
	});

	it("F2: should correctly apply B/A after midnight split", async () => {
		const contactId = requireEnv("TEST_CONTACT_ID");
		const eventId = requireEnv("TEST_EVENT_ID");
		const contractId = requireEnv("TEST_CONTRACT_ID_WORKED");

		const contract = await getContract(contractId);
		const hrsBefore = contract.hrs_before_unpaid_meal ?? 0;
		const hrsMax = contract.hrs_meal_break_max ?? 24;

		console.log(
			`Contract: before_unpaid_meal=${hrsBefore}, max_meal_break=${hrsMax}`,
		);

		if (hrsBefore <= 0) {
			console.warn("Skipping F2: hrs_before_unpaid_meal not configured.");
			return;
		}

		const tcd = await createTimeCard({
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_F2,
		});
		const tcdId = assertId(tcd);
		createdTcdIds.push(tcdId);

		// Clock 1: spans midnight, short enough to not satisfy before-meal
		// 22:00 - 02:00 (4 hours, split into 22:00-00:00 + 00:00-02:00)
		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_F2,
			timeIn: "22:00:00",
			timeOut: "02:00:00",
		});

		// Gap: 1 hour meal (02:00 - 03:00)

		// Clock 2: 4 hours after the meal
		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_F2,
			timeIn: "03:00:00",
			timeOut: "07:00:00",
		});

		const result = await applyRules(tcdId);
		expect(result.error).toBe(0);

		const tcls = await getResultTCLs(tcdId);

		for (const r of tcls.all) {
			console.log(
				`  TCL: ${r.time_in}-${r.time_out} isBill=${r.isBill} isPay=${r.isPay} ` +
					`isAfterMidnight=${r.isAfterMidnight} noteRule="${r.noteRule ?? ""}"`,
			);
		}

		// Verify midnight split happened
		const afterMidnightEntries = tcls.billable.filter(
			(r) => r.isAfterMidnight === 1,
		);
		expect(
			afterMidnightEntries.length,
			"Midnight-spanning clock should produce after-midnight entries",
		).toBeGreaterThanOrEqual(1);

		// Both clocks should produce billable entries
		expect(tcls.billable.length).toBeGreaterThanOrEqual(3);

		// If 4 hours < before-meal requirement, B/A should fire
		if (hrsBefore > 4) {
			const baEntries = tcls.all.filter((r) => {
				if (!r.noteRule) return false;
				return r.noteRule.toLowerCase().includes("before unpaid meal");
			});
			console.log(
				`  B/A entries: ${baEntries.length} (expected > 0 since 4 hrs < before=${hrsBefore})`,
			);
			expect(
				baEntries.length,
				`4 hrs of work < before-meal req (${hrsBefore}). B/A should fire.`,
			).toBeGreaterThan(0);
		} else {
			console.log(
				`  4 hrs >= before-meal req (${hrsBefore}). B/A before-meal should NOT fire.`,
			);
		}
	});

	it("F3: should handle a long day where MC + B/A + OT + Night Rate all apply", async () => {
		const contactId = requireEnv("TEST_CONTACT_ID");
		const eventId = requireEnv("TEST_EVENT_ID");
		const contractId = requireEnv("TEST_CONTRACT_ID_WORKED");

		const contract = await getContract(contractId);
		const hrsMinCall = contract.hrs_minimum_call ?? 0;
		const hrsBefore = contract.hrs_before_unpaid_meal ?? 0;
		const hrsL1 = contract.hrs_overtime_daily_L1 ?? 0;
		const nightStart = contract.time_night_start;
		const nightEnd = contract.time_night_end;
		const multNight = contract.mult_night ?? 0;

		console.log(
			`Contract: minCall=${hrsMinCall}, before=${hrsBefore}, OT L1=${hrsL1}, ` +
				`night=${nightStart}-${nightEnd}, mult_night=${multNight}`,
		);

		// This test just needs the rules to not error. We don't need all rules
		// to be configured — whatever IS configured should work together.

		const tcd = await createTimeCard({
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_F3,
		});
		const tcdId = assertId(tcd);
		createdTcdIds.push(tcdId);

		// Clock 1: early morning short stint (potentially in night window, < minimum)
		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_F3,
			timeIn: "03:00:00",
			timeOut: "04:00:00",
		});

		// Gap: 1 hour (04:00 - 05:00)

		// Clock 2: long day shift (crosses OT thresholds, starts near night end)
		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_F3,
			timeIn: "05:00:00",
			timeOut: "20:00:00",
		});

		const result = await applyRules(tcdId);

		// Primary assertion: the rules engine should not error
		expect(
			result.error,
			`Rules should complete without error on complex multi-rule scenario. ` +
				`Message: ${result.message}`,
		).toBe(0);

		const tcls = await getResultTCLs(tcdId);

		for (const r of tcls.all) {
			console.log(
				`  TCL: ${r.time_in}-${r.time_out} isBill=${r.isBill} isPay=${r.isPay} ` +
					`isMinimumCall=${r.isMinimumCall} isOTDailyL1=${r.isOTDailyL1} ` +
					`isNightRate=${r.isNightRate} hrsUnworked=${r.hrsUnworked} ` +
					`noteRule="${r.noteRule ?? ""}"`,
			);
		}

		// Should produce a reasonable number of entries
		// 2 clocks + bill/pay splits + MC + B/A + OT + NR = potentially many
		expect(tcls.all.length).toBeGreaterThanOrEqual(4);
		expect(
			tcls.all.length,
			"Total entries should be reasonable (not an explosion from rule interactions)",
		).toBeLessThanOrEqual(40);

		// Calculate total billable hours to sanity-check no double-counting
		let totalBillableHrs = 0;
		for (const r of tcls.billable) {
			if (r.time_in && r.time_out) {
				let inH = parseTimeToHours(r.time_in);
				let outH = parseTimeToHours(r.time_out);
				if (outH < inH) outH += 24;
				if (outH === 0 && inH > 0) outH = 24;
				totalBillableHrs += outH - inH;
			}
		}

		console.log(`  Total billable hours: ${totalBillableHrs}`);

		// Total billable hours should not exceed raw clock time + MC padding
		// Raw: 1 hr + 15 hrs = 16 hrs. With MC, maybe up to 16 + minCall.
		const maxExpected = 16 + hrsMinCall + hrsBefore;
		expect(
			totalBillableHrs,
			`Total billable hours (${totalBillableHrs}) should not wildly exceed raw time (16 hrs)`,
		).toBeLessThanOrEqual(maxExpected + 1);

		// Both clocks should contribute to billable entries
		expect(tcls.billable.length).toBeGreaterThanOrEqual(2);
	});
});
