/**
 * Group G: Consecutive Days Tests
 *
 * Tests "Consecutive Days - BH" rule. Requires multi-day TCDs with rules
 * applied sequentially.
 *
 * G1: 7 consecutive day TCDs → 7th day gets isConsecutiveDay7th=1
 * G2: Only 6 days → no 7th consecutive day flag
 * G3: Gap breaks streak → day 7 does NOT get flag
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
	getContractRules,
	getResultTCLs,
	requireEnv,
} from "../../helpers/factories.js";

// G1: 2027-01-04 through 2027-01-10 (Sun-Sat, 7 days)
// G2: 2027-03-02 through 2027-03-07 (Mon-Sat, 6 days — separate month to avoid G1 pollution)
// G3: 2027-04-01 through 2027-04-08 with gap at day 4

function dateStr(year: number, month: number, day: number): string {
	return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

describe("Consecutive Days", () => {
		const createdTcdIds: string[] = [];
		const createdCruIds: string[] = [];

		afterAll(async () => {
			for (const cruId of createdCruIds) {
				await deleteContractRule(cruId);
			}
			await cleanupAll(createdTcdIds);
		});

		it("G1: 7 consecutive day TCDs → 7th day gets isConsecutiveDay7th=1", { timeout: 120_000 }, async () => {
			const contactId = requireEnv("TEST_CONTACT_ID");
			const eventId = requireEnv("TEST_EVENT_ID");
			const contractId = requireEnv("TEST_CONTRACT_ID_WORKED");

			const rule = await findRule("Consecutive Days");
			console.log(`Found rule: ${rule.name} (${rule.__id})`);

			// Create CRU for 7th consecutive day
			const cru = await createContractRule({
				ruleId: rule.__id!,
				contractId,
				ordinal: "seventh",
				day: "Work",
				multiplier1: 1.5,
				scope: "",
			});
			const cruId = assertId(cru);
			createdCruIds.push(cruId);

			// Create 7 consecutive day TCDs (2027-01-04 through 2027-01-10)
			for (let d = 4; d <= 10; d++) {
				const date = dateStr(2027, 1, d);

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

				if (d === 10) {
					// 7th day — check for consecutive day flag
					const tcls = await getResultTCLs(tcdId);

					for (const r of tcls.billable) {
						console.log(
							`  Day 7 Bill: ${r.time_in}-${r.time_out} ` +
								`isConsecutiveDay7th=${r.isConsecutiveDay7th} ` +
								`isMinimumCall=${r.isMinimumCall}`,
						);
					}

					const consec7th = tcls.billable.filter(
						(r) =>
							r.isConsecutiveDay7th === 1 &&
							!r.isMinimumCall,
					);

					expect(
						consec7th.length,
						"7th consecutive day should have isConsecutiveDay7th=1",
					).toBeGreaterThanOrEqual(1);
				}
			}
		});

		it("G2: only 6 days → no 7th consecutive day flag", { timeout: 120_000 }, async () => {
			const contactId = requireEnv("TEST_CONTACT_ID");
			const eventId = requireEnv("TEST_EVENT_ID");
			const contractId = requireEnv("TEST_CONTRACT_ID_WORKED");

			const rule = await findRule("Consecutive Days");

			// Reuse any existing CRU or create new one
			const cru = await createContractRule({
				ruleId: rule.__id!,
				contractId,
				ordinal: "seventh",
				day: "Work",
				multiplier1: 1.5,
				scope: "",
			});
			const cruId = assertId(cru);
			createdCruIds.push(cruId);

			// Create only 6 consecutive day TCDs (2027-03-02 through 2027-03-07)
			// Use March to avoid G1's January dates polluting the consecutive count
			let lastTcdId = "";
			for (let d = 2; d <= 7; d++) {
				const date = dateStr(2027, 3, d);

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

			// Check the 6th (last) day
			const tcls = await getResultTCLs(lastTcdId);

			const consec7th = tcls.billable.filter(
				(r) => r.isConsecutiveDay7th === 1,
			);
			expect(
				consec7th.length,
				"Only 6 consecutive days — no 7th day flag expected",
			).toBe(0);
		});

		it("G3: gap breaks streak → day 7 does NOT get flag", { timeout: 120_000 }, async () => {
			const contactId = requireEnv("TEST_CONTACT_ID");
			const eventId = requireEnv("TEST_EVENT_ID");
			const contractId = requireEnv("TEST_CONTRACT_ID_WORKED");

			const rule = await findRule("Consecutive Days");

			const cru = await createContractRule({
				ruleId: rule.__id!,
				contractId,
				ordinal: "seventh",
				day: "Work",
				multiplier1: 1.5,
				scope: "",
			});
			const cruId = assertId(cru);
			createdCruIds.push(cruId);

			// Create 7 days but skip day 4, breaking the streak
			// Days: 2027-04-01, 02, 03, [SKIP 04], 05, 06, 07
			// Use April to avoid G1's January dates polluting the consecutive count
			const days = [1, 2, 3, 5, 6, 7, 8]; // 7 work days, but gap at day 4
			let lastTcdId = "";

			for (const d of days) {
				const date = dateStr(2027, 4, d);

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

			// Check last day (should be 4th day after gap, NOT 7th consecutive)
			const tcls = await getResultTCLs(lastTcdId);

			for (const r of tcls.billable) {
				console.log(
					`  Bill: ${r.time_in}-${r.time_out} ` +
						`isConsecutiveDay7th=${r.isConsecutiveDay7th}`,
				);
			}

			const consec7th = tcls.billable.filter(
				(r) => r.isConsecutiveDay7th === 1,
			);
			expect(
				consec7th.length,
				"Gap at day 4 should break the streak — no 7th day flag",
			).toBe(0);
		});
});
