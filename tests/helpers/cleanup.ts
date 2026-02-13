import { eq } from "@proofkit/fmodata";
import { db, TCL__TimeCardLine, TCD__TimeCard } from "../../src/client.js";

/**
 * Delete all TCL records for a given Time Card, then delete the Time Card itself.
 */
export async function deleteTimeCard(timecardId: string) {
  // Delete child TCLs first
  await db
    .from(TCL__TimeCardLine)
    .delete()
    .where((q) => q.where(eq(TCL__TimeCardLine._timecard_id, timecardId)))
    .execute();

  // Ignore errors on TCL delete (may have no children)

  // Delete the Time Card (use .where() instead of .byId() to avoid
  // OData entity key type mismatch — FM's entity key is numeric, not the text __id)
  const tcdResult = await db
    .from(TCD__TimeCard)
    .delete()
    .where((q) => q.where(eq(TCD__TimeCard.__id, timecardId)))
    .execute();

  if (tcdResult.error) {
    console.warn(`Warning: Failed to delete TimeCard ${timecardId}:`, tcdResult.error);
  }
}

/**
 * Clean up multiple Time Cards and their children.
 */
export async function cleanupAll(timecardIds: string[]) {
  for (const id of timecardIds) {
    await deleteTimeCard(id);
  }
}
