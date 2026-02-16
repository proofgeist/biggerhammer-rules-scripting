/**
 * Bill/Pay Symmetry Tests
 *
 * Verifies that the bill and pay arrays produce symmetric results for the
 * same clock input. When running in the default "bill\npay" mode, every
 * billable entry should have a matching payable entry with the same time_in
 * and time_out, and key flags should be consistent between matched pairs.
 */

import { afterAll, describe, expect, it } from "vitest";
import { cleanupAll } from "../../helpers/cleanup.js";
import {
	applyRules,
	assertId,
	createClockTCL,
	createTimeCard,
	getResultTCLs,
	requireEnv,
} from "../../helpers/factories.js";

const TEST_DATE = "2027-10-10";

describe("Bill/Pay Symmetry", () => {
	const createdTcdIds: string[] = [];

	afterAll(async () => {
		await cleanupAll(createdTcdIds);
	});

	it("N1: Simple shift symmetry", async () => {
		const contactId = requireEnv("TEST_CONTACT_ID");
		const eventId = requireEnv("TEST_EVENT_ID");
		const contractId = requireEnv("TEST_CONTRACT_ID_WORKED");

		// Create TCD + 8-hr daytime clock (09:00-17:00)
		const tcd = await createTimeCard({
			contactId,
			eventId,
			contractId,
			date: TEST_DATE,
		});
		const tcdId = assertId(tcd);
		createdTcdIds.push(tcdId);

		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE,
			timeIn: "09:00:00",
			timeOut: "17:00:00",
		});

		// Apply rules in default mode (both bill and pay)
		const result = await applyRules(tcdId);
		expect(result.error).toBe(0);

		const tcls = await getResultTCLs(tcdId);

		// Log all billable entries for diagnostics
		console.log("Billable entries:");
		for (const r of tcls.billable) {
			console.log(
				`  Bill: ${r.time_in}-${r.time_out} isOTDailyL1=${r.isOTDailyL1} ` +
					`isNightRate=${r.isNightRate} isMinimumCall=${r.isMinimumCall}`,
			);
		}

		// Log all payable entries for diagnostics
		console.log("Payable entries:");
		for (const r of tcls.payable) {
			console.log(
				`  Pay:  ${r.time_in}-${r.time_out} isOTDailyL1=${r.isOTDailyL1} ` +
					`isNightRate=${r.isNightRate} isMinimumCall=${r.isMinimumCall}`,
			);
		}

		// 1. Same number of bill and pay entries
		expect(
			tcls.billable.length,
			`Bill count (${tcls.billable.length}) should equal pay count (${tcls.payable.length})`,
		).toBe(tcls.payable.length);

		// Sort both arrays by time_in before comparing
		const sortByTimeIn = <T extends { time_in?: string | null }>(
			a: T,
			b: T,
		) => (a.time_in ?? "").localeCompare(b.time_in ?? "");

		const sortedBill = [...tcls.billable].sort(sortByTimeIn);
		const sortedPay = [...tcls.payable].sort(sortByTimeIn);

		// 2. For each billable entry, there should be a payable entry with
		//    matching time_in and time_out
		for (const bill of sortedBill) {
			const match = sortedPay.find(
				(pay) =>
					pay.time_in === bill.time_in && pay.time_out === bill.time_out,
			);
			expect(
				match,
				`Billable entry ${bill.time_in}-${bill.time_out} should have a matching payable entry`,
			).toBeDefined();

			// 3. For matched pairs, verify key flags are consistent
			if (match) {
				expect(
					match.isOTDailyL1,
					`isOTDailyL1 mismatch for ${bill.time_in}-${bill.time_out}: ` +
						`bill=${bill.isOTDailyL1}, pay=${match.isOTDailyL1}`,
				).toBe(bill.isOTDailyL1);

				expect(
					match.isNightRate,
					`isNightRate mismatch for ${bill.time_in}-${bill.time_out}: ` +
						`bill=${bill.isNightRate}, pay=${match.isNightRate}`,
				).toBe(bill.isNightRate);

				expect(
					match.isMinimumCall,
					`isMinimumCall mismatch for ${bill.time_in}-${bill.time_out}: ` +
						`bill=${bill.isMinimumCall}, pay=${match.isMinimumCall}`,
				).toBe(bill.isMinimumCall);
			}
		}
	});
});
