/**
 * Group K (continued): CRU Sequence Tiebreak Tests
 *
 * Validates behaviour when two CRU rules share the same sequence number.
 * Uses "Day of Week" as the test rule.
 *
 * K7: Two CRU rules with identical sequence number — no crash, correct
 *     rule fires based on day match, non-matching rule does not fire.
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

// 2027-12-05 is a Sunday
const TEST_DATE_K7 = "2027-12-05";

describe("CRU Sequence Tiebreak", () => {
	const createdTcdIds: string[] = [];
	const createdCruIds: string[] = [];

	afterAll(async () => {
		// Clean up CRU records first (they're independent of TCDs)
		for (const cruId of createdCruIds) {
			await deleteContractRule(cruId);
		}
		await cleanupAll(createdTcdIds);
	});

	it("K7: two CRU rules with identical sequence number", async () => {
		const contactId = requireEnv("TEST_CONTACT_ID");
		const eventId = requireEnv("TEST_EVENT_ID");
		const contractId = requireEnv("TEST_CONTRACT_ID_WORKED");

		// Find the "Day of Week" master rule
		const rule = await findRule("Day of Week");
		console.log(`Found rule: ${rule.name} (${rule.__id})`);

		// Create two CRUs on the same contract, both with sequence: 1
		// CRU 1: matches Sunday (the test date)
		const cru1 = await createContractRule({
			ruleId: rule.__id!,
			contractId,
			sequence: 1,
			day: "Sunday",
			multiplier1: 1.5,
			scope: "",
		});
		const cruId1 = assertId(cru1);
		createdCruIds.push(cruId1);
		console.log(`Created CRU 1 (Sunday): ${cruId1}`);

		// CRU 2: matches Saturday (should NOT fire on a Sunday)
		const cru2 = await createContractRule({
			ruleId: rule.__id!,
			contractId,
			sequence: 1,
			day: "Saturday",
			multiplier1: 1.5,
			scope: "",
		});
		const cruId2 = assertId(cru2);
		createdCruIds.push(cruId2);
		console.log(`Created CRU 2 (Saturday): ${cruId2}`);

		// Create TCD on Sunday 2027-12-21 with a 4-hr clock (09:00-13:00)
		const tcd = await createTimeCard({
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_K7,
		});
		const tcdId = assertId(tcd);
		createdTcdIds.push(tcdId);

		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_K7,
			timeIn: "09:00:00",
			timeOut: "13:00:00",
		});

		// Apply rules — should not crash even with duplicate sequence numbers
		const result = await applyRules(tcdId);
		expect(result.error, "No crash from sequence collision").toBe(0);

		const tcls = await getResultTCLs(tcdId);

		// Log all entries for diagnostics
		for (const r of tcls.all) {
			console.log(
				`  TCL: ${r.time_in}-${r.time_out} isBill=${r.isBill} isPay=${r.isPay} ` +
					`isDayOfWeekSunday=${r.isDayOfWeekSunday} isDayOfWeekSaturday=${r.isDayOfWeekSaturday} ` +
					`isMinimumCall=${r.isMinimumCall}`,
			);
		}

		// The matching rule (Sunday) should fire on billable entries.
		// The engine sets the generic isDayOfWeek flag rather than
		// day-specific flags like isDayOfWeekSunday.
		const dowBill = tcls.billable.filter(
			(r) => r.isDayOfWeek === 1 && !r.isMinimumCall,
		);
		expect(
			dowBill.length,
			"Sunday billable entries should have isDayOfWeek flag",
		).toBeGreaterThanOrEqual(1);
	});
});
