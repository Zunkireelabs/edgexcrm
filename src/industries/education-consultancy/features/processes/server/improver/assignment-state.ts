import { decideAssignment } from "../../../home/lib/assignment/score";
import { buildPool } from "../../../home/server/assignment/engine";
import { loadAssignmentSettings } from "../../../home/server/assignment/settings";
import { shadowEvidence, type AssignmentState, type DecisionRow } from "../../lib/improver/assignment";
import { must } from "../changes";
import type { ProcessesDb } from "../context";


/**
 * Smart assignment's real state for Orca: the mode, the shadow history (decisions and agreement over 30 days, how long shadow has run) and
 * whether the engine's own planner finds anyone with room for a new lead today (`decideAssignment` over the real pool with a branch-less
 * lead: the same hard filters and today's cap that assign for real). Reads only. A failure returns null and Orca simply proposes no turn-on.
 */
export async function loadAssignmentState(db: ProcessesDb, tenantId: string, now: Date): Promise<AssignmentState | null> {
  try {
    const settings = await loadAssignmentSettings(db);
    const rows = (must("shadow decisions read", await db.from("lead_assignment_decisions").select("mode, outcome, created_at").eq("mode", "shadow").limit(5000)) as unknown as DecisionRow[] | null) ?? [];
    const { pool, team } = await buildPool(db, tenantId, now);
    const decision = decideAssignment({ destinations: [], branchId: null }, pool, team);
    const eligible = decision.candidates.filter((c) => c.eligible).length;
    return { mode: settings.mode, ...shadowEvidence(rows, now), capacity: { found: decision.pickedUserId !== null, eligible, poolSize: pool.length } };
  } catch {
    return null;
  }
}
