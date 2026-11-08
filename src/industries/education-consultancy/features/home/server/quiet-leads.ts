import { quietContactClauses, quietContactCutoff } from "@/lib/filters/quiet-contact";
import type { ScopedLeads } from "./lead-scope";
import { applyWorkable, type WorkablePlan } from "../lib/workable";

export interface QuietOver {
  total: number;
  /** People with the most leads that nobody has contacted for over 2 weeks, biggest first. */
  byPerson: Array<{ userId: string; count: number }>;
}

/**
 * Workable leads (lib/workable.ts: active list, not terminal / walk-in / on hold / archived / deleted) held by someone, with NO
 * contact for over 14 tenant-local days. Exact predicate (cutoff = local midnight of tenant-today - 14, lib/filters/quiet-contact.ts):
 *   workable AND assigned_to IS NOT NULL
 *   AND ( last_touched_at < cutoff
 *      OR (last_touched_at IS NULL AND assigned_at < cutoff)
 *      OR (last_touched_at IS NULL AND assigned_at IS NULL AND created_at < cutoff) )
 * "Contact" = lib/contact.ts (last_touched_at moves on calls, emails, meetings and notes).
 * One exact head count for the total, plus one per person (`peopleIds`, the team in scope) to rank them.
 */
export async function loadQuietOverTwoWeeks(leads: ScopedLeads, plan: WorkablePlan, peopleIds: string[], now: Date, tz: string): Promise<QuietOver> {
  if (plan.activeListIds.length === 0) return { total: 0, byPerson: [] };
  // The one shared test (lib/filters/quiet-contact.ts) — the same one the leads list's `no_contact_14d` filter compiles.
  const clauses = quietContactClauses(quietContactCutoff(now, tz));
  const quiet = (count: boolean) =>
    applyWorkable(leads.select("id", count ? { count: "exact", head: true } : undefined).not("assigned_to", "is", null), plan)
      .or(clauses.join(","));
  const [{ count }, per] = await Promise.all([
    quiet(true),
    Promise.all(peopleIds.map(async (userId) => ({ userId, count: (await quiet(true).eq("assigned_to", userId)).count ?? 0 }))),
  ]);
  return { total: count ?? 0, byPerson: per.filter((p) => p.count > 0).sort((a, b) => b.count - a.count) };
}
