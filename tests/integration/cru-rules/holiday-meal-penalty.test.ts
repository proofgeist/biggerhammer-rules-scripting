/**
 * Holiday Meal Penalty Bug
 *
 * Replicates a real-world scenario observed on a holiday (Mon Feb 16, 2026,
 * Presidents Day) under the BHPL 2026 contract, where a meal penalty unworked
 * entry was being classified as overtime instead of as a meal penalty.
 *
 * Clock setup (from screenshot):
 *   06:00 AM - 12:30 PM  (6.5h worked — crosses the 6-hour meal threshold)
 *   12:30 PM - 01:00 PM  (0.5h paid meal — 30 min late, triggers 1-hr penalty)
 *   01:00 PM - 05:30 PM  (4.5h worked)
 *   Total: 11.5h worked + 1h MP unworked
 *
 * ─── Root cause ──────────────────────────────────────────────────────────────
 *
 * The bug lives in write-to-disk-bh.md, in the column-assignment logic for
 * BOTH the "bill" section and the "unwork" section.  The priority cascade is:
 *
 *   1. isUnpaidMeal  → blank          (correct — skipped)
 *   2. isDriveTime   → hrsColumn5
 *   3. isOTDailyL2   → hrsColumn2
 *   4. isOTDailyL1   → hrsColumn1     ← OT column
 *   5. isHoliday     → hrsColumn1     ← OT/Holiday column   (BUG: before MP check)
 *   6. isNightRate   → hrsColumn3
 *   7. isDayOfWeek   → hrsColumn1     ← OT column           (BUG: before MP check)
 *   8. isMP1 / isMP2 → hrsColumn4     ← MP column           (checked last!)
 *   9. (else)        → hrsColumn0     (ST column)
 *
 * In BHPL production, clock records on a holiday date receive isHoliday=True
 * from a FileMaker auto-enter calculation.  create-unworked-entry copies the
 * source clock record verbatim (including isHoliday=True) into $$unwork[n].
 * Write-to-disk then hits the isHoliday check at step 5 before it ever reaches
 * the isMP1 check at step 8 → meal penalty hour goes into hrsColumn1 (OT/Holiday)
 * instead of hrsColumn4 (MP).
 *
 * ─── Tests ───────────────────────────────────────────────────────────────────
 *
 * MP1 — Standard case (no pre-seeded holiday flags)
 *   Clock records have no holiday/OT flags.  Day of Week script doesn't touch
 *   $$unwork entries, so MP ends up correctly in hrsColumn4.
 *   PASSES (shows correct behavior when no inherited flags exist).
 *
 * MP2 — Holiday-flag inheritance case (triggers the write-to-disk bug)
 *   Clock records are inserted with isHoliday=1 to directly simulate the BHPL
 *   production scenario where holiday dates receive that flag via auto-enter.
 *   create-unworked-entry inherits isHoliday=1 into the MP entry.
 *   write-to-disk checks isHoliday before isMP1 → MP goes to hrsColumn1 (OT).
 *   FAILS, confirming the bug.
 */

import { afterAll, describe, expect, it } from "vitest";
import { db, TCL__TimeCardLine } from "../../../src/client.js";
import { cleanupAll } from "../../helpers/cleanup.js";
import {
	applyRules,
	assertId,
	createContractRule,
	createMealTCL,
	createTimeCard,
	deleteContractRule,
	findRule,
	getContract,
	getResultTCLs,
	requireEnv,
} from "../../helpers/factories.js";

// 2027-02-01 is a Monday (used for MP1).
const TEST_DATE_MP1 = "2027-02-01";
// 2027-02-08 is also a Monday (used for MP2 to avoid overlapping clock records with MP1).
const TEST_DATE_MP2 = "2027-02-08";

