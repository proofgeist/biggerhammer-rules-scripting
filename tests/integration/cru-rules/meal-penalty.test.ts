/**
 * Group I: Meal Penalty Tests
 *
 * Tests Meal Penalty (limited v2) rule, triggered via CRU.
 *
 * IMPORTANT naming note: The orchestrator dispatches v2 on CRU name
 * "Meal Penalty (definitive)", but the v2 script internally reads CRU
 * records with $rule_name = "Meal Penalty (limited)". This test logs
 * available rule names and uses whichever exists.
 *
 * I1: Long shift with no break → penalty fires (isMP1=1)
 * I2: Break within threshold → no penalty
 * I3: Short gap (< hrs_meal_break_min) doesn't reset clock → penalty fires
 */

import { afterAll, describe, expect, it } from "vitest";
import { cleanupAll } from "../../helpers/cleanup.js";
import {
	applyRules,
	assertId,
	createClockTCL,
	createContractRule,
	createTimeCard,
	deleteContractRule,
	findRule,
	getContract,
	getResultTCLs,
	requireEnv,
} from "../../helpers/factories.js";

const TEST_DATE_I1 = "2027-03-01";
const TEST_DATE_I2 = "2027-03-02";
const TEST_DATE_I3 = "2027-03-03";

describe("Meal Penalty", () => {
	const createdTcdIds: string[] = [];
	const createdCruIds: string[] = [];
	let mealPenaltyRuleId: string | null = null;

	afterAll(async () => {
		for (const cruId of createdCruIds) {
			await deleteContractRule(cruId);
		}
		await cleanupAll(createdTcdIds);
	});

	async function findMealPenaltyRule(): Promise<string> {
		if (mealPenaltyRuleId) return mealPenaltyRuleId;

		// Try both known names
		const names = [
			"Meal Penalty (limited)",
			"Meal Penalty (definitive)",
			"Meal Penalty",
		];

		for (const name of names) {
			try {
				const rule = await findRule(name);
				console.log(
					`Found meal penalty rule: "${rule.name}" (${rule.__id})`,
				);
				mealPenaltyRuleId = rule.__id!;
				return mealPenaltyRuleId;
			} catch {
				console.log(`Rule "${name}" not found, trying next...`);
			}
		}

		throw new Error(
			`No meal penalty rule found. Tried: ${names.join(", ")}`,
		);
	}

	it("I1: long shift with no break → penalty fires (isMP1=1)", async () => {
		const contactId = requireEnv("TEST_CONTACT_ID");
		const eventId = requireEnv("TEST_EVENT_ID");
		const contractId = requireEnv("TEST_CONTRACT_ID_WORKED");

		const ruleId = await findMealPenaltyRule();

		const contract = await getContract(contractId);
		const mealBreakMin = contract.hrs_meal_break_min ?? 0.5;

		// Create CRU: penalty fires after 6 hours without break, penalty = 1 hour
		const cru = await createContractRule({
			ruleId,
			contractId,
			hour1: 6,
			hour2: 1,
			scope: "",
		});
		const cruId = assertId(cru);
		createdCruIds.push(cruId);

		console.log(
			`Created Meal Penalty CRU: hour1=6, hour2=1, meal_break_min=${mealBreakMin}`,
		);

		const tcd = await createTimeCard({
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_I1,
		});
		const tcdId = assertId(tcd);
		createdTcdIds.push(tcdId);

		// 7 hours straight with no break
		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_I1,
			timeIn: "08:00:00",
			timeOut: "15:00:00",
		});

		const result = await applyRules(tcdId);
		expect(result.error).toBe(0);

		const tcls = await getResultTCLs(tcdId);

		for (const r of tcls.all) {
			console.log(
				`  TCL: ${r.time_in}-${r.time_out} isBill=${r.isBill} isPay=${r.isPay} ` +
					`isMP1=${r.isMP1} isMP2=${r.isMP2} hrsUnworked=${r.hrsUnworked}`,
			);
		}

		// Should have at least one MP entry (either in unworked or as a flag)
		const mpEntries = tcls.all.filter(
			(r) => r.isMP1 === 1 || r.isMP2 === 1,
		);

		expect(
			mpEntries.length,
			"7-hour shift without break should trigger meal penalty",
		).toBeGreaterThanOrEqual(1);
	});

	it("I2: break within threshold → no penalty", async () => {
		const contactId = requireEnv("TEST_CONTACT_ID");
		const eventId = requireEnv("TEST_EVENT_ID");
		const contractId = requireEnv("TEST_CONTRACT_ID_WORKED");

		const ruleId = await findMealPenaltyRule();

		const contract = await getContract(contractId);
		const mealBreakMin = contract.hrs_meal_break_min ?? 0.5;

		// CRU: penalty after 6 hrs
		const cru = await createContractRule({
			ruleId,
			contractId,
			hour1: 6,
			hour2: 1,
			scope: "",
		});
		const cruId = assertId(cru);
		createdCruIds.push(cruId);

		const tcd = await createTimeCard({
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_I2,
		});
		const tcdId = assertId(tcd);
		createdTcdIds.push(tcdId);

		// 3 hours, then 1-hour break, then 3 hours = 6 hours but with break at 3 hrs
		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_I2,
			timeIn: "08:00:00",
			timeOut: "11:00:00",
		});

		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_I2,
			timeIn: "12:00:00",
			timeOut: "15:00:00",
		});

		const result = await applyRules(tcdId);
		expect(result.error).toBe(0);

		const tcls = await getResultTCLs(tcdId);

		for (const r of tcls.all) {
			console.log(
				`  TCL: ${r.time_in}-${r.time_out} isBill=${r.isBill} isPay=${r.isPay} ` +
					`isMP1=${r.isMP1} hrsUnworked=${r.hrsUnworked}`,
			);
		}

		// No meal penalty should fire — break resets the clock
		const mpEntries = tcls.all.filter(
			(r) => r.isMP1 === 1 || r.isMP2 === 1,
		);

		expect(
			mpEntries.length,
			"Shift with adequate break should NOT trigger meal penalty",
		).toBe(0);
	});

	it("I3: short gap (< meal_break_min) doesn't reset clock → penalty fires", async () => {
		const contactId = requireEnv("TEST_CONTACT_ID");
		const eventId = requireEnv("TEST_EVENT_ID");
		const contractId = requireEnv("TEST_CONTRACT_ID_WORKED");

		const ruleId = await findMealPenaltyRule();

		const contract = await getContract(contractId);
		const mealBreakMin = contract.hrs_meal_break_min ?? 0.5;

		console.log(`Contract: meal_break_min=${mealBreakMin}`);

		if (mealBreakMin <= 0) {
			console.warn(
				"Skipping I3: hrs_meal_break_min not configured.",
			);
			return;
		}

		// CRU: penalty after 6 hrs
		const cru = await createContractRule({
			ruleId,
			contractId,
			hour1: 6,
			hour2: 1,
			scope: "",
		});
		const cruId = assertId(cru);
		createdCruIds.push(cruId);

		const tcd = await createTimeCard({
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_I3,
		});
		const tcdId = assertId(tcd);
		createdTcdIds.push(tcdId);

		// 3.5 hours, then short 15-min gap (< meal_break_min typically), then 3.5 hours
		// Total worked = 7 hours, gap too short to count as meal break
		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_I3,
			timeIn: "08:00:00",
			timeOut: "11:30:00",
		});

		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_I3,
			timeIn: "11:45:00",
			timeOut: "15:15:00",
		});

		const result = await applyRules(tcdId);
		expect(result.error).toBe(0);

		const tcls = await getResultTCLs(tcdId);

		for (const r of tcls.all) {
			console.log(
				`  TCL: ${r.time_in}-${r.time_out} isBill=${r.isBill} isPay=${r.isPay} ` +
					`isMP1=${r.isMP1} hrsUnworked=${r.hrsUnworked}`,
			);
		}

		if (mealBreakMin > 0.25) {
			// 15-min gap < meal_break_min, so it shouldn't reset the clock
			const mpEntries = tcls.all.filter(
				(r) => r.isMP1 === 1 || r.isMP2 === 1,
			);

			expect(
				mpEntries.length,
				`15-min gap < meal_break_min (${mealBreakMin}). ` +
					`Penalty should fire for 7 hrs of continuous work.`,
			).toBeGreaterThanOrEqual(1);
		} else {
			console.log(
				`meal_break_min (${mealBreakMin}) <= 0.25. 15-min gap may count as break.`,
			);
		}
	});
});
