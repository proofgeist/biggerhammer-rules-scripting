/**
 * Group J4: Weekly OT Week Boundary Reset Test
 *
 * Tests that the weekly overtime accumulator resets at the week boundary
 * defined by `start_of_week` on the contract.
 *
 * If start_of_week is "Sunday", then a run of 6 consecutive days
 * Thu-Fri-Sat-Sun-Mon-Tue that crosses that boundary should NOT
 * accumulate all 48 hrs into one week. The accumulator resets on Sunday,
 * so the second week (Sun-Mon-Tue) only has 24 hrs -- well under the
 * typical 40-hr weekly OT threshold.
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

function dateStr(year: number, month: number, day: number): string {
	return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Map a day-of-week name to its JS Date.getDay() value (0=Sun .. 6=Sat).
 */
function dayNameToIndex(name: string): number {
	const map: Record<string, number> = {
		Sunday: 0,
		Monday: 1,
		Tuesday: 2,
		Wednesday: 3,
		Thursday: 4,
		Friday: 5,
		Saturday: 6,
	};
	return map[name] ?? 0;
}

/**
 * Given a start_of_week day name, pick 6 consecutive dates starting on
 * the Thursday before that boundary so the boundary falls on day index 3
 * (the 4th day of the run).
 *
 * We use the year 2028 to avoid collisions with other tests.
 *
 * Returns an array of 6 date strings YYYY-MM-DD.
 */
function chooseDates(startOfWeek: string): string[] {
	// Target: find a Thursday that is 3 days before the start_of_week day
	// in February 2028.
	// Strategy: iterate Feb 2028 days until we find a day whose weekday
	// is 3 days before the start_of_week index (mod 7).

	const sowIndex = dayNameToIndex(startOfWeek);
	// We want the first day of our run to be (sowIndex - 3 + 7) % 7
	const targetDow = (sowIndex - 3 + 7) % 7;

	// Scan February 2028 for the first day matching targetDow
	let startDay = 1;
	for (let d = 1; d <= 20; d++) {
		const dt = new Date(2028, 1, d); // month is 0-indexed
		if (dt.getDay() === targetDow) {
			startDay = d;
			break;
		}
	}

	const dates: string[] = [];
	for (let i = 0; i < 6; i++) {
		dates.push(dateStr(2028, 2, startDay + i));
	}
	return dates;
}

describe("Weekly OT Week Boundary Reset", () => {
	const createdTcdIds: string[] = [];

	afterAll(async () => {
		await cleanupAll(createdTcdIds);
	});

	it("J4: weekly OT resets at week boundary — no OT after reset", { timeout: 120_000 }, async () => {
		const contactId = requireEnv("TEST_CONTACT_ID");
		const eventId = requireEnv("TEST_EVENT_ID");
		const contractId = requireEnv("TEST_CONTRACT_ID_WORKED");

		const contract = await getContract(contractId);
		const hrsWeekly = contract.hrs_overtime_weekly ?? 0;
		const multWeekly = contract.mult_overtime_weekly ?? 0;
		const rawStartOfWeek = contract.start_of_week;

		const startOfWeek =
			rawStartOfWeek && rawStartOfWeek.trim().length > 0
				? rawStartOfWeek.trim()
				: "Sunday";

		if (!rawStartOfWeek || rawStartOfWeek.trim().length === 0) {
			console.log(
				"start_of_week is not configured on this contract. " +
					"Defaulting to \"Sunday\" for this test.",
			);
		}

		console.log(
			`Contract: weekly_OT=${hrsWeekly}, mult=${multWeekly}, ` +
				`start_of_week=${startOfWeek}`,
		);

		if (hrsWeekly <= 0 || multWeekly <= 0) {
			console.warn(
				"Skipping J4: Weekly OT not configured on this contract " +
					`(hrs_overtime_weekly=${hrsWeekly}, mult_overtime_weekly=${multWeekly}).`,
			);
			return;
		}

		// We need the threshold to be > 24 hrs so that 3 days x 8 hrs
		// in the second week is safely under the threshold.
		if (hrsWeekly <= 24) {
			console.warn(
				`Skipping J4: Weekly OT threshold (${hrsWeekly}) is <= 24 hrs. ` +
					"The second-week bucket (24 hrs) would still exceed it, " +
					"making this test invalid.",
			);
			return;
		}

		// Choose 6 consecutive dates that straddle the start_of_week boundary.
		// Days 1-3 are in the old week, days 4-6 are in the new week.
		const dates = chooseDates(startOfWeek);

		console.log(
			`Test dates (6 consecutive days, boundary resets on ${startOfWeek}):`,
		);
		for (let i = 0; i < dates.length; i++) {
			const dt = new Date(dates[i] + "T12:00:00");
			const dayName = dt.toLocaleDateString("en-US", { weekday: "long" });
			const label = i === 3 ? ` <-- week resets here (${startOfWeek})` : "";
			console.log(`  Day ${i + 1}: ${dates[i]} (${dayName})${label}`);
		}

		console.log(
			`Creating 6 days x 8 hrs = 48 total hrs. ` +
				`Week 1 max = 24 hrs (days 1-3), Week 2 max = 24 hrs (days 4-6). ` +
				`Weekly OT threshold = ${hrsWeekly} hrs. ` +
				`Neither week should exceed the threshold.`,
		);

		// Create time cards and apply rules for each day in order
		let lastTcdId = "";
		for (let d = 0; d < dates.length; d++) {
			const date = dates[d];

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
				`Rules should succeed for day ${d + 1} (${date})`,
			).toBe(0);
		}

		// Check the last day (day 6, Tue) for weekly OT.
		// Because the week reset on day 4, the new week only has
		// 3 days x 8 hrs = 24 hrs, which is under the threshold.
		const tcls = await getResultTCLs(lastTcdId);

		console.log(`Results for last day (${dates[dates.length - 1]}):`);
		for (const r of tcls.billable) {
			console.log(
				`  Bill: ${r.time_in}-${r.time_out} isOTWeekly=${r.isOTWeekly} ` +
					`isOTDailyL1=${r.isOTDailyL1} isOTDailyL2=${r.isOTDailyL2}`,
			);
		}
		for (const r of tcls.payable) {
			console.log(
				`  Pay:  ${r.time_in}-${r.time_out} isOTWeekly=${r.isOTWeekly} ` +
					`isOTDailyL1=${r.isOTDailyL1} isOTDailyL2=${r.isOTDailyL2}`,
			);
		}

		const weeklyOTBill = tcls.billable.filter(
			(r) => r.isOTWeekly === 1,
		);

		expect(
			weeklyOTBill.length,
			`After week boundary reset on ${startOfWeek}, the new week only has ` +
				`24 hrs (3 days x 8). Weekly OT threshold is ${hrsWeekly} hrs. ` +
				"No weekly OT entries should exist on the last day.",
		).toBe(0);
	});
});
