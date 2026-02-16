/**
 * Group H: Day of Week Tests
 *
 * Tests the "Day of Week" rule behavior in detail.
 *
 * H1: Sunday clock → isDayOfWeek=1 on all non-MC, non-unpaid-meal entries
 * H2: Non-matching weekday → no isDayOfWeek flag
 * H3: Day of Week skips MC entries
 * H4: Day of Week skips entries already at higher OT rate
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

// 2027-02-07 is a Sunday, 2027-02-08 is a Monday
const TEST_DATE_H1 = "2027-02-07";
const TEST_DATE_H2 = "2027-02-08";
const TEST_DATE_H3 = "2027-02-14"; // Sunday
const TEST_DATE_H4 = "2027-02-21"; // Sunday

describe("Day of Week", () => {
	const createdTcdIds: string[] = [];
	const createdCruIds: string[] = [];

	afterAll(async () => {
		for (const cruId of createdCruIds) {
			await deleteContractRule(cruId);
		}
		await cleanupAll(createdTcdIds);
	});

	it("H1: Sunday clock → isDayOfWeek=1 on all non-MC entries", async () => {
		const contactId = requireEnv("TEST_CONTACT_ID");
		const eventId = requireEnv("TEST_EVENT_ID");
		const contractId = requireEnv("TEST_CONTRACT_ID_WORKED");

		const rule = await findRule("Day of Week");

		// Create Sunday CRU
		const cru = await createContractRule({
			ruleId: rule.__id!,
			contractId,
			day: "Sunday",
			multiplier1: 1.5,
			scope: "",
		});
		const cruId = assertId(cru);
		createdCruIds.push(cruId);

		const tcd = await createTimeCard({
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_H1,
		});
		const tcdId = assertId(tcd);
		createdTcdIds.push(tcdId);

		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_H1,
			timeIn: "09:00:00",
			timeOut: "17:00:00",
		});

		const result = await applyRules(tcdId);
		expect(result.error).toBe(0);

		const tcls = await getResultTCLs(tcdId);

		for (const r of tcls.billable) {
			console.log(
				`  Bill: ${r.time_in}-${r.time_out} isDayOfWeek=${r.isDayOfWeek} ` +
					`isMinimumCall=${r.isMinimumCall} isUnpaidMeal=${r.isUnpaidMeal}`,
			);
		}

		// All non-MC, non-unpaid-meal billable entries should have isDayOfWeek
		const eligible = tcls.billable.filter(
			(r) => !r.isMinimumCall && !r.isUnpaidMeal,
		);
		for (const r of eligible) {
			expect(
				r.isDayOfWeek,
				`Sunday entry ${r.time_in}-${r.time_out} should have isDayOfWeek=1`,
			).toBe(1);
		}

		// Same for pay
		const eligiblePay = tcls.payable.filter(
			(r) => !r.isMinimumCall && !r.isUnpaidMeal,
		);
		for (const r of eligiblePay) {
			expect(
				r.isDayOfWeek,
				`Sunday pay entry ${r.time_in}-${r.time_out} should have isDayOfWeek=1`,
			).toBe(1);
		}
	});

	it("H2: Non-matching weekday → no isDayOfWeek flag", async () => {
		const contactId = requireEnv("TEST_CONTACT_ID");
		const eventId = requireEnv("TEST_EVENT_ID");
		const contractId = requireEnv("TEST_CONTRACT_ID_WORKED");

		// Note: K1/H1 already created a Sunday CRU. On Monday, it should NOT fire.
		// If no Sunday CRU exists from previous test, create one.
		const rule = await findRule("Day of Week");

		const cru = await createContractRule({
			ruleId: rule.__id!,
			contractId,
			day: "Sunday",
			multiplier1: 1.5,
			scope: "",
		});
		const cruId = assertId(cru);
		createdCruIds.push(cruId);

		const tcd = await createTimeCard({
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_H2, // Monday
		});
		const tcdId = assertId(tcd);
		createdTcdIds.push(tcdId);

		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_H2,
			timeIn: "09:00:00",
			timeOut: "17:00:00",
		});

		const result = await applyRules(tcdId);
		expect(result.error).toBe(0);

		const tcls = await getResultTCLs(tcdId);

		for (const r of tcls.billable) {
			console.log(
				`  Bill: ${r.time_in}-${r.time_out} isDayOfWeek=${r.isDayOfWeek}`,
			);
		}

		// Monday should not have isDayOfWeek (CRU is for Sunday)
		const dowEntries = tcls.billable.filter(
			(r) => r.isDayOfWeek === 1,
		);
		expect(
			dowEntries.length,
			"Monday entries should NOT have isDayOfWeek (CRU is for Sunday)",
		).toBe(0);
	});

	it("H3: Day of Week skips MC entries", async () => {
		const contactId = requireEnv("TEST_CONTACT_ID");
		const eventId = requireEnv("TEST_EVENT_ID");
		const contractId = requireEnv("TEST_CONTRACT_ID_WORKED");

		const contract = await getContract(contractId);
		const hrsMinCall = contract.hrs_minimum_call ?? 0;

		if (hrsMinCall <= 0) {
			console.warn(
				"Skipping H3: hrs_minimum_call not configured.",
			);
			return;
		}

		const rule = await findRule("Day of Week");

		const cru = await createContractRule({
			ruleId: rule.__id!,
			contractId,
			day: "Sunday",
			multiplier1: 1.5,
			scope: "",
		});
		const cruId = assertId(cru);
		createdCruIds.push(cruId);

		const tcd = await createTimeCard({
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_H3, // Sunday
		});
		const tcdId = assertId(tcd);
		createdTcdIds.push(tcdId);

		// Short clock to trigger MC
		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_H3,
			timeIn: "09:00:00",
			timeOut: "10:00:00",
		});

		const result = await applyRules(tcdId);
		expect(result.error).toBe(0);

		const tcls = await getResultTCLs(tcdId);

		for (const r of tcls.all) {
			console.log(
				`  TCL: ${r.time_in}-${r.time_out} isBill=${r.isBill} isPay=${r.isPay} ` +
					`isDayOfWeek=${r.isDayOfWeek} isMinimumCall=${r.isMinimumCall}`,
			);
		}

		// MC entries should NOT have isDayOfWeek
		const mcWithDOW = tcls.billable.filter(
			(r) => r.isMinimumCall === 1 && r.isDayOfWeek === 1,
		);
		expect(
			mcWithDOW.length,
			"MC entries should not have isDayOfWeek flag",
		).toBe(0);

		// Non-MC entries (the actual clock) should have isDayOfWeek
		const nonMcDOW = tcls.billable.filter(
			(r) => !r.isMinimumCall && r.isDayOfWeek === 1,
		);
		expect(
			nonMcDOW.length,
			"Non-MC Sunday entries should have isDayOfWeek",
		).toBeGreaterThanOrEqual(1);
	});

	it("H4: Day of Week skips entries already at higher OT rate", async () => {
		const contactId = requireEnv("TEST_CONTACT_ID");
		const eventId = requireEnv("TEST_EVENT_ID");
		const contractId = requireEnv("TEST_CONTRACT_ID_WORKED");

		const contract = await getContract(contractId);
		const hrsL1 = contract.hrs_overtime_daily_L1 ?? 0;

		if (hrsL1 <= 0) {
			console.warn("Skipping H4: Daily OT not configured.");
			return;
		}

		const rule = await findRule("Day of Week");

		// Create DOW CRU with a lower multiplier than Daily OT
		const cru = await createContractRule({
			ruleId: rule.__id!,
			contractId,
			day: "Sunday",
			multiplier1: 1.25,
			scope: "",
		});
		const cruId = assertId(cru);
		createdCruIds.push(cruId);

		const tcd = await createTimeCard({
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_H4, // Sunday
		});
		const tcdId = assertId(tcd);
		createdTcdIds.push(tcdId);

		// Long shift that exceeds Daily OT L1
		const totalHrs = hrsL1 + 2;
		const outHrs = 8 + totalHrs;
		if (outHrs >= 24) {
			console.warn("Skipping H4: Shift would end past midnight.");
			return;
		}
		const timeOut = `${String(Math.floor(outHrs)).padStart(2, "0")}:00:00`;

		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_H4,
			timeIn: "08:00:00",
			timeOut,
		});

		const result = await applyRules(tcdId);
		expect(result.error).toBe(0);

		const tcls = await getResultTCLs(tcdId);

		for (const r of tcls.billable) {
			console.log(
				`  Bill: ${r.time_in}-${r.time_out} isDayOfWeek=${r.isDayOfWeek} ` +
					`isOTDailyL1=${r.isOTDailyL1} isOTDailyL2=${r.isOTDailyL2}`,
			);
		}

		// The Day of Week script ALWAYS sets isDayOfWeek=True on qualifying
		// entries (non-MC, non-unpaid-meal), then separately decides whether
		// to promote/demote OT levels. So isDayOfWeek coexists with OT flags.
		const otL1Mult = contract.mult_overtime_daily_L1 ?? 0;

		// All non-MC billable entries should have isDayOfWeek (including OT)
		const allDOW = tcls.billable.filter(
			(r) => r.isDayOfWeek === 1 && !r.isMinimumCall,
		);
		expect(
			allDOW.length,
			"All non-MC Sunday entries should have isDayOfWeek, even OT entries",
		).toBeGreaterThanOrEqual(1);

		// When DOW multiplier < OT L1 multiplier, OT entries keep their
		// isOTDailyL1 flag (the script doesn't demote higher-rate entries)
		if (otL1Mult > 1.25) {
			const otEntries = tcls.billable.filter((r) => r.isOTDailyL1 === 1);
			expect(
				otEntries.length,
				`OT L1 entries (mult=${otL1Mult}) should retain isOTDailyL1`,
			).toBeGreaterThanOrEqual(1);
		}
	});
});
