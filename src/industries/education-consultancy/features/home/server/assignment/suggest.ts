import { logger } from "@/lib/logger";
import { EMPTY_SUGGESTION, suggestAssignments, type NewLeadSuggestion, type SuggestLead } from "../../lib/assignment/suggest";
import { buildPool } from "./engine";
import type { TenantDb } from "./settings";

const CHUNK = 100;

/** lead id → the engine's stored pick, for leads whose shadow decision nobody has acted on. Chunked: 500 uuids in one `.in()` overflow the request URL. */
async function openShadowPicks(db: TenantDb, leadIds: string[]): Promise<Map<string, string>> {
  const picks = new Map<string, string>();
  for (let i = 0; i < leadIds.length; i += CHUNK) {
    const { data, error } = await db.from("lead_assignment_decisions").select("lead_id, picked_user_id").eq("mode", "shadow").is("outcome", null).in("lead_id", leadIds.slice(i, i + CHUNK));
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as unknown as Array<{ lead_id: string; picked_user_id: string | null }>) if (r.picked_user_id) picks.set(r.lead_id, r.picked_user_id);
  }
  return picks;
}

/**
 * "Who would smart assignment give these unassigned leads to?" Builds the pool ONCE (`buildPool`: the people the live process
 * names for first contact), reads each lead's own signals (destinations, branch), uses the engine's stored pick for any lead with
 * an open shadow decision, and runs the real decision lead by lead for the rest (`suggestAssignments`).
 * Reads only: nothing is assigned and no decision row is stored, in any assignment mode, off included.
 * A read failure returns "no suggestion" (the row falls back to Review), never a wrong name.
 */
export async function suggestForLeads(db: TenantDb, tenantId: string, leadIds: string[], opts: { branchId?: string | null; now?: Date } = {}): Promise<NewLeadSuggestion> {
  if (leadIds.length === 0) return EMPTY_SUGGESTION;
  try {
    const leads: SuggestLead[] = [];
    for (let i = 0; i < leadIds.length; i += CHUNK) {
      const { data, error } = await db.from("leads").select("id, created_at, branch_id, destinations").in("id", leadIds.slice(i, i + CHUNK)).is("deleted_at", null).is("assigned_to", null);
      if (error) throw new Error(error.message);
      leads.push(...((data ?? []) as unknown as SuggestLead[]));
    }
    if (leads.length === 0) return EMPTY_SUGGESTION;
    const storedPicks = await openShadowPicks(db, leads.map((l) => l.id));
    const { pool, team } = await buildPool(db, tenantId, opts.now ?? new Date());
    return suggestAssignments(leads, pool, team, { branchId: opts.branchId ?? null, storedPicks });
  } catch (e) {
    logger.error({ err: e instanceof Error ? e.message : String(e), tenantId }, "assignment suggestion failed");
    return { assignments: [], placed: 0, unplaced: leadIds.length, reason: null, failed: true };
  }
}
