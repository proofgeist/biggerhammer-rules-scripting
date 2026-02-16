/**
 * Group D: Before/After Unpaid Meal Edge Cases
 *
 * Tests edge cases in the B/A rule that aren't covered by existing tests.
 *
 * Bug 1 verification (D1): Part 3 checks `$since_unpaid_meal` to decide if
 * shortfall exists, but computes the shortfall from `$since_last_meal`. These
 * diverge when a paid meal occurs after the unpaid meal.
 *
 * Bug 5 verification (D4): MC unworked credit is added to `$since_last_meal`
 * once at initialization. When the bucket resets at a gap, the credit is lost.
 * Multi-gap timecards may get redundant B/A entries.
 *
 * D2: Boundary test for gap == max_meal_break.
 * D3: Multiple meals in one timecard to test between-meal logic.
 */

import { afterAll, describe, expect, it } from "vitest";
import { cleanupAll } from "../helpers/cleanup.js";
import {
	applyRules,
	assertId,
	createClockTCL,
	createMealTCL,
	createTimeCard,
	getContract,
	getResultTCLs,
	parseTimeToHours,
	requireEnv,
} from "../helpers/factories.js";

const TEST_DATE_D1 = "2026-05-05";
const TEST_DATE_D2 = "2026-06-05";
const TEST_DATE_D3 = "2026-07-05";
const TEST_DATE_D4 = "2026-08-05";

