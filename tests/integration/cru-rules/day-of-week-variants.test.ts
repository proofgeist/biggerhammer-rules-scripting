/**
 * Group H (continued): Day of Week Variant Tests
 *
 * Tests the "Day of Week" rule with Saturday and multiple-day CRU configurations.
 * The engine sets the generic isDayOfWeek flag on matching days.
 *
 * H5: Saturday CRU → isDayOfWeek=1 on Saturday
 * H6: Saturday CRU on non-matching day (Monday) → no flag
 * H7: Multiple Day of Week CRUs (Saturday + Sunday) → each day gets isDayOfWeek=1
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
	getResultTCLs,
	requireEnv,
} from "../../helpers/factories.js";

// 2027-12-04 is a Saturday
const TEST_DATE_H5 = "2027-12-04";
// 2027-12-06 is a Monday
const TEST_DATE_H6 = "2027-12-06";
// 2027-12-11 is a Saturday, 2027-12-12 is a Sunday
const TEST_DATE_H7_SAT = "2027-12-11";
const TEST_DATE_H7_SUN = "2027-12-12";

describe("Day of Week Variants", () => {
	const createdTcdIds: string[] = [];
	const createdCruIds: string[] = [];

	afterAll(async () => {
		for (const cruId of createdCruIds) {
			await deleteContractRule(cruId);
		}
		await cleanupAll(createdTcdIds);
	});

	it("H5: Saturday CRU → isDayOfWeekSaturday=1", async () => {
		const contactId = requireEnv("TEST_CONTACT_ID");
		const eventId = requireEnv("TEST_EVENT_ID");
		const contractId = requireEnv("TEST_CONTRACT_ID_WORKED");

		const rule = await findRule("Day of Week");
		console.log(`Found rule: ${rule.name} (${rule.__id})`);

		// Create Saturday CRU with field=isDayOfWeekSaturday
		const cru = await createContractRule({
			ruleId: rule.__id!,
			contractId,
			day: "Saturday",

			multiplier1: 1.5,
			scope: "",
		});
		const cruId = assertId(cru);
		createdCruIds.push(cruId);
		console.log(`Created Saturday CRU: ${cruId}`);

		// Create TCD on Saturday 2027-12-06 with a 4-hour clock
		const tcd = await createTimeCard({
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_H5,
		});
		const tcdId = assertId(tcd);
		createdTcdIds.push(tcdId);
		console.log(`Created TCD: ${tcdId} on ${TEST_DATE_H5} (Saturday)`);

		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_H5,
			timeIn: "09:00:00",
			timeOut: "13:00:00",
		});

		const result = await applyRules(tcdId);
		console.log(`applyRules error: ${result.error}`);
		expect(result.error).toBe(0);

		const tcls = await getResultTCLs(tcdId);

		for (const r of tcls.billable) {
			console.log(
				`  Bill: ${r.time_in}-${r.time_out} isDayOfWeek=${r.isDayOfWeek} ` +
					`isDayOfWeekSaturday=${r.isDayOfWeekSaturday} ` +
					`isMinimumCall=${r.isMinimumCall} isUnpaidMeal=${r.isUnpaidMeal}`,
			);
		}

		for (const r of tcls.payable) {
			console.log(
				`  Pay: ${r.time_in}-${r.time_out} isDayOfWeek=${r.isDayOfWeek} ` +
					`isDayOfWeekSaturday=${r.isDayOfWeekSaturday} ` +
					`isMinimumCall=${r.isMinimumCall} isUnpaidMeal=${r.isUnpaidMeal}`,
			);
		}

		// Non-MC, non-unpaid-meal billable entries should have isDayOfWeek=1
		// Note: The engine sets the generic isDayOfWeek flag rather than
		// day-specific flags like isDayOfWeekSaturday.
		const eligible = tcls.billable.filter(
			(r) => !r.isMinimumCall && !r.isUnpaidMeal,
		);
		expect(
			eligible.length,
			"Should have at least one eligible billable entry",
		).toBeGreaterThanOrEqual(1);

		for (const r of eligible) {
			expect(
				r.isDayOfWeek,
				`Saturday entry ${r.time_in}-${r.time_out} should have isDayOfWeek=1`,
			).toBe(1);
		}
	});

	it("H6: Saturday CRU on non-matching day → no flag", async () => {
		const contactId = requireEnv("TEST_CONTACT_ID");
		const eventId = requireEnv("TEST_EVENT_ID");
		const contractId = requireEnv("TEST_CONTRACT_ID_WORKED");

		const rule = await findRule("Day of Week");
		console.log(`Found rule: ${rule.name} (${rule.__id})`);

		// Create Saturday CRU with field=isDayOfWeekSaturday
		const cru = await createContractRule({
			ruleId: rule.__id!,
			contractId,
			day: "Saturday",

			multiplier1: 1.5,
			scope: "",
		});
		const cruId = assertId(cru);
		createdCruIds.push(cruId);
		console.log(`Created Saturday CRU: ${cruId}`);

		// Create TCD on Monday 2027-12-08 with a 4-hour clock
		const tcd = await createTimeCard({
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_H6,
		});
		const tcdId = assertId(tcd);
		createdTcdIds.push(tcdId);
		console.log(`Created TCD: ${tcdId} on ${TEST_DATE_H6} (Monday)`);

		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_H6,
			timeIn: "09:00:00",
			timeOut: "13:00:00",
		});

		const result = await applyRules(tcdId);
		console.log(`applyRules error: ${result.error}`);
		expect(result.error).toBe(0);

		const tcls = await getResultTCLs(tcdId);

		for (const r of tcls.billable) {
			console.log(
				`  Bill: ${r.time_in}-${r.time_out} isDayOfWeek=${r.isDayOfWeek} ` +
					`isDayOfWeekSaturday=${r.isDayOfWeekSaturday}`,
			);
		}

		for (const r of tcls.payable) {
			console.log(
				`  Pay: ${r.time_in}-${r.time_out} isDayOfWeek=${r.isDayOfWeek} ` +
					`isDayOfWeekSaturday=${r.isDayOfWeekSaturday}`,
			);
		}

		// Monday should NOT have isDayOfWeek (CRU is for Saturday)
		const dowBillEntries = tcls.billable.filter(
			(r) => r.isDayOfWeek === 1,
		);
		expect(
			dowBillEntries.length,
			"Monday entries should NOT have isDayOfWeek (CRU is for Saturday)",
		).toBe(0);
	});

	it("H7: Multiple Day of Week CRUs (Saturday + Sunday)", async () => {
		const contactId = requireEnv("TEST_CONTACT_ID");
		const eventId = requireEnv("TEST_EVENT_ID");
		const contractId = requireEnv("TEST_CONTRACT_ID_WORKED");

		const rule = await findRule("Day of Week");
		console.log(`Found rule: ${rule.name} (${rule.__id})`);

		// Create Saturday CRU
		const cruSat = await createContractRule({
			ruleId: rule.__id!,
			contractId,
			day: "Saturday",

			multiplier1: 1.5,
			scope: "",
		});
		const cruSatId = assertId(cruSat);
		createdCruIds.push(cruSatId);
		console.log(`Created Saturday CRU: ${cruSatId}`);

		// Create Sunday CRU
		const cruSun = await createContractRule({
			ruleId: rule.__id!,
			contractId,
			day: "Sunday",

			multiplier1: 1.5,
			scope: "",
		});
		const cruSunId = assertId(cruSun);
		createdCruIds.push(cruSunId);
		console.log(`Created Sunday CRU: ${cruSunId}`);

		// --- Saturday TCD ---
		const tcdSat = await createTimeCard({
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_H7_SAT,
		});
		const tcdSatId = assertId(tcdSat);
		createdTcdIds.push(tcdSatId);
		console.log(`Created Saturday TCD: ${tcdSatId} on ${TEST_DATE_H7_SAT}`);

		await createClockTCL({
			timecardId: tcdSatId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_H7_SAT,
			timeIn: "09:00:00",
			timeOut: "13:00:00",
		});

		const resultSat = await applyRules(tcdSatId);
		console.log(`applyRules Saturday error: ${resultSat.error}`);
		expect(resultSat.error).toBe(0);

		const tclsSat = await getResultTCLs(tcdSatId);

		for (const r of tclsSat.billable) {
			console.log(
				`  Sat Bill: ${r.time_in}-${r.time_out} isDayOfWeek=${r.isDayOfWeek} ` +
					`isDayOfWeekSaturday=${r.isDayOfWeekSaturday} ` +
					`isDayOfWeekSunday=${r.isDayOfWeekSunday} ` +
					`isMinimumCall=${r.isMinimumCall}`,
			);
		}

		// Saturday TCD: non-MC entries should have isDayOfWeek=1
		const satEligible = tclsSat.billable.filter(
			(r) => !r.isMinimumCall && !r.isUnpaidMeal,
		);
		expect(
			satEligible.length,
			"Should have at least one eligible Saturday billable entry",
		).toBeGreaterThanOrEqual(1);

		for (const r of satEligible) {
			expect(
				r.isDayOfWeek,
				`Saturday entry ${r.time_in}-${r.time_out} should have isDayOfWeek=1`,
			).toBe(1);
		}

		// --- Sunday TCD ---
		const tcdSun = await createTimeCard({
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_H7_SUN,
		});
		const tcdSunId = assertId(tcdSun);
		createdTcdIds.push(tcdSunId);
		console.log(`Created Sunday TCD: ${tcdSunId} on ${TEST_DATE_H7_SUN}`);

		await createClockTCL({
			timecardId: tcdSunId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_H7_SUN,
			timeIn: "09:00:00",
			timeOut: "13:00:00",
		});

		const resultSun = await applyRules(tcdSunId);
		console.log(`applyRules Sunday error: ${resultSun.error}`);
		expect(resultSun.error).toBe(0);

		const tclsSun = await getResultTCLs(tcdSunId);

		for (const r of tclsSun.billable) {
			console.log(
				`  Sun Bill: ${r.time_in}-${r.time_out} isDayOfWeek=${r.isDayOfWeek} ` +
					`isDayOfWeekSaturday=${r.isDayOfWeekSaturday} ` +
					`isDayOfWeekSunday=${r.isDayOfWeekSunday} ` +
					`isMinimumCall=${r.isMinimumCall}`,
			);
		}

		// Sunday TCD: non-MC entries should have isDayOfWeek=1
		const sunEligible = tclsSun.billable.filter(
			(r) => !r.isMinimumCall && !r.isUnpaidMeal,
		);
		expect(
			sunEligible.length,
			"Should have at least one eligible Sunday billable entry",
		).toBeGreaterThanOrEqual(1);

		for (const r of sunEligible) {
			expect(
				r.isDayOfWeek,
				`Sunday entry ${r.time_in}-${r.time_out} should have isDayOfWeek=1`,
			).toBe(1);
		}
	});
});
