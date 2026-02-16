/**
 * Rule Discovery & Coverage Test
 *
 * Queries all available rules in the RUL__Rule table and documents which
 * ones have test coverage. For untested rules that can be tested via CRU
 * setup, creates basic smoke tests to verify they fire without errors.
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
	getResultTCLs,
	listRules,
	requireEnv,
} from "../../helpers/factories.js";

describe("Rule Discovery", () => {
	const createdTcdIds: string[] = [];
	const createdCruIds: string[] = [];

	afterAll(async () => {
		for (const cruId of createdCruIds) {
			await deleteContractRule(cruId);
		}
		await cleanupAll(createdTcdIds);
	});

	it("should list all available rules in the system", async () => {
		const rules = await listRules();

		console.log(`\n=== Available Rules (${rules.length} total) ===`);
		for (const r of rules) {
			console.log(
				`  Rule: "${r.name}" (ID: ${r.__id}) client="${r.client}" desc="${r.description}"`,
			);
		}

		expect(rules.length, "System should have at least one rule").toBeGreaterThan(
			0,
		);

		// Document which rules have existing test coverage
		const testedRules = [
			"Meal Penalty (definitive)",
			"Meal Penalty (limited)",
			"Minimum Calls",
			"Consecutive Days",
			"Day of Week",
		];

		const ruleNames = rules.map((r) => r.name);
		const untestedRules = ruleNames.filter(
			(name) => !testedRules.includes(name ?? ""),
		);

		console.log("\n=== Tested Rules ===");
		for (const name of testedRules) {
			const found = ruleNames.includes(name);
			console.log(`  ${found ? "✓" : "✗"} ${name}`);
		}

		console.log("\n=== Untested Rules (need coverage) ===");
		for (const name of untestedRules) {
			console.log(`  → ${name}`);
		}
	});

	it("should smoke-test each untested rule via CRU", { timeout: 120_000 }, async () => {
		const contactId = requireEnv("TEST_CONTACT_ID");
		const eventId = requireEnv("TEST_EVENT_ID");
		const contractId = requireEnv("TEST_CONTRACT_ID_WORKED");

		const rules = await listRules();

		// Rules that already have dedicated test files
		const alreadyTested = new Set([
			"Meal Penalty (definitive)",
			"Meal Penalty (limited)",
			"Minimum Calls",
			"Consecutive Days",
			"Day of Week",
		]);

		const untestedRules = rules.filter(
			(r) => r.name && !alreadyTested.has(r.name),
		);

		if (untestedRules.length === 0) {
			console.log("All rules have dedicated test coverage.");
			return;
		}

		// For each untested rule, create a CRU and run a basic smoke test
		let testIndex = 0;
		for (const rule of untestedRules) {
			testIndex++;
			const date = `2028-04-${String(testIndex).padStart(2, "0")}`;

			console.log(
				`\n--- Smoke testing rule: "${rule.name}" (${rule.__id}) ---`,
			);

			// Create a basic CRU for this rule with generic params
			const cru = await createContractRule({
				ruleId: rule.__id!,
				contractId,
				sequence: 100 + testIndex, // High sequence to avoid conflicts
				hour1: 8,
				multiplier1: 1.5,
				enabled: 1,
				scope: "",
			});
			const cruId = assertId(cru);
			createdCruIds.push(cruId);

			// Create a TCD + 8-hr clock
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
				timeIn: "08:00:00",
				timeOut: "16:00:00",
			});

			const result = await applyRules(tcdId);

			console.log(
				`  Rule "${rule.name}": error=${result.error}, message="${result.message}"`,
			);

			// The engine should not crash regardless of rule type
			expect(
				result.error,
				`Rule "${rule.name}" should not cause engine error`,
			).toBe(0);

			const tcls = await getResultTCLs(tcdId);

			console.log(
				`  Results: billable=${tcls.billable.length} payable=${tcls.payable.length} unworked=${tcls.unworked.length}`,
			);

			// Should produce at least billable entries
			expect(
				tcls.billable.length,
				`Rule "${rule.name}": should produce billable entries`,
			).toBeGreaterThanOrEqual(1);

			// Log all flags on the first billable entry for diagnostics
			if (tcls.billable.length > 0) {
				const b = tcls.billable[0];
				console.log(
					`  First billable: time=${b.time_in}-${b.time_out} ` +
						`isRecording=${b.isRecording} isDriveTime=${b.isDriveTime} ` +
						`isEarly=${b.isEarly} isTurnaround=${b.isTurnaround} ` +
						`isFlat=${b.isFlat} isContinuity=${b.isContinuity} ` +
						`isMisc1=${b.isMisc1} isMisc2=${b.isMisc2} ` +
						`isExpense=${b.isExpense}`,
				);
			}

			// Delete the CRU immediately to avoid affecting subsequent tests
			await deleteContractRule(cruId);
			// Remove from cleanup list since we already deleted it
			createdCruIds.pop();
		}
	});
});
