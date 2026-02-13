/**
 * Test Case 3: MC + B/A Overlap Prevention
 *
 * Verifies that when Minimum Calls (rule 3) creates unworked entries and
 * Before/After Unpaid Meal (rule 4) runs next, B/A accounts for MC's
 * existing credit and doesn't double-count the shortfall.
 *
 * Setup: Contract where minimum call < before-meal requirement.
 * Worker works less than minimum before a meal break.
 *
 * Expected: Total unworked credit = before-meal requirement - actual work
 *           (not more — MC credit should be subtracted from B/A shortfall)
 *
 * Requires TEST_CONTRACT_ID_UNWORKED pointing to a contract where:
 * - minimums_are_worked_time = False
 * - hrs_minimum_call < hrs_before_unpaid_meal
 */
import { describe, it, expect, afterAll } from "vitest";
import { eq } from "@proofkit/fmodata";
import { db, CTR__Contract } from "../../src/client.js";
import {
  createTimeCard,
  createClockTCL,
  applyRules,
  getResultTCLs,
} from "../helpers/factories.js";
import { cleanupAll } from "../helpers/cleanup.js";

const TEST_DATE = "2026-03-23";

describe("MC + B/A Overlap Prevention", () => {
  const createdTcdIds: string[] = [];

  afterAll(async () => {
    await cleanupAll(createdTcdIds);
  });

  it("should not double-count unworked credits between MC and B/A", async () => {
    const contractId = process.env.TEST_CONTRACT_ID_UNWORKED;
    if (!contractId) {
      console.warn(
        "Skipping: TEST_CONTRACT_ID_UNWORKED not set."
      );
      return;
    }

    // Read the contract to understand its rule configuration
    const contractResult = await db
      .from(CTR__Contract)
      .list()
      .where(eq(CTR__Contract.__id, contractId))
      .execute();

    if (contractResult.error) {
      throw new Error(`Failed to read contract: ${contractResult.error}`);
    }
    if (contractResult.data.length === 0) {
      throw new Error(`Contract ${contractId} not found`);
    }
    const contract = contractResult.data[0];

    const hrsMinimum = contract.hrs_minimum_call ?? 0;
    const hrsBefore = contract.hrs_before_unpaid_meal ?? 0;

    // This test only makes sense when minimum < before-meal requirement
    if (hrsMinimum >= hrsBefore || hrsBefore === 0) {
      console.warn(
        `Skipping: Contract minimum (${hrsMinimum}) >= before-meal (${hrsBefore}). ` +
          `Need minimum < before-meal for this test.`
      );
      return;
    }

    const contactId = process.env.TEST_CONTACT_ID!;
    const eventId = process.env.TEST_EVENT_ID!;

    // Create a time card with a short work segment followed by a meal break
    const tcd = await createTimeCard({
      contactId,
      eventId,
      contractId,
      date: TEST_DATE,
    });
    createdTcdIds.push(tcd.__id!);

    // Work 1 hour, then a long break (triggers both MC and B/A)
    await createClockTCL({
      timecardId: tcd.__id!,
      contactId,
      eventId,
      contractId,
      date: TEST_DATE,
      timeIn: "09:00:00",
      timeOut: "10:00:00",
    });
    // Second segment after a break
    await createClockTCL({
      timecardId: tcd.__id!,
      contactId,
      eventId,
      contractId,
      date: TEST_DATE,
      timeIn: "14:00:00",
      timeOut: "18:00:00",
    });

    const result = await applyRules(tcd.__id!);
    expect(result.error).toBe(0);

    const tcls = await getResultTCLs(tcd.__id!);

    // Sum up total unworked hours (bill-side only — bill and pay are parallel,
    // so counting both would double the total)
    const billUnworked = tcls.unworked.filter((r) => r.isBill);
    let totalUnworkedHours = 0;
    for (const r of billUnworked) {
      if (r.hrsUnworked) {
        // hrsUnworked is a text field representing a time value
        // Parse "HH:MM:SS" or seconds
        const parts = r.hrsUnworked.split(":");
        if (parts.length === 3) {
          totalUnworkedHours +=
            parseInt(parts[0]) +
            parseInt(parts[1]) / 60 +
            parseInt(parts[2]) / 3600;
        }
      }
    }

    // The total unworked credit should be at most (before-meal - 1 hour of actual work).
    // Without the MC credit scan fix (#4), it would be higher due to double-counting.
    const maxExpectedUnworked = hrsBefore - 1; // 1 hour of actual work in first segment
    expect(totalUnworkedHours).toBeLessThanOrEqual(maxExpectedUnworked + 0.01);

    // Should not be zero — some shortfall entries should exist
    expect(totalUnworkedHours).toBeGreaterThan(0);
  });
});
