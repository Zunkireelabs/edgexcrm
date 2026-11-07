import type { AuthContext } from "@/lib/api/auth";
import { applyLeadPatch, type ApplyLeadPatchOutcome } from "@/lib/leads/apply-lead-patch";
import { CLEAR_MAX, staleCutoff } from "../lib/stale-callbacks";
import type { HomeScope } from "../lib/scope";
import type { HomeDb } from "./load-home";

type ManagerScope = Extract<HomeScope, { mode: "manager" }>;

/** Leads in the manager's scope whose call-back reminder is over 14 tenant-local days old. */
function staleQuery(db: HomeDb, scope: ManagerScope, cutoff: Date, columns: string, count: boolean) {
  let q = db
    .from("leads")
    .select(columns, count ? { count: "exact", head: true } : undefined)
    .is("deleted_at", null)
    .not("callback_due_at", "is", null)
    .lt("callback_due_at", cutoff.toISOString());
  // Scope = the leads list's: a branch-pinned manager, or an owner / admin narrowed by the branch picker.
  if (scope.branchId) q = q.eq("branch_id", scope.branchId);
  return q;
}

export async function countStaleCallbacks(db: HomeDb, scope: ManagerScope, now: Date, tz: string): Promise<number> {
  const { count, error } = await staleQuery(db, scope, staleCutoff(now, tz), "id", true);
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
  db: HomeDb,
  auth: AuthContext,
  scope: ManagerScope,
  now: Date,
  tz: string,
  patch: (auth: AuthContext, id: string, body: Record<string, unknown>) => Promise<ApplyLeadPatchOutcome> = (a, id, body) =>
    applyLeadPatch(a, id, body, { requestId: crypto.randomUUID(), ip: null, userAgent: null }),
): Promise<ClearResult> {
  const cutoff = staleCutoff(now, tz);
  const { data } = await staleQuery(db, scope, cutoff, "id", false).order("callback_due_at", { ascending: true }).limit(CLEAR_MAX);
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
  return { cleared, failed, remaining: await countStaleCallbacks(db, scope, now, tz) };
}
