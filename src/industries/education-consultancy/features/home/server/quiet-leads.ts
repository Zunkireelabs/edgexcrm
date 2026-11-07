import { staleCutoff } from "../lib/stale-callbacks";
import type { ScopedLeads } from "./lead-scope";

export interface QuietOver {
  total: number;
  /** People with the most leads that nobody has contacted for over 2 weeks, biggest first. */
  byPerson: Array<{ userId: string; count: number }>;
}

/**
 * Leads held by someone, in an active (non-archive, non-staging) list, not on hold, with NO contact for over 14 tenant-local
 * days. Exact predicate (same cutoff instant as stale call-backs: local midnight of tenant-today - 14):
 *   deleted_at IS NULL AND archived_at IS NULL AND assigned_to IS NOT NULL AND on_hold IS NOT TRUE AND list_id IN (active)
 *   AND ( last_touched_at < cutoff
 *      OR (last_touched_at IS NULL AND assigned_at < cutoff)
 *      OR (last_touched_at IS NULL AND assigned_at IS NULL AND created_at < cutoff) )
 * "Contact" = lib/contact.ts (last_touched_at moves on calls, emails, meetings and notes).
 * One exact head count for the total, plus one per person (`peopleIds`, the team in scope) to rank them.
 */
export async function loadQuietOverTwoWeeks(leads: ScopedLeads, activeListIds: string[], peopleIds: string[], now: Date, tz: string): Promise<QuietOver> {
  if (activeListIds.length === 0) return { total: 0, byPerson: [] };
  const cutoff = staleCutoff(now, tz).toISOString();
  const quiet = (count: boolean) =>
    leads
      .select("id", count ? { count: "exact", head: true } : undefined)
      .is("deleted_at", null)
      .is("archived_at", null)
      .not("assigned_to", "is", null)
      .or("on_hold.is.null,on_hold.eq.false")
      .in("list_id", activeListIds)
      .or(`last_touched_at.lt.${cutoff},and(last_touched_at.is.null,assigned_at.lt.${cutoff}),and(last_touched_at.is.null,assigned_at.is.null,created_at.lt.${cutoff})`);
  const [{ count }, per] = await Promise.all([
    quiet(true),
    Promise.all(peopleIds.map(async (userId) => ({ userId, count: (await quiet(true).eq("assigned_to", userId)).count ?? 0 }))),
  ]);
  return { total: count ?? 0, byPerson: per.filter((p) => p.count > 0).sort((a, b) => b.count - a.count) };
}
