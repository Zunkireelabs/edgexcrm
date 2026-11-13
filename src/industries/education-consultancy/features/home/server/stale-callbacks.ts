import type { AuthContext } from "@/lib/api/auth";
import { applyLeadPatch, type ApplyLeadPatchOutcome } from "@/lib/leads/apply-lead-patch";
import { CLEAR_MAX, staleCutoff } from "../lib/stale-callbacks";
import type { ScopedLeads } from "./lead-scope";

/**
 * Leads in the manager's scope (`ScopedLeads`: the leads list's own branch definitions) whose call-back reminder is over 14
 * tenant-local days old. Exact predicate:
 *   deleted_at IS NULL AND callback_due_at IS NOT NULL AND callback_due_at < local midnight of (tenant today - 14 days)
 * (so day 14 is still "missed" and day 15 is stale), plus the scope.
 */
function staleQuery(leads: ScopedLeads, cutoff: Date, columns: string, count: boolean) {
  return leads
    .select(columns, count ? { count: "exact", head: true } : undefined)
    .is("deleted_at", null)
    .not("callback_due_at", "is", null)
    .lt("callback_due_at", cutoff.toISOString());
}

export async function countStaleCallbacks(leads: ScopedLeads, now: Date, tz: string): Promise<number> {
  const { count, error } = await staleQuery(leads, staleCutoff(now, tz), "id", true);
  return error ? 0 : count ?? 0;
}

export interface ClearResult {
  cleared: number;
  failed: number;
  remaining: number;
}

const CONCURRENCY = 8;

/**
 * Clears `callback_due_at` on the stale set through the SAME audited patch path as every other lead edit
 * (`applyLeadPatch`, so each change leaves an audit_logs row and follows the person's edit rules). The set is recomputed
 * here from scope + age; ids never come from the client. At most CLEAR_MAX leads per call, oldest reminders first.
 * Idempotent: a cleared lead no longer matches, so a second call finds nothing new.
 */
export async function clearStaleCallbacks(
  leads: ScopedLeads,
  auth: AuthContext,
  now: Date,
  tz: string,
  patch: (auth: AuthContext, id: string, body: Record<string, unknown>) => Promise<ApplyLeadPatchOutcome> = (a, id, body) =>
    applyLeadPatch(a, id, body, { requestId: crypto.randomUUID(), ip: null, userAgent: null }),
): Promise<ClearResult> {
  const cutoff = staleCutoff(now, tz);
  const { data } = await staleQuery(leads, cutoff, "id", false).order("callback_due_at", { ascending: true }).limit(CLEAR_MAX);
  const ids = ((data ?? []) as unknown as Array<{ id: string }>).map((r) => r.id);
  let cleared = 0;
  let failed = 0;
  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const results = await Promise.all(
      ids.slice(i, i + CONCURRENCY).map((id) => patch(auth, id, { callback_due_at: null }).catch(() => null)),
    );
    for (const r of results) {
      if (r && r.kind === "ok") cleared += 1;
      else failed += 1;
    }
  }
  return { cleared, failed, remaining: await countStaleCallbacks(leads, now, tz) };
}
