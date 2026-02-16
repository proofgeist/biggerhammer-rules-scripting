/**
 * Group J: Weekly Overtime Tests
 *
 * Tests Weekly Overtime (field-based, requires hrs_overtime_weekly,
 * mult_overtime_weekly, start_of_week on contract).
 *
 * CRITICAL: TCDs must be created and rules applied sequentially (day 1
 * first, then day 2, etc.) because the Weekly OT script reads bill/pay
 * history from prior days.
 *
 * J1: 6 days × 8 hrs = 48 hrs → last day has isOTWeekly=1 after threshold
 * J2: 3 days × 8 hrs = 24 hrs → no weekly OT
 * J3: Weekly OT does not apply to entries already flagged as Daily OT
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

function dateStr(year: number, month: number, day: number): string {
	return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

describe("Weekly Overtime", () => {
		const createdTcdIds: string[] = [];

		afterAll(async () => {
			await cleanupAll(createdTcdIds);
		});

		it("J1: 6 days × 8 hrs → weekly OT on last day", { timeout: 120_000 }, async () => {
			const contactId = requireEnv("TEST_CONTACT_ID");
			const eventId = requireEnv("TEST_EVENT_ID");
			const contractId = requireEnv("TEST_CONTRACT_ID_WORKED");

			const contract = await getContract(contractId);
			const hrsWeekly = contract.hrs_overtime_weekly ?? 0;
			const multWeekly = contract.mult_overtime_weekly ?? 0;
			const startOfWeek = contract.start_of_week;

			console.log(
				`Contract: weekly_OT=${hrsWeekly}, mult=${multWeekly}, ` +
					`start_of_week=${startOfWeek}`,
			);

			if (hrsWeekly <= 0 || multWeekly <= 0) {
				console.warn(
					"Skipping J1: Weekly OT not configured on this contract.",
				);
				return;
			}

			// Calculate how many 8-hr days to exceed the threshold
			const daysNeeded = Math.ceil(hrsWeekly / 8) + 1;
			if (daysNeeded > 7) {
				console.warn(
					`Skipping J1: Need ${daysNeeded} days to exceed weekly OT (${hrsWeekly} hrs). Too many.`,
				);
				return;
			}

			console.log(
				`Creating ${daysNeeded} days × 8 hrs = ${daysNeeded * 8} hrs ` +
					`(threshold = ${hrsWeekly} hrs)`,
			);

			// Use dates in March 2027 that fall within the same work week
			// Start from Monday 2027-03-15
			let lastTcdId = "";
			for (let d = 0; d < daysNeeded; d++) {
				const date = dateStr(2027, 3, 15 + d);

				const tcd = await createTimeCard({
					contactId,
					eventId,
					contractId,
					date,
				});
				const tcdId = assertId(tcd);
				createdTcdIds.push(tcdId);
				lastTcdId = tcdId;

				await createClockTCL({
					timecardId: tcdId,
					contactId,
					eventId,
					contractId,
					date,
					timeIn: "08:00:00",
					timeOut: "16:00:00",
				});

				const result = await applyRules(tcdId);
				expect(
					result.error,
					`Rules should succeed for day ${d + 1}`,
				).toBe(0);
			}

			// Check the last day for weekly OT flag
			const tcls = await getResultTCLs(lastTcdId);

			for (const r of tcls.billable) {
				console.log(
					`  Bill: ${r.time_in}-${r.time_out} isOTWeekly=${r.isOTWeekly} ` +
						`isOTDailyL1=${r.isOTDailyL1}`,
				);
			}

			const weeklyOT = tcls.billable.filter(
				(r) => r.isOTWeekly === 1,
			);
			expect(
				weeklyOT.length,
				`After ${daysNeeded * 8} hrs (${daysNeeded} days × 8), ` +
					`weekly OT threshold (${hrsWeekly}) should be exceeded`,
			).toBeGreaterThanOrEqual(1);
		});

		it("J2: 3 days × 8 hrs = 24 hrs → no weekly OT", { timeout: 120_000 }, async () => {
			const contactId = requireEnv("TEST_CONTACT_ID");
			const eventId = requireEnv("TEST_EVENT_ID");
			const contractId = requireEnv("TEST_CONTRACT_ID_WORKED");

			const contract = await getContract(contractId);
			const hrsWeekly = contract.hrs_overtime_weekly ?? 0;

			console.log(`Contract: weekly_OT=${hrsWeekly}`);

			if (hrsWeekly <= 0) {
				console.warn(
					"Skipping J2: Weekly OT not configured.",
				);
				return;
			}

			if (hrsWeekly <= 24) {
				console.warn(
					`Skipping J2: Weekly OT threshold (${hrsWeekly}) <= 24 hrs. ` +
						`3 days × 8 hrs would already exceed it.`,
				);
				return;
			}

			// 3 days, well under threshold
			// Use a different week range: 2027-03-22 to 2027-03-24 (Mon-Wed)
			let lastTcdId = "";
			for (let d = 0; d < 3; d++) {
				const date = dateStr(2027, 3, 22 + d);

				const tcd = await createTimeCard({
					contactId,
					eventId,
					contractId,
					date,
				});
				const tcdId = assertId(tcd);
				createdTcdIds.push(tcdId);
				lastTcdId = tcdId;

				await createClockTCL({
					timecardId: tcdId,
					contactId,
					eventId,
					contractId,
					date,
					timeIn: "08:00:00",
					timeOut: "16:00:00",
				});

				const result = await applyRules(tcdId);
				expect(result.error).toBe(0);
			}

			// Check the last day — no weekly OT should be present
			const tcls = await getResultTCLs(lastTcdId);

			const weeklyOT = tcls.billable.filter(
				(r) => r.isOTWeekly === 1,
			);
			expect(
				weeklyOT.length,
				`24 hrs total < weekly OT threshold (${hrsWeekly}). No weekly OT expected.`,
			).toBe(0);
		});

		it("J3: weekly OT does not apply to entries already flagged as daily OT", { timeout: 120_000 }, async () => {
			const contactId = requireEnv("TEST_CONTACT_ID");
			const eventId = requireEnv("TEST_EVENT_ID");
			const contractId = requireEnv("TEST_CONTRACT_ID_WORKED");

			const contract = await getContract(contractId);
			const hrsWeekly = contract.hrs_overtime_weekly ?? 0;
			const hrsL1 = contract.hrs_overtime_daily_L1 ?? 0;

			console.log(
				`Contract: weekly_OT=${hrsWeekly}, daily_L1=${hrsL1}`,
			);

			if (hrsWeekly <= 0 || hrsL1 <= 0) {
				console.warn(
					"Skipping J3: Both weekly and daily OT must be configured.",
				);
				return;
			}

			// We need enough days to cross the weekly threshold, with the last
			// day also crossing the daily OT threshold.
			const normalDays = Math.ceil(hrsWeekly / 8);
			if (normalDays > 6) {
				console.warn(
					`Skipping J3: Need too many days (${normalDays}) to approach weekly threshold.`,
				);
				return;
			}

			// Create normalDays - 1 days of 8-hour shifts, then one long day
			// that crosses both daily AND weekly thresholds
			// Use week starting 2027-04-05 (Monday)
			let lastTcdId = "";

			for (let d = 0; d < normalDays - 1; d++) {
				const date = dateStr(2027, 4, 5 + d);

				const tcd = await createTimeCard({
					contactId,
					eventId,
					contractId,
					date,
				});
				const tcdId = assertId(tcd);
				createdTcdIds.push(tcdId);

				await createClockTCL({
					timecardId: tcdId,
					contactId,
					eventId,
					contractId,
					date,
					timeIn: "08:00:00",
					timeOut: "16:00:00",
				});

				const result = await applyRules(tcdId);
				expect(result.error).toBe(0);
			}

			// Last day: long shift crossing daily OT
			const lastDay = dateStr(2027, 4, 5 + normalDays - 1);
			const longHrs = hrsL1 + 3;
			const outHr = 6 + longHrs;
			if (outHr >= 24) {
				console.warn("Skipping J3: Long shift would end past midnight.");
				return;
			}
			const timeOut = `${String(Math.floor(outHr)).padStart(2, "0")}:00:00`;

			const tcd = await createTimeCard({
				contactId,
				eventId,
				contractId,
				date: lastDay,
			});
			const tcdId = assertId(tcd);
			createdTcdIds.push(tcdId);
			lastTcdId = tcdId;

			await createClockTCL({
				timecardId: tcdId,
				contactId,
				eventId,
				contractId,
				date: lastDay,
				timeIn: "06:00:00",
				timeOut,
			});

			const result = await applyRules(tcdId);
			expect(result.error).toBe(0);

			const tcls = await getResultTCLs(lastTcdId);

			for (const r of tcls.billable) {
				console.log(
					`  Bill: ${r.time_in}-${r.time_out} isOTWeekly=${r.isOTWeekly} ` +
						`isOTDailyL1=${r.isOTDailyL1} isOTDailyL2=${r.isOTDailyL2}`,
				);
			}

			// Entries with daily OT should NOT also have weekly OT
			const dailyAndWeekly = tcls.billable.filter(
				(r) => r.isOTDailyL1 === 1 && r.isOTWeekly === 1,
			);

			expect(
				dailyAndWeekly.length,
				"Daily OT entries should NOT also have weekly OT flag",
			).toBe(0);
		});
});
