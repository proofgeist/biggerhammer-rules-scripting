/**
 * Test Case 4: Regression — minimums_are_worked_time = True
 *
 * Verifies that the changes are no-ops when minimums_are_worked_time = True.
 * The unworked loops and MC credit scan should find nothing and have no effect.
 * Behavior should be identical to before our changes.
 */
import { describe, it, expect, afterAll } from "vitest";
import {
  createTimeCard,
  createClockTCL,
  applyRules,
  getResultTCLs,
} from "../helpers/factories.js";
import { cleanupAll } from "../helpers/cleanup.js";

// Each test uses a unique date to avoid overlap detection across test runs
const TEST_DATE_1 = "2026-04-06";
const TEST_DATE_2 = "2026-04-07";

describe("Regression — minimums_are_worked_time = True", () => {
  const createdTcdIds: string[] = [];

  afterAll(async () => {
    await cleanupAll(createdTcdIds);
  });

  it("should produce minimum call entries as worked (billable) records", async () => {
    const contactId = process.env.TEST_CONTACT_ID!;
    const eventId = process.env.TEST_EVENT_ID!;
    const contractId = process.env.TEST_CONTRACT_ID_WORKED!;

    const tcd = await createTimeCard({
      contactId,
      eventId,
      contractId,
      date: TEST_DATE_1,
    });
    createdTcdIds.push(tcd.__id!);

    // Short work segment — should trigger minimum call
    await createClockTCL({
      timecardId: tcd.__id!,
      contactId,
      eventId,
      contractId,
      date: TEST_DATE_1,
      timeIn: "09:00:00",
      timeOut: "10:00:00",
    });

    const result = await applyRules(tcd.__id!);
    expect(result.error).toBe(0);

    const tcls = await getResultTCLs(tcd.__id!);

    // With worked minimums, MC entries go to bill/pay arrays
    // So we should see isMinimumCall records in billable
    const billMC = tcls.billable.filter((r) => r.isMinimumCall);
    expect(billMC.length).toBeGreaterThan(0);

    // There should be NO minimum call entries in unworked
    const unworkedMC = tcls.unworked.filter((r) => r.isMinimumCall);
    expect(unworkedMC.length).toBe(0);
  });

  it("should complete without errors on multi-break time cards", async () => {
    const contactId = process.env.TEST_CONTACT_ID!;
    const eventId = process.env.TEST_EVENT_ID!;
    const contractId = process.env.TEST_CONTRACT_ID_WORKED!;

    const tcd = await createTimeCard({
      contactId,
      eventId,
      contractId,
      date: TEST_DATE_2,
    });
    createdTcdIds.push(tcd.__id!);

    // 3 segments with breaks
    await createClockTCL({
      timecardId: tcd.__id!,
      contactId,
      eventId,
      contractId,
      date: TEST_DATE_2,
      timeIn: "06:00:00",
      timeOut: "10:00:00",
    });
    await createClockTCL({
      timecardId: tcd.__id!,
      contactId,
      eventId,
      contractId,
      date: TEST_DATE_2,
      timeIn: "11:00:00",
      timeOut: "15:00:00",
    });
    await createClockTCL({
      timecardId: tcd.__id!,
      contactId,
      eventId,
      contractId,
      date: TEST_DATE_2,
      timeIn: "16:00:00",
      timeOut: "20:00:00",
    });

    const result = await applyRules(tcd.__id!);
    expect(result.error).toBe(0);

    const tcls = await getResultTCLs(tcd.__id!);

    // All 3 Clock lines should have produced billable records
    expect(tcls.billable.length).toBeGreaterThanOrEqual(3);

    // All 3 Clock lines should have produced payable records
    expect(tcls.payable.length).toBeGreaterThanOrEqual(3);

    // No unworked minimum call entries (worked path)
    const unworkedMC = tcls.unworked.filter((r) => r.isMinimumCall);
    expect(unworkedMC.length).toBe(0);
  });
});
