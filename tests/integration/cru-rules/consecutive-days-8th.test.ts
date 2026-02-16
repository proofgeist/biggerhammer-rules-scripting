/**
 * Group G (continued): Consecutive Days – 8th Day Tests
 *
 * Tests "Consecutive Days - BH" rule for 8th consecutive day ordinal.
 *
 * G6: 8 consecutive day TCDs → 8th day gets isConsecutiveDay8th=1
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

// G6: 2027-09-01 through 2027-09-08 (8 days)

function dateStr(year: number, month: number, day: number): string {
	return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

describe("Consecutive Days – 8th Day", () => {
		const createdTcdIds: string[] = [];
		const createdCruIds: string[] = [];

		afterAll(async () => {
			for (const cruId of createdCruIds) {
				await deleteContractRule(cruId);
			}
			await cleanupAll(createdTcdIds);
		});

		it("G6: 8 consecutive day TCDs → 8th day gets isConsecutiveDay8th=1", { timeout: 120_000 }, async () => {
			const contactId = requireEnv("TEST_CONTACT_ID");
			const eventId = requireEnv("TEST_EVENT_ID");
			const contractId = requireEnv("TEST_CONTRACT_ID_WORKED");

			const rule = await findRule("Consecutive Days");
			console.log(`Found rule: ${rule.name} (${rule.__id})`);

			// Create CRU for 8th consecutive day
			const cru = await createContractRule({
				ruleId: rule.__id!,
				contractId,
				ordinal: "eighth",
				day: "Work",
				multiplier1: 2.0,
				scope: "",
			});
			const cruId = assertId(cru);
			createdCruIds.push(cruId);

			// Create 8 consecutive day TCDs (2027-09-01 through 2027-09-08)
			for (let d = 1; d <= 8; d++) {
				const date = dateStr(2027, 9, d);

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

				if (d === 8) {
					// 8th day — check for consecutive day flag
					const tcls = await getResultTCLs(tcdId);

					for (const r of tcls.billable) {
						console.log(
							`  Day 8 Bill: ${r.time_in}-${r.time_out} ` +
								`isConsecutiveDay8th=${r.isConsecutiveDay8th} ` +
								`isMinimumCall=${r.isMinimumCall}`,
						);
					}

					const consec8th = tcls.billable.filter(
						(r) =>
							r.isConsecutiveDay8th === 1 &&
							!r.isMinimumCall,
					);

					expect(
						consec8th.length,
						"8th consecutive day should have isConsecutiveDay8th=1",
					).toBeGreaterThanOrEqual(1);
				}
			}
		});
});
