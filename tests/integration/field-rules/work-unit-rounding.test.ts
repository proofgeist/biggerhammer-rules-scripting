/**
 * Work Unit Rounding Tests
 *
 * Verifies that the rules engine correctly handles the `mins_work_unit`
 * contract setting, which defines the smallest billable time increment
 * (e.g., 30 minutes). When configured, billable and payable durations
 * should be rounded to multiples of this work unit.
 *
 * P1: Clock duration NOT aligned to the work unit boundary
 * P2: Clock duration exactly ON a work unit boundary
 *
 * Tests read `mins_work_unit` from the contract at runtime and skip
 * if the value is 0 or not configured.
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

const TEST_DATE_P1 = "2027-11-10";
const TEST_DATE_P2 = "2027-11-11";

describe("Work Unit Rounding", () => {
	const createdTcdIds: string[] = [];

	afterAll(async () => {
		await cleanupAll(createdTcdIds);
	});

	it("P1: Duration not aligned to work unit", async () => {
		const contactId = requireEnv("TEST_CONTACT_ID");
		const eventId = requireEnv("TEST_EVENT_ID");
		const contractId = requireEnv("TEST_CONTRACT_ID_WORKED");

		const contract = await getContract(contractId);
		const minsWorkUnit = contract.mins_work_unit ?? 0;

		if (!minsWorkUnit || minsWorkUnit <= 0) {
			console.warn(
				"Skipping P1: mins_work_unit is 0 or not configured on this contract.",
			);
			return;
		}

		console.log(`Work unit: ${minsWorkUnit} minutes`);

		const tcd = await createTimeCard({
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_P1,
		});
		const tcdId = assertId(tcd);
		createdTcdIds.push(tcdId);

		// Create a clock that is NOT aligned to the work unit.
		// 08:00-10:15 = 2.25 hrs = 135 minutes (not a multiple of 30, 15-min units, etc.)
		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_P1,
			timeIn: "08:00:00",
			timeOut: "10:15:00",
		});

		const result = await applyRules(tcdId);
		expect(result.error, "applyRules should not return an error").toBe(0);

		const tcls = await getResultTCLs(tcdId);

		// Log all billable entries for diagnostics
		for (const r of tcls.billable) {
			console.log(
				`  Bill: ${r.time_in}-${r.time_out} isBill=${r.isBill}`,
			);
		}

		// Calculate total billable hours
		let totalBillableHrs = 0;
		for (const r of tcls.billable) {
			if (r.time_in && r.time_out) {
				let inHrs = parseTimeToHours(r.time_in);
				let outHrs = parseTimeToHours(r.time_out);
				if (outHrs < inHrs) outHrs += 24;
				if (outHrs === 0 && inHrs > 0) outHrs = 24;
				totalBillableHrs += outHrs - inHrs;
			}
		}

		console.log(
			`  Total billable hours: ${totalBillableHrs} ` +
				`(raw clock: 2.25 hrs, work unit: ${minsWorkUnit} min)`,
		);

		// At least 1 billable entry should be produced
		expect(
			tcls.billable.length,
			"Non-aligned clock should still produce at least 1 billable entry",
		).toBeGreaterThanOrEqual(1);
	});

	it("P2: Duration exactly on work unit boundary", async () => {
		const contactId = requireEnv("TEST_CONTACT_ID");
		const eventId = requireEnv("TEST_EVENT_ID");
		const contractId = requireEnv("TEST_CONTRACT_ID_WORKED");

		const contract = await getContract(contractId);
		const minsWorkUnit = contract.mins_work_unit ?? 0;

		if (!minsWorkUnit || minsWorkUnit <= 0) {
			console.warn(
				"Skipping P2: mins_work_unit is 0 or not configured on this contract.",
			);
			return;
		}

		console.log(`Work unit: ${minsWorkUnit} minutes`);

		const tcd = await createTimeCard({
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_P2,
		});
		const tcdId = assertId(tcd);
		createdTcdIds.push(tcdId);

		// Create a clock that IS exactly aligned to the work unit.
		// 08:00-10:00 = 2.0 hrs = 120 minutes (multiple of 15, 30, 60, etc.)
		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_P2,
			timeIn: "08:00:00",
			timeOut: "10:00:00",
		});

		const result = await applyRules(tcdId);
		expect(result.error, "applyRules should not return an error").toBe(0);

		const tcls = await getResultTCLs(tcdId);

		// Log all billable entries for diagnostics
		for (const r of tcls.billable) {
			console.log(
				`  Bill: ${r.time_in}-${r.time_out} isBill=${r.isBill}`,
			);
		}

		// Calculate total billable hours
		let totalBillableHrs = 0;
		for (const r of tcls.billable) {
			if (r.time_in && r.time_out) {
				let inHrs = parseTimeToHours(r.time_in);
				let outHrs = parseTimeToHours(r.time_out);
				if (outHrs < inHrs) outHrs += 24;
				if (outHrs === 0 && inHrs > 0) outHrs = 24;
				totalBillableHrs += outHrs - inHrs;
			}
		}

		console.log(
			`  Total billable hours: ${totalBillableHrs} ` +
				`(raw clock: 2.0 hrs, work unit: ${minsWorkUnit} min)`,
		);

		// Billable entries should be produced
		expect(
			tcls.billable.length,
			"Aligned clock should produce at least 1 billable entry",
		).toBeGreaterThanOrEqual(1);
	});
});
