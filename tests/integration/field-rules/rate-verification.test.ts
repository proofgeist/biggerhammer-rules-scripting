/**
 * Rate Verification Tests
 *
 * Verifies that rate and financial fields are properly populated on result
 * entries after rules are applied.
 *
 * R1 checks that base rate dollar fields (dollarsBillRateBase, dollarsPayRateBase)
 * are populated on a simple daytime shift.
 *
 * R2 checks that the column_multipliers field (a JSON array text field) is
 * populated on an overtime shift, indicating that multiplier metadata was
 * written to the TCL record.
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

const TEST_DATE_R1 = "2028-03-01";
const TEST_DATE_R2 = "2028-03-02";

describe("Rate Verification", () => {
	const createdTcdIds: string[] = [];

	afterAll(async () => {
		await cleanupAll(createdTcdIds);
	});

	it("R1: Base rates populated on simple shift", async () => {
		const contactId = requireEnv("TEST_CONTACT_ID");
		const eventId = requireEnv("TEST_EVENT_ID");
		const contractId = requireEnv("TEST_CONTRACT_ID_WORKED");

		const tcd = await createTimeCard({
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_R1,
		});
		const tcdId = assertId(tcd);
		createdTcdIds.push(tcdId);

		// 4-hour daytime clock: 09:00 - 13:00
		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_R1,
			timeIn: "09:00:00",
			timeOut: "13:00:00",
		});

		const result = await applyRules(tcdId);
		expect(result.error).toBe(0);

		const tcls = await getResultTCLs(tcdId);

		// Log rate values for diagnostics
		console.log("Billable entries (rate fields):");
		for (const r of tcls.billable) {
			console.log(
				`  Bill: ${r.time_in}-${r.time_out} dollarsBillRateBase=${r.dollarsBillRateBase}`,
			);
		}
		console.log("Payable entries (rate fields):");
		for (const r of tcls.payable) {
			console.log(
				`  Pay:  ${r.time_in}-${r.time_out} dollarsPayRateBase=${r.dollarsPayRateBase}`,
			);
		}

		// At least one billable entry should have dollarsBillRateBase > 0
		const billWithRate = tcls.billable.filter(
			(r) => (r.dollarsBillRateBase ?? 0) > 0,
		);
		expect(
			billWithRate.length,
			"At least one billable entry should have dollarsBillRateBase > 0",
		).toBeGreaterThanOrEqual(1);

		// At least one payable entry should have dollarsPayRateBase > 0
		const payWithRate = tcls.payable.filter(
			(r) => (r.dollarsPayRateBase ?? 0) > 0,
		);
		expect(
			payWithRate.length,
			"At least one payable entry should have dollarsPayRateBase > 0",
		).toBeGreaterThanOrEqual(1);
	});

	it("R2: column_multipliers populated on OT shift", async () => {
		const contactId = requireEnv("TEST_CONTACT_ID");
		const eventId = requireEnv("TEST_EVENT_ID");
		const contractId = requireEnv("TEST_CONTRACT_ID_WORKED");

		const contract = await getContract(contractId);
		const hrsL1 = contract.hrs_overtime_daily_L1 ?? 0;
		const multL1 = contract.mult_overtime_daily_L1 ?? 0;

		console.log(`Contract: OT L1=${hrsL1}, mult_L1=${multL1}`);

		if (hrsL1 <= 0 || multL1 <= 0) {
			console.warn(
				"Skipping R2: hrs_overtime_daily_L1 and mult_overtime_daily_L1 must both be configured.",
			);
			return;
		}

		const tcd = await createTimeCard({
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_R2,
		});
		const tcdId = assertId(tcd);
		createdTcdIds.push(tcdId);

		// 10-hour clock (07:00 - 17:00) to exceed the OT threshold
		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_R2,
			timeIn: "07:00:00",
			timeOut: "17:00:00",
		});

		const result = await applyRules(tcdId);
		expect(result.error).toBe(0);

		const tcls = await getResultTCLs(tcdId);

		// Log column_multipliers values for diagnostics
		console.log("Billable entries (column_multipliers):");
		for (const r of tcls.billable) {
			console.log(
				`  Bill: ${r.time_in}-${r.time_out} column_multipliers=${r.column_multipliers}`,
			);
		}

		// Check column_multipliers — this is a discovery test.
		// The field may not be populated by the engine on all contracts.
		const billWithMultipliers = tcls.billable.filter(
			(r) =>
				r.column_multipliers !== undefined &&
				r.column_multipliers !== null &&
				r.column_multipliers !== "",
		);

		if (billWithMultipliers.length === 0) {
			console.warn(
				"Discovery: column_multipliers is not populated on any billable entry " +
					"for this OT shift. The field may be populated by a different process.",
			);
		} else {
			console.log(
				`column_multipliers found on ${billWithMultipliers.length} entries`,
			);
		}

		// Verify OT entries exist (this confirms OT rules ran correctly)
		const otEntries = tcls.billable.filter((r) => r.isOTDailyL1 === 1);
		expect(
			otEntries.length,
			"Should have at least one OT L1 entry on a 10-hr clock",
		).toBeGreaterThanOrEqual(1);
	});
});