describe("B/A Edge Cases", () => {
	const createdTcdIds: string[] = [];

	afterAll(async () => {
		await cleanupAll(createdTcdIds);
	});

	it("D1: should correctly compute after-meal shortfall when paid meal follows unpaid meal (Bug 1)", async () => {
		const contactId = requireEnv("TEST_CONTACT_ID");
		const eventId = requireEnv("TEST_EVENT_ID");
		const contractId = requireEnv("TEST_CONTRACT_ID_WORKED");

		const contract = await getContract(contractId);
		const hrsBefore = contract.hrs_before_unpaid_meal ?? 0;
		const hrsAfter = contract.hrs_after_unpaid_meal ?? 0;
		const hrsMax = contract.hrs_meal_break_max ?? 24;

		console.log(
			`Contract: before=${hrsBefore}, after=${hrsAfter}, max=${hrsMax}, ` +
				`minimums_worked=${contract.minimums_are_worked_time}`,
		);

		if (hrsAfter <= 0) {
			console.warn(
				"Skipping D1: hrs_after_unpaid_meal not configured on this contract.",
			);
			return;
		}

		if (hrsAfter <= 0.5) {
			console.warn(
				`Skipping D1: hrs_after_unpaid_meal (${hrsAfter}) <= 0.5. ` +
					`Cannot test shortfall with 0.5 hrs of post-meal work.`,
			);
			return;
		}

		const tcd = await createTimeCard({
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_D1,
		});
		const tcdId = assertId(tcd);
		createdTcdIds.push(tcdId);

		// Clock 1: 5+ hours — satisfies before-meal requirement
		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_D1,
			timeIn: "09:00:00",
			timeOut: "14:00:00",
		});

		// [Unpaid meal gap: 14:00-15:00, 1 hour]

		// Clock 2: 0.25 hrs after unpaid meal
		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_D1,
			timeIn: "15:00:00",
			timeOut: "15:15:00",
		});

		// Paid meal: 15:15 - 15:30 — this resets $since_last_meal but NOT $since_unpaid_meal
		await createMealTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_D1,
			timeIn: "15:15:00",
			timeOut: "15:30:00",
			isPaidMeal: true,
		});

		// Clock 3: 0.25 hrs after paid meal
		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_D1,
			timeIn: "15:30:00",
			timeOut: "15:45:00",
		});

		const result = await applyRules(tcdId);
		expect(result.error).toBe(0);

		const tcls = await getResultTCLs(tcdId);

		for (const r of tcls.all) {
			if (r._timecardline_id || r.noteRule) {
				console.log(
					`  Generated TCL: ${r.time_in}-${r.time_out} noteRule="${r.noteRule ?? ""}" ` +
						`isBill=${r.isBill} isPay=${r.isPay} hrsUnworked=${r.hrsUnworked}`,
				);
			}
		}

		// Total time after unpaid meal:
		//   Clock 2: 0.25 hrs + Paid Meal: 0.25 hrs + Clock 3: 0.25 hrs = 0.75 hrs
		// $since_unpaid_meal accumulates ALL TCL durations (including paid meals)
		// so it should be 0.75 at Part 3.
		// $since_last_meal resets at paid meal, so it would be only 0.25 at Part 3.
		//
		// CORRECT shortfall (using $since_unpaid_meal): hrsAfter - 0.75
		// BUG shortfall (using $since_last_meal):       hrsAfter - 0.25

		const afterMealEntries = tcls.all.filter((r) => {
			if (!r.noteRule) return false;
			return r.noteRule.toLowerCase().includes("after unpaid meal");
		});

		console.log(`  After-meal entries found: ${afterMealEntries.length}`);

		if (afterMealEntries.length > 0) {
			for (const entry of afterMealEntries) {
				if (entry.time_in && entry.time_out) {
					let inHrs = parseTimeToHours(entry.time_in);
					let outHrs = parseTimeToHours(entry.time_out);
					if (outHrs < inHrs) outHrs += 24;
					const duration = outHrs - inHrs;

					// Correct: hrsAfter - 0.75 (all time since unpaid meal, incl. paid meal)
					// Buggy:   hrsAfter - 0.25 (only time since paid meal reset)
					const correctShortfall = hrsAfter - 0.75;
					const bugShortfall = hrsAfter - 0.25;

					console.log(
						`  After-meal entry duration: ${duration} hrs ` +
							`(correct=${correctShortfall}, bug=${bugShortfall})`,
					);

					if (Math.abs(duration - bugShortfall) < 0.1) {
						console.warn(
							"BUG 1 PRESENT: After-meal shortfall uses $since_last_meal " +
								`instead of $since_unpaid_meal. Duration=${duration}, ` +
								`expected=${correctShortfall}, got=${bugShortfall}`,
						);
					}

					expect(
						duration,
						`After-meal shortfall should be ~${correctShortfall} hrs ` +
							`(hrsAfter=${hrsAfter} - 0.75 hrs since unpaid meal). ` +
							`If ${bugShortfall}, Bug 1 ($since_last_meal) is present.`,
					).toBeCloseTo(correctShortfall, 1);
				}
			}
		} else if (hrsAfter > 0.75) {
			// If no after-meal entries exist but the rule requires > 0.5 hrs,
			// something else might be preventing Part 3 from firing
			console.warn(
				"No after-meal entries found. Part 3 may not have fired. " +
					"Check if Minimum Call took precedence.",
			);
		}
	});

	it("D2: should handle gap exactly equal to max_meal_break (boundary test)", async () => {
		const contactId = requireEnv("TEST_CONTACT_ID");
		const eventId = requireEnv("TEST_EVENT_ID");
		const contractId = requireEnv("TEST_CONTRACT_ID_WORKED");

		const contract = await getContract(contractId);
		const hrsBefore = contract.hrs_before_unpaid_meal ?? 0;
		const hrsMax = contract.hrs_meal_break_max ?? 24;

		console.log(
			`Contract: before=${hrsBefore}, max_meal_break=${hrsMax}`,
		);

		if (hrsBefore <= 0) {
			console.warn(
				"Skipping D2: hrs_before_unpaid_meal not configured.",
			);
			return;
		}

		if (hrsMax >= 24) {
			console.warn(
				"Skipping D2: hrs_meal_break_max not configured (or set to 24).",
			);
			return;
		}

		const tcd = await createTimeCard({
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_D2,
		});
		const tcdId = assertId(tcd);
		createdTcdIds.push(tcdId);

		// Clock 1: short work (< before-meal requirement)
		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_D2,
			timeIn: "09:00:00",
			timeOut: "10:00:00",
		});

		// Clock 2: starts exactly hrs_meal_break_max later
		// The B/A script checks `> $hrs_meal_break_max` (strict greater-than)
		// so exactly-equal should still be treated as a meal break, not a new call.
		const gapSeconds = hrsMax * 3600;
		const clock2InSeconds = 10 * 3600 + gapSeconds;
		const clock2InHrs = Math.floor(clock2InSeconds / 3600);
		const clock2InMins = Math.floor((clock2InSeconds % 3600) / 60);
		const clock2InSecs = clock2InSeconds % 60;
		const clock2In = `${String(clock2InHrs).padStart(2, "0")}:${String(clock2InMins).padStart(2, "0")}:${String(clock2InSecs).padStart(2, "0")}`;

		// Make sure Clock 2 starts before 24:00
		if (clock2InHrs >= 24) {
			console.warn(
				`Skipping D2: Clock 2 would start at ${clock2In} (>= 24:00).`,
			);
			return;
		}

		const clock2OutHrs = clock2InHrs + 4;
		if (clock2OutHrs >= 24) {
			console.warn(
				`Skipping D2: Clock 2 would end at ${clock2OutHrs}:00 (>= 24:00).`,
			);
			return;
		}
		const clock2Out = `${String(clock2OutHrs).padStart(2, "0")}:${String(clock2InMins).padStart(2, "0")}:${String(clock2InSecs).padStart(2, "0")}`;

		console.log(
			`Clock 2: ${clock2In} - ${clock2Out} (gap exactly ${hrsMax} hrs)`,
		);

		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_D2,
			timeIn: clock2In,
			timeOut: clock2Out,
		});

		const result = await applyRules(tcdId);
		expect(result.error).toBe(0);

		const tcls = await getResultTCLs(tcdId);

		for (const r of tcls.all) {
			if (r._timecardline_id || r.noteRule) {
				console.log(
					`  TCL: ${r.time_in}-${r.time_out} noteRule="${r.noteRule ?? ""}" ` +
						`isBill=${r.isBill} hrsUnworked=${r.hrsUnworked}`,
				);
			}
		}

		// At gap == max_meal_break, the script uses `> $hrs_meal_break_max`,
		// so this gap should NOT trigger the "new call" branch.
		// B/A before-meal rule should fire since employee only worked 1 hr (< before-meal req).
		const beforeMealEntries = tcls.all.filter((r) => {
			if (!r.noteRule) return false;
			return r.noteRule.toLowerCase().includes("before unpaid meal");
		});

		console.log(
			`  Before-meal entries: ${beforeMealEntries.length} ` +
				`(expected: > 0 if gap treated as meal, 0 if treated as new call)`,
		);

		// Document the boundary behavior
		if (beforeMealEntries.length > 0) {
			console.log(
				"  RESULT: Gap exactly at max_meal_break IS treated as a meal break (B/A fires).",
			);
		} else {
			console.log(
				"  RESULT: Gap exactly at max_meal_break is treated as a new call (B/A does NOT fire).",
			);
		}

		// The script uses strict `>`, so exactly-equal SHOULD be treated as a meal break
		expect(
			beforeMealEntries.length,
			`Gap exactly equal to max_meal_break (${hrsMax} hrs) should be treated as a meal break. ` +
				`B/A before-meal rule should fire since employee only worked 1 hr.`,
		).toBeGreaterThan(0);
	});

	it("D3: should apply B/A shortfall at multiple meals in one timecard", async () => {
		const contactId = requireEnv("TEST_CONTACT_ID");
		const eventId = requireEnv("TEST_EVENT_ID");
		const contractId = requireEnv("TEST_CONTRACT_ID_WORKED");

		const contract = await getContract(contractId);
		const hrsBefore = contract.hrs_before_unpaid_meal ?? 0;
		const hrsAfter = contract.hrs_after_unpaid_meal ?? 0;
		const hrsMax = contract.hrs_meal_break_max ?? 24;
		const hrsBetween = Math.min(hrsBefore, hrsAfter) || Math.max(hrsBefore, hrsAfter);

		console.log(
			`Contract: before=${hrsBefore}, after=${hrsAfter}, between=${hrsBetween}, max=${hrsMax}`,
		);

		if (hrsBefore <= 0) {
			console.warn("Skipping D3: hrs_before_unpaid_meal not configured.");
			return;
		}

		// We need short enough work segments to trigger shortfalls at both gaps
		if (hrsBefore <= 1) {
			console.warn(
				`Skipping D3: hrs_before_unpaid_meal (${hrsBefore}) <= 1. ` +
					`Cannot test with 1-hr work segments.`,
			);
			return;
		}

		const tcd = await createTimeCard({
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_D3,
		});
		const tcdId = assertId(tcd);
		createdTcdIds.push(tcdId);

		// Clock 1: 1 hour (< before-meal requirement)
		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_D3,
			timeIn: "08:00:00",
			timeOut: "09:00:00",
		});

		// [Gap 1: 1-hour meal break — 09:00 to 10:00]

		// Clock 2: 1 hour (< between-meal requirement)
		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_D3,
			timeIn: "10:00:00",
			timeOut: "11:00:00",
		});

		// [Gap 2: 1-hour meal break — 11:00 to 12:00]

		// Clock 3: 2 hours
		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_D3,
			timeIn: "12:00:00",
			timeOut: "14:00:00",
		});

		const result = await applyRules(tcdId);
		expect(result.error).toBe(0);

		const tcls = await getResultTCLs(tcdId);

		for (const r of tcls.all) {
			if (r._timecardline_id || r.noteRule) {
				console.log(
					`  TCL: ${r.time_in}-${r.time_out} noteRule="${r.noteRule ?? ""}" ` +
						`isBill=${r.isBill} hrsUnworked=${r.hrsUnworked}`,
				);
			}
		}

		// Count B/A entries
		const baEntries = tcls.all.filter((r) => {
			if (!r.noteRule) return false;
			return (
				r.noteRule.toLowerCase().includes("before unpaid meal") ||
				r.noteRule.toLowerCase().includes("after unpaid meal")
			);
		});

		console.log(`  Total B/A entries: ${baEntries.length}`);

		// At first gap (09:00-10:00): employee worked 1 hr, needs hrsBefore.
		// Shortfall: hrsBefore - 1
		// At second gap (11:00-12:00): employee worked 1 hr since last meal,
		// needs hrsBetween. Shortfall: hrsBetween - 1
		//
		// Both gaps should produce shortfall entries
		expect(
			baEntries.length,
			`Expected B/A shortfall entries at both meal gaps. ` +
				`Gap 1 shortfall: ${hrsBefore - 1} hrs, Gap 2 shortfall: ${hrsBetween - 1} hrs.`,
		).toBeGreaterThanOrEqual(2);

		// All 3 clocks should also produce billable entries
		expect(tcls.billable.length).toBeGreaterThanOrEqual(3);
	});

	it("D4: should not double-count MC credits across multiple gaps on unworked contract (Bug 5)", async () => {
		const contractId = process.env.TEST_CONTRACT_ID_UNWORKED;
		if (!contractId) {
			console.warn(
				"Skipping D4: TEST_CONTRACT_ID_UNWORKED not configured.",
			);
			return;
		}

		const contactId = requireEnv("TEST_CONTACT_ID");
		const eventId = requireEnv("TEST_EVENT_ID");

		const contract = await getContract(contractId);
		const hrsMinCall = contract.hrs_minimum_call ?? 0;
		const hrsMax = contract.hrs_meal_break_max ?? 24;
		const hrsBefore = contract.hrs_before_unpaid_meal ?? 0;

		console.log(
			`Contract: minCall=${hrsMinCall}, max=${hrsMax}, before=${hrsBefore}, ` +
				`minimums_worked=${contract.minimums_are_worked_time}`,
		);

		if (hrsMinCall <= 0) {
			console.warn("Skipping D4: hrs_minimum_call not configured.");
			return;
		}

		if (hrsMax >= 5) {
			console.warn(
				`Skipping D4: hrs_meal_break_max (${hrsMax}) too large to create a gap > max within a day.`,
			);
			return;
		}

		const tcd = await createTimeCard({
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_D4,
		});
		const tcdId = assertId(tcd);
		createdTcdIds.push(tcdId);

		// Clock 1: very short (0.5 hrs, < minimum) → MC creates entry for gap 1
		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_D4,
			timeIn: "09:00:00",
			timeOut: "09:30:00",
		});

		// Gap > max_meal_break → new call boundary
		const gap1End = 9.5 + hrsMax + 1; // 1 hour more than max
		const gap1EndHrs = Math.floor(gap1End);
		const gap1EndMins = Math.round((gap1End - gap1EndHrs) * 60);
		const clock2In = `${String(gap1EndHrs).padStart(2, "0")}:${String(gap1EndMins).padStart(2, "0")}:00`;

		// Clock 2: also short (0.5 hrs, < minimum) → MC should create entry for gap 2
		const clock2OutHrs = gap1EndHrs;
		const clock2OutMins = gap1EndMins + 30;
		let finalOutHrs = clock2OutHrs;
		let finalOutMins = clock2OutMins;
		if (finalOutMins >= 60) {
			finalOutHrs += 1;
			finalOutMins -= 60;
		}
		const clock2Out = `${String(finalOutHrs).padStart(2, "0")}:${String(finalOutMins).padStart(2, "0")}:00`;

		if (finalOutHrs >= 24) {
			console.warn("Skipping D4: Clock 2 would end past midnight.");
			return;
		}

		console.log(`Clock 2: ${clock2In} - ${clock2Out}`);

		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_D4,
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

		// Count MC unworked entries
		const mcEntries = tcls.unworked.filter((r) => r.isMinimumCall === 1);
		console.log(`  MC unworked entries: ${mcEntries.length}`);

		// Both calls are under minimum, so MC should fire for both
		// On an unworked contract, these go to $$unwork[]
		expect(
			mcEntries.length,
			"Both short calls should have MC unworked entries",
		).toBeGreaterThanOrEqual(2);

		// Now check for B/A entries — they should NOT double-count MC credits
		const baEntries = tcls.all.filter((r) => {
			if (!r.noteRule) return false;
			return (
				r.noteRule.toLowerCase().includes("before unpaid meal") ||
				r.noteRule.toLowerCase().includes("after unpaid meal")
			);
		});

		// Calculate total unworked hours
		let totalUnworkedHrs = 0;
		for (const r of tcls.unworked) {
			if (r.hrsUnworked) {
				totalUnworkedHrs += parseTimeToHours(r.hrsUnworked);
			}
		}

		console.log(
			`  Total unworked hours: ${totalUnworkedHrs}, B/A entries: ${baEntries.length}`,
		);

		// The total unworked should not exceed: MC shortfall for call 1 + MC shortfall for call 2
		// Each MC shortfall = minimum - 0.5
		const maxExpectedUnworked = (hrsMinCall - 0.5) * 2;
		expect(
			totalUnworkedHrs,
			`Total unworked hours (${totalUnworkedHrs}) should not exceed ` +
				`2 x (minimum - 0.5) = ${maxExpectedUnworked}. ` +
				`If it does, Bug 5 (double-counting) may be present.`,
		).toBeLessThanOrEqual(maxExpectedUnworked + 0.1);
	});
});
