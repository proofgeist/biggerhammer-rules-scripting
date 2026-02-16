/**
 * Empty Time Card Test
 *
 * Verifies that the rules engine gracefully handles a time card with
 * NO clock entries. The engine should not crash and should produce
 * zero billable, payable, and unworked result lines.
 */

import { afterAll, describe, expect, it } from "vitest";
import { cleanupAll } from "../../helpers/cleanup.js";
import {
	applyRules,
	assertId,
	createTimeCard,
	getResultTCLs,
	requireEnv,
} from "../../helpers/factories.js";

const TEST_DATE = "2027-08-01";

describe("Empty Time Card", () => {
	const createdTcdIds: string[] = [];

	afterAll(async () => {
		await cleanupAll(createdTcdIds);
	});

	it("should not crash and should produce zero result lines when no clock entries exist", async () => {
		const contactId = requireEnv("TEST_CONTACT_ID");
		const eventId = requireEnv("TEST_EVENT_ID");
		const contractId = requireEnv("TEST_CONTRACT_ID_WORKED");

		// Create a Time Card with NO Clock TCLs
		const tcd = await createTimeCard({
			contactId,
			eventId,
			contractId,
			date: TEST_DATE,
		});
		const tcdId = assertId(tcd);
		createdTcdIds.push(tcdId);

		console.log(`Created empty TCD ${tcdId} on ${TEST_DATE}`);

		// Apply rules to the empty time card
		const result = await applyRules(tcdId);

		console.log(`applyRules error code: ${result.error}`);

		// The engine should not crash (error = 0)
		expect(result.error, "Rules engine should not crash on empty time card").toBe(0);

		// Fetch result TCLs — there should be nothing
		const tcls = await getResultTCLs(tcdId);

		console.log(
			`Result counts: billable=${tcls.billable.length} payable=${tcls.payable.length} unworked=${tcls.unworked.length}`,
		);

		expect(
			tcls.billable.length,
			"Empty time card should produce zero billable entries",
		).toBe(0);

		expect(
			tcls.payable.length,
			"Empty time card should produce zero payable entries",
		).toBe(0);

		expect(
			tcls.unworked.length,
			"Empty time card should produce zero unworked entries",
		).toBe(0);
	});
});