describe("Holiday Meal Penalty Bug", () => {
	const createdTcdIds: string[] = [];
	const createdCruIds: string[] = [];

	afterAll(async () => {
		for (const cruId of createdCruIds) {
			await deleteContractRule(cruId);
		}
		await cleanupAll(createdTcdIds);
	});

	/** Find any meal penalty rule available in the system. */
	async function findMealPenaltyRuleId(): Promise<string | null> {
		const names = [
			"Meal Penalty (definitive)",
			"Meal Penalty (limited)",
			"Meal Penalty",
		];
		for (const name of names) {
			try {
				const rule = await findRule(name);
				console.log(`Found meal penalty rule: "${name}" (${rule.__id})`);
				return assertId(rule);
			} catch {
				// try next
			}
		}
		return null;
	}

	// ---------------------------------------------------------------------------
	// MP1: Standard case — no pre-seeded holiday flags
	// ---------------------------------------------------------------------------
	it("MP1: meal penalty without inherited holiday flag — MP goes to hrsColumn4 (correct)", async () => {
		const contactId = requireEnv("TEST_CONTACT_ID");
		const eventId = requireEnv("TEST_EVENT_ID");
		const contractId = requireEnv("TEST_CONTRACT_ID_WORKED");
		const cjtId = requireEnv("TEST_CONTRACT_JOB_TITLE_ID_WORKED");

		const contract = await getContract(contractId);
		const otL1Mult = contract.mult_overtime_daily_L1 ?? 0;

		if (otL1Mult <= 0) {
			console.warn("Skipping MP1: mult_overtime_daily_L1 not set on test contract.");
			return;
		}

		// Day of Week CRU for Monday at OT L1 rate (simulates a holiday).
		const dowRule = await findRule("Day of Week");
		const dowCru = await createContractRule({
			ruleId: assertId(dowRule),
			contractId,
			day: "Monday",
			multiplier1: otL1Mult,
			scope: "",
		});
		createdCruIds.push(assertId(dowCru));

		// Meal Penalty CRU: fire after 6 hours; penalty = 1 hour.
		const mpRuleId = await findMealPenaltyRuleId();
		if (!mpRuleId) {
			console.warn("Skipping MP1: no meal penalty rule found.");
			return;
		}
		const mpCru = await createContractRule({
			ruleId: mpRuleId,
			contractId,
			hour1: 6,
			hour2: 1,
			scope: "",
		});
		createdCruIds.push(assertId(mpCru));

		const tcd = await createTimeCard({ contactId, eventId, contractId, date: TEST_DATE_MP1 });
		const tcdId = assertId(tcd);
		createdTcdIds.push(tcdId);

		// 06:00–12:30 (6.5h worked — crosses 6-hour meal threshold)
		await db.from(TCL__TimeCardLine).insert({
			_timecard_id: tcdId, _contact_id: contactId, _event_id: eventId,
			date: TEST_DATE_MP1, time_in: "06:00:00", time_out: "12:30:00",
			_contractJobTitle_id: cjtId,
			isBill: 0, isPay: 0, isMinimumCall: 0, isUnpaidMeal: 0,
			isPaidMeal: 0, isFlat: 0, isAfterMidnight: 0,
		}).execute();

		// 12:30–13:00 (paid meal, 30 min late)
		await createMealTCL({
			timecardId: tcdId, contactId, eventId, contractId,
			date: TEST_DATE_MP1, timeIn: "12:30:00", timeOut: "13:00:00",
			isPaidMeal: true,
		});

		// 13:00–17:30 (4.5h worked)
		await db.from(TCL__TimeCardLine).insert({
			_timecard_id: tcdId, _contact_id: contactId, _event_id: eventId,
			date: TEST_DATE_MP1, time_in: "13:00:00", time_out: "17:30:00",
			_contractJobTitle_id: cjtId,
			isBill: 0, isPay: 0, isMinimumCall: 0, isUnpaidMeal: 0,
			isPaidMeal: 0, isFlat: 0, isAfterMidnight: 0,
		}).execute();

		const result = await applyRules(tcdId);
		expect(result.error).toBe(0);

		const tcls = await getResultTCLs(tcdId);

		for (const r of tcls.all) {
			console.log(
				`  [MP1] ${r.time_in}-${r.time_out} hrsUnworked=${r.hrsUnworked} ` +
					`isMP1=${r.isMP1} isOTDailyL1=${r.isOTDailyL1} isDayOfWeek=${r.isDayOfWeek} ` +
					`isHoliday=${r.isHoliday} hrsColumn0=${r.hrsColumn0} hrsColumn1=${r.hrsColumn1} hrsColumn4=${r.hrsColumn4}`,
			);
		}

		// MP entry must exist.
		const mpEntries = tcls.unworked.filter((r) => r.isMP1 === 1 || r.isMP2 === 1);
		expect(mpEntries.length, "Meal penalty should fire").toBeGreaterThanOrEqual(1);

		// With no inherited holiday flag, the MP must land in the MP column.
		for (const mp of mpEntries) {
			expect(mp.isOTDailyL1, "MP entry must NOT have isOTDailyL1=1").toBe(0);
			expect(mp.hrsColumn4, "MP hour must be in hrsColumn4 (MP column)").toBeGreaterThan(0);
			expect(mp.hrsColumn1, "MP hour must NOT be in hrsColumn1 (OT column)").toBeFalsy();
		}
	});

	// ---------------------------------------------------------------------------
	// MP2: Holiday-flag inheritance — triggers the write-to-disk column-priority bug
	// ---------------------------------------------------------------------------
	it("MP2: MP entry inheriting isHoliday from source clock should land in hrsColumn4 (MP), not hrsColumn1 (OT)", async () => {
		const contactId = requireEnv("TEST_CONTACT_ID");
		const eventId = requireEnv("TEST_EVENT_ID");
		const contractId = requireEnv("TEST_CONTRACT_ID_WORKED");
		const cjtId = requireEnv("TEST_CONTRACT_JOB_TITLE_ID_WORKED");

		// Meal Penalty CRU only — the bug fires from isHoliday inheritance alone.
		const mpRuleId = await findMealPenaltyRuleId();
		if (!mpRuleId) {
			console.warn("Skipping MP2: no meal penalty rule found.");
			return;
		}
		const mpCru = await createContractRule({
			ruleId: mpRuleId,
			contractId,
			hour1: 6,
			hour2: 1,
			scope: "",
		});
		createdCruIds.push(assertId(mpCru));

		const tcd = await createTimeCard({ contactId, eventId, contractId, date: TEST_DATE_MP2 });
		const tcdId = assertId(tcd);
		createdTcdIds.push(tcdId);

		// Insert clock records with isHoliday=1 — replicating the BHPL production
		// scenario where FileMaker auto-enter sets isHoliday on TCLs whose date
		// falls on a holiday.  create-unworked-entry copies the source record
		// verbatim, so the MP entry inherits isHoliday=1.
		// write-to-disk then hits the isHoliday branch (step 5) before the
		// isMP1 branch (step 8) and routes the MP hour to hrsColumn1 (OT).

		// 06:00–12:30 (6.5h, isHoliday=1 — crosses 6-hour meal threshold)
		await db.from(TCL__TimeCardLine).insert({
			_timecard_id: tcdId, _contact_id: contactId, _event_id: eventId,
			date: TEST_DATE_MP2, time_in: "06:00:00", time_out: "12:30:00",
			_contractJobTitle_id: cjtId,
			isBill: 0, isPay: 0, isMinimumCall: 0, isUnpaidMeal: 0,
			isPaidMeal: 0, isFlat: 0, isAfterMidnight: 0,
			isHoliday: 1, // holiday flag — inherited by MP entry via create-unworked-entry
		}).execute();

		// 12:30–13:00 (paid meal, 30 min late)
		await createMealTCL({
			timecardId: tcdId, contactId, eventId, contractId,
			date: TEST_DATE_MP2, timeIn: "12:30:00", timeOut: "13:00:00",
			isPaidMeal: true,
		});

		// 13:00–17:30 (4.5h, isHoliday=1)
		await db.from(TCL__TimeCardLine).insert({
			_timecard_id: tcdId, _contact_id: contactId, _event_id: eventId,
			date: TEST_DATE_MP2, time_in: "13:00:00", time_out: "17:30:00",
			_contractJobTitle_id: cjtId,
			isBill: 0, isPay: 0, isMinimumCall: 0, isUnpaidMeal: 0,
			isPaidMeal: 0, isFlat: 0, isAfterMidnight: 0,
			isHoliday: 1, // holiday flag — inherited by MP entry via create-unworked-entry
		}).execute();

		const result = await applyRules(tcdId);
		expect(result.error).toBe(0);

		const tcls = await getResultTCLs(tcdId);

		for (const r of tcls.all) {
			console.log(
				`  [MP2] ${r.time_in}-${r.time_out} hrsUnworked=${r.hrsUnworked} ` +
					`isMP1=${r.isMP1} isOTDailyL1=${r.isOTDailyL1} ` +
					`isHoliday=${r.isHoliday} hrsColumn0=${r.hrsColumn0} hrsColumn1=${r.hrsColumn1} hrsColumn4=${r.hrsColumn4}`,
			);
		}

		const mpEntries = tcls.unworked.filter((r) => r.isMP1 === 1 || r.isMP2 === 1);
		expect(mpEntries.length, "Meal penalty should fire").toBeGreaterThanOrEqual(1);

		// BUG: write-to-disk-bh.md checks isHoliday (step 5 in cascade) before
		// isMP1/isMP2 (step 8).  The MP entry inherits isHoliday=1 from the
		// source clock record, so write-to-disk sends it to hrsColumn1 (OT/Holiday)
		// instead of hrsColumn4 (MP).
		//
		// These assertions express the CORRECT expected behavior.
		// MP2 currently FAILS, confirming the bug.
		for (const mp of mpEntries) {
			expect(
				mp.hrsColumn4 ?? 0,
				"BUG (write-to-disk-bh.md): MP hour should be in hrsColumn4 (MP column) " +
					"but isHoliday is checked before isMP1, routing it to hrsColumn1 instead",
			).toBeGreaterThan(0);

			expect(
				mp.hrsColumn1 ?? 0,
				"BUG: MP hour must NOT be in hrsColumn1 (OT/Holiday column)",
			).toBe(0);
		}
	});
});
