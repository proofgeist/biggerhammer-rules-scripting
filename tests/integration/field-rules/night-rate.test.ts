/**
 * Group C: Night Rate Tests
 *
 * Verifies that the Night Rate rule correctly identifies entries within the
 * night window and splits entries that partially overlap the window.
 *
 * Tests read `time_night_start`, `time_night_end`, and `mult_night` from the
 * contract at runtime and construct scenarios accordingly.
 *
 * The night rate script handles "early" (e.g., midnight-6AM) and "late"
 * (e.g., 10PM-midnight+6AM) windows. It splits entries at window boundaries.
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

const TEST_DATE_C1 = "2026-05-07";
const TEST_DATE_C2 = "2026-06-07";
const TEST_DATE_C3 = "2026-07-07";
const TEST_DATE_C4 = "2026-08-07";

describe("Night Rate", () => {
	const createdTcdIds: string[] = [];

	afterAll(async () => {
		await cleanupAll(createdTcdIds);
	});

	it("C1: should apply night rate to a clock fully within the night window", async () => {
		const contactId = requireEnv("TEST_CONTACT_ID");
		const eventId = requireEnv("TEST_EVENT_ID");
		const contractId = requireEnv("TEST_CONTRACT_ID_WORKED");

		const contract = await getContract(contractId);
		const nightStart = contract.time_night_start;
		const nightEnd = contract.time_night_end;
		const multNight = contract.mult_night ?? 0;

		console.log(
			`Contract: night_start=${nightStart}, night_end=${nightEnd}, mult_night=${multNight}`,
		);

		if (!nightStart || !nightEnd || multNight <= 0) {
			console.warn(
				"Skipping C1: Night rate not configured on this contract.",
			);
			return;
		}

		const nightEndHrs = parseTimeToHours(nightEnd);

		// We need a clock fully within the early night window (midnight to nightEnd).
		// E.g., if nightEnd is 06:00, clock from 01:00 to 05:00 is fully within.
		if (nightEndHrs <= 1) {
			console.warn(
				`Skipping C1: Night end (${nightEnd}) too early for a test clock.`,
			);
			return;
		}

		// Clock from 01:00 to nightEnd - 1 hr (fully within early night window)
		const clockOut = nightEndHrs - 1;
		if (clockOut <= 1) {
			console.warn("Skipping C1: Night window too narrow for test.");
			return;
		}
		const clockOutStr = `${String(Math.floor(clockOut)).padStart(2, "0")}:00:00`;

		const tcd = await createTimeCard({
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_C1,
		});
		const tcdId = assertId(tcd);
		createdTcdIds.push(tcdId);

		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_C1,
			timeIn: "01:00:00",
			timeOut: clockOutStr,
		});

		const result = await applyRules(tcdId);
		expect(result.error).toBe(0);

		const tcls = await getResultTCLs(tcdId);

		for (const r of tcls.billable) {
			console.log(
				`  Bill: ${r.time_in}-${r.time_out} isNightRate=${r.isNightRate} ` +
					`isAfterMidnight=${r.isAfterMidnight}`,
			);
		}

		// All billable entries from this clock should have isNightRate=True
		// (unless MC or other rules created additional entries outside the window)
		const nightEntries = tcls.billable.filter(
			(r) => r.isNightRate === 1,
		);

		expect(
			nightEntries.length,
			`Clock 01:00-${clockOutStr} is fully within night window ` +
				`(${nightStart}-${nightEnd}). All entries should be night rate.`,
		).toBeGreaterThanOrEqual(1);

		// No billable entries within the clock range should lack night rate
		const nonNight = tcls.billable.filter((r) => {
			const t = parseTimeToHours(r.time_in ?? "0");
			return t >= 1 && t < clockOut && !r.isNightRate;
		});

		expect(
			nonNight.length,
			"No entries within the clock range should lack the night rate flag",
		).toBe(0);
	});

	it("C2: should split an entry starting before the night window and ending within", async () => {
		const contactId = requireEnv("TEST_CONTACT_ID");
		const eventId = requireEnv("TEST_EVENT_ID");
		const contractId = requireEnv("TEST_CONTRACT_ID_WORKED");

		const contract = await getContract(contractId);
		const nightStart = contract.time_night_start;
		const nightEnd = contract.time_night_end;
		const multNight = contract.mult_night ?? 0;

		console.log(
			`Contract: night_start=${nightStart}, night_end=${nightEnd}, mult_night=${multNight}`,
		);

		if (!nightStart || !nightEnd || multNight <= 0) {
			console.warn(
				"Skipping C2: Night rate not configured on this contract.",
			);
			return;
		}

		const nightStartHrs = parseTimeToHours(nightStart);
		const nightEndHrs = parseTimeToHours(nightEnd);

		// Clock from 2 hours before night start to 1 hour after night start
		// This spans the night window boundary.
		// If nightStart is 22:00 (late window), clock is 20:00-23:00
		// If nightStart is 00:00 (early window, midnight), use the late window instead

		let clockIn: string;
		let clockOut: string;

		if (nightStartHrs >= 18) {
			// Late night window (e.g., 22:00)
			const inHrs = nightStartHrs - 2;
			const outHrs = nightStartHrs + 1;
			if (outHrs >= 24) {
				// Spans midnight — need to handle as midnight-crossing clock
				clockIn = `${String(Math.floor(inHrs)).padStart(2, "0")}:00:00`;
				clockOut = `${String(Math.floor(outHrs - 24)).padStart(2, "0")}:00:00`;
			} else {
				clockIn = `${String(Math.floor(inHrs)).padStart(2, "0")}:00:00`;
				clockOut = `${String(Math.floor(outHrs)).padStart(2, "0")}:00:00`;
			}
		} else {
			// Early night window (e.g., 00:00-06:00) — hard to test "before" midnight
			// Skip this variant
			console.warn(
				`Skipping C2: Night start (${nightStart}) is before 18:00. ` +
					`Cannot easily test a clock starting before the night window.`,
			);
			return;
		}

		console.log(`Clock: ${clockIn} - ${clockOut}`);

		const tcd = await createTimeCard({
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_C2,
		});
		const tcdId = assertId(tcd);
		createdTcdIds.push(tcdId);

		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_C2,
			timeIn: clockIn,
			timeOut: clockOut,
		});

		const result = await applyRules(tcdId);
		expect(result.error).toBe(0);

		const tcls = await getResultTCLs(tcdId);

		for (const r of tcls.billable) {
			console.log(
				`  Bill: ${r.time_in}-${r.time_out} isNightRate=${r.isNightRate}`,
			);
		}

		// Should have at least 2 billable entries (split at night boundary)
		expect(
			tcls.billable.length,
			"Entry spanning night window boundary should be split",
		).toBeGreaterThanOrEqual(2);

		// Pre-night-window entries should NOT have night rate
		const preNight = tcls.billable.filter((r) => {
			const t = parseTimeToHours(r.time_in ?? "0");
			return t < nightStartHrs && !r.isNightRate;
		});
		expect(
			preNight.length,
			"Entries before the night window should not have night rate",
		).toBeGreaterThanOrEqual(1);

		// Night-window entries should have night rate
		const nightEntries = tcls.billable.filter(
			(r) => r.isNightRate === 1,
		);
		expect(
			nightEntries.length,
			"Entries within the night window should have night rate",
		).toBeGreaterThanOrEqual(1);
	});

	it("C3: should split an entry starting within the night window and ending after", async () => {
		const contactId = requireEnv("TEST_CONTACT_ID");
		const eventId = requireEnv("TEST_EVENT_ID");
		const contractId = requireEnv("TEST_CONTRACT_ID_WORKED");

		const contract = await getContract(contractId);
		const nightStart = contract.time_night_start;
		const nightEnd = contract.time_night_end;
		const multNight = contract.mult_night ?? 0;

		console.log(
			`Contract: night_start=${nightStart}, night_end=${nightEnd}, mult_night=${multNight}`,
		);

		if (!nightStart || !nightEnd || multNight <= 0) {
			console.warn(
				"Skipping C3: Night rate not configured on this contract.",
			);
			return;
		}

		const nightEndHrs = parseTimeToHours(nightEnd);

		if (nightEndHrs <= 1 || nightEndHrs >= 12) {
			console.warn(
				`Skipping C3: Night end (${nightEnd}) is unusual for this test.`,
			);
			return;
		}

		// Clock from 1 hour before nightEnd to 3 hours after nightEnd
		// E.g., if nightEnd is 06:00, clock is 05:00 - 09:00
		const clockIn = `${String(Math.floor(nightEndHrs - 1)).padStart(2, "0")}:00:00`;
		const clockOutHrs = nightEndHrs + 3;
		const clockOut = `${String(Math.floor(clockOutHrs)).padStart(2, "0")}:00:00`;

		console.log(`Clock: ${clockIn} - ${clockOut}`);

		const tcd = await createTimeCard({
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_C3,
		});
		const tcdId = assertId(tcd);
		createdTcdIds.push(tcdId);

		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_C3,
			timeIn: clockIn,
			timeOut: clockOut,
		});

		const result = await applyRules(tcdId);
		expect(result.error).toBe(0);

		const tcls = await getResultTCLs(tcdId);

		for (const r of tcls.billable) {
			console.log(
				`  Bill: ${r.time_in}-${r.time_out} isNightRate=${r.isNightRate}`,
			);
		}

		// Should be split at nightEnd boundary
		expect(
			tcls.billable.length,
			"Entry spanning night end should be split",
		).toBeGreaterThanOrEqual(2);

		// The early part (within night window) should have night rate
		const nightEntries = tcls.billable.filter(
			(r) => r.isNightRate === 1,
		);
		expect(
			nightEntries.length,
			"Part within night window should have night rate",
		).toBeGreaterThanOrEqual(1);

		// The later part (after night window) should NOT have night rate
		const dayEntries = tcls.billable.filter((r) => {
			const t = parseTimeToHours(r.time_in ?? "0");
			return t >= nightEndHrs && !r.isNightRate;
		});
		expect(
			dayEntries.length,
			"Part after night window should not have night rate",
		).toBeGreaterThanOrEqual(1);
	});

	it("C4: should not apply night rate to a daytime-only shift", async () => {
		const contactId = requireEnv("TEST_CONTACT_ID");
		const eventId = requireEnv("TEST_EVENT_ID");
		const contractId = requireEnv("TEST_CONTRACT_ID_WORKED");

		const contract = await getContract(contractId);
		const nightStart = contract.time_night_start;
		const nightEnd = contract.time_night_end;
		const multNight = contract.mult_night ?? 0;

		console.log(
			`Contract: night_start=${nightStart}, night_end=${nightEnd}, mult_night=${multNight}`,
		);

		if (!nightStart || !nightEnd || multNight <= 0) {
			console.warn(
				"Skipping C4: Night rate not configured on this contract.",
			);
			return;
		}

		const nightEndHrs = parseTimeToHours(nightEnd);
		const nightStartHrs = parseTimeToHours(nightStart);

		// Pick a daytime window that doesn't overlap the night window
		// Typically 09:00-17:00 should be safe if nightEnd < 9 and nightStart > 17
		if (nightEndHrs > 9 || nightStartHrs < 17) {
			console.warn(
				`Skipping C4: Night window (${nightStart}-${nightEnd}) overlaps with 09:00-17:00 test range.`,
			);
			return;
		}

		const tcd = await createTimeCard({
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_C4,
		});
		const tcdId = assertId(tcd);
		createdTcdIds.push(tcdId);

		await createClockTCL({
			timecardId: tcdId,
			contactId,
			eventId,
			contractId,
			date: TEST_DATE_C4,
			timeIn: "09:00:00",
			timeOut: "17:00:00",
		});

		const result = await applyRules(tcdId);
		expect(result.error).toBe(0);

		const tcls = await getResultTCLs(tcdId);

		// No entries should have night rate
		for (const r of tcls.billable) {
			expect(
				r.isNightRate,
				`Daytime entry ${r.time_in}-${r.time_out} should not have night rate`,
			).toBeFalsy();
		}

		for (const r of tcls.payable) {
			expect(
				r.isNightRate,
				`Pay entry ${r.time_in}-${r.time_out} should not have night rate`,
			).toBeFalsy();
		}
	});
});
