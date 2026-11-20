import type { AuthContext } from "@/lib/api/auth";
import { createClient } from "@/lib/supabase/server";
import { branchMemberIds } from "@/lib/leads/branch-membership";
import { visibleLeadsBase } from "@/lib/leads/visibility-query";
import type { HomeScope } from "../lib/scope";
import type { HomeDb } from "./load-home";

type ManagerScope = Extract<HomeScope, { mode: "manager" }>;

/** A `leads` query builder already narrowed to the manager's scope. Chain your own filters on it. */
export interface ScopedLeads {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  select(columns: string, opts?: { count?: "exact"; head?: boolean }): any;
  /** For the UI: "all branches" or the branch name's definition in words. */
  definition: "tenant" | "branch-members" | "branch-visibility";
}

/**
 * The leads a manager may see, using the SAME definitions as the leads list (never `leads.branch_id` alone):
 *   - team-scope manager pinned to a branch: `leads_visible_to_user(scope 'branch')` via `visibleLeadsBase`, the list's own
 *     path: assigned to a member of the branch, OR unassigned with leads.branch_id = branch, OR a `lead_branches` row.
 *   - owner / admin with the header picker on a branch: the list's `?branch_id=` filter: assigned to a member of that branch
 *     (`branchMemberIds`).
 *   - owner / admin on "Overall": every non-deleted lead in the tenant (the caller adds deleted_at).
 */
export async function makeLeadScope(db: HomeDb, auth: AuthContext, scope: ManagerScope): Promise<ScopedLeads> {
  if (scope.pinned && scope.branchId) {
    const user = await createClient();
    const branchId = scope.branchId;
    return {
      definition: "branch-visibility",
      select: (columns, opts) => {
        const base = visibleLeadsBase({ user, service: db.raw() }, auth.tenantId, { branchId }, opts);
        return opts?.head ? base : base.select(columns);
      },
    };
  }
  if (scope.branchId) {
    const members = await branchMemberIds(db.raw(), auth.tenantId, scope.branchId);
    return { definition: "branch-members", select: (columns, opts) => db.from("leads").select(columns, opts).in("assigned_to", members) };
  }
  return { definition: "tenant", select: (columns, opts) => db.from("leads").select(columns, opts) };
}
