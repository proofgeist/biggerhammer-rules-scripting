/**
 * Group G (continued): Consecutive Days – 6th Day Tests
 *
 * Tests "Consecutive Days - BH" rule for 6th consecutive day ordinal.
 *
 * G4: 6 consecutive day TCDs → 6th day gets isConsecutiveDay6th=1
 * G5: Only 5 days → no 6th consecutive day flag
 *
 * Note: Each test creates N TCDs with clocks and applies rules to each
 * in order. The consecutive days script reads history from prior days.
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

// G4: 2027-06-01 through 2027-06-06 (6 days)
// G5: 2027-07-01 through 2027-07-05 (5 days — separate month to avoid G4 pollution)

function dateStr(year: number, month: number, day: number): string {
	return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

describe("Consecutive Days – 6th Day", () => {
		const createdTcdIds: string[] = [];
		const createdCruIds: string[] = [];

		afterAll(async () => {
			for (const cruId of createdCruIds) {
				await deleteContractRule(cruId);
			}
			await cleanupAll(createdTcdIds);
		});

		it("G4: 6 consecutive day TCDs → 6th day gets isConsecutiveDay6th=1", { timeout: 120_000 }, async () => {
			const contactId = requireEnv("TEST_CONTACT_ID");
			const eventId = requireEnv("TEST_EVENT_ID");
			const contractId = requireEnv("TEST_CONTRACT_ID_WORKED");

			const rule = await findRule("Consecutive Days");
			console.log(`Found rule: ${rule.name} (${rule.__id})`);

			// Create CRU for 6th consecutive day
			const cru = await createContractRule({
				ruleId: rule.__id!,
				contractId,
				ordinal: "sixth",
				day: "Work",
				multiplier1: 1.5,
				scope: "",
			});
			const cruId = assertId(cru);
			createdCruIds.push(cruId);

			// Create 6 consecutive day TCDs (2027-06-01 through 2027-06-06)
			for (let d = 1; d <= 6; d++) {
				const date = dateStr(2027, 6, d);

				const tcd = await createTimeCard({
					contactId,
					eventId,
					contractId,
					date,
				});
				const tcdId = assertId(tcd);
				createdTcdIds.push(tcdId);

				await createClockTCL({
					timecardId: tcdId,
					contactId,
					eventId,
					contractId,
					date,
					timeIn: "09:00:00",
					timeOut: "13:00:00",
				});

				const result = await applyRules(tcdId);
				expect(
					result.error,
					`Rules should succeed for day ${d}`,
				).toBe(0);

				if (d === 6) {
					// 6th day — check for consecutive day flag
					const tcls = await getResultTCLs(tcdId);

					for (const r of tcls.billable) {
						console.log(
							`  Day 6 Bill: ${r.time_in}-${r.time_out} ` +
								`isConsecutiveDay6th=${r.isConsecutiveDay6th} ` +
								`isMinimumCall=${r.isMinimumCall}`,
						);
					}

					const consec6th = tcls.billable.filter(
						(r) =>
							r.isConsecutiveDay6th === 1 &&
							!r.isMinimumCall,
					);

					expect(
						consec6th.length,
						"6th consecutive day should have isConsecutiveDay6th=1",
					).toBeGreaterThanOrEqual(1);
				}
			}
		});

		it("G5: only 5 days → no 6th consecutive day flag", { timeout: 120_000 }, async () => {
			const contactId = requireEnv("TEST_CONTACT_ID");
			const eventId = requireEnv("TEST_EVENT_ID");
			const contractId = requireEnv("TEST_CONTRACT_ID_WORKED");

			const rule = await findRule("Consecutive Days");

			// Create CRU for 6th consecutive day
			const cru = await createContractRule({
				ruleId: rule.__id!,
				contractId,
				ordinal: "sixth",
				day: "Work",
				multiplier1: 1.5,
				scope: "",
			});
			const cruId = assertId(cru);
			createdCruIds.push(cruId);

			// Create only 5 consecutive day TCDs (2027-07-01 through 2027-07-05)
			// Use July to avoid G4's June dates polluting the consecutive count
			let lastTcdId = "";
			for (let d = 1; d <= 5; d++) {
				const date = dateStr(2027, 7, d);

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
					timeIn: "09:00:00",
					timeOut: "13:00:00",
				});

				const result = await applyRules(tcdId);
				expect(
					result.error,
					`Rules should succeed for day ${d}`,
				).toBe(0);
			}

			// Check the 5th (last) day
			const tcls = await getResultTCLs(lastTcdId);

			const consec6th = tcls.billable.filter(
				(r) => r.isConsecutiveDay6th === 1,
			);
			expect(
				consec6th.length,
				"Only 5 consecutive days — no 6th day flag expected",
			).toBe(0);
		});
});
