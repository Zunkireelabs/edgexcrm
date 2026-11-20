import type { SupabaseClient } from "@supabase/supabase-js";
import { leadQueryScope, type ResolvedPermissions } from "@/lib/api/permissions";
import { branchMemberIds } from "@/lib/leads/branch-membership";
import { visibleLeadsBase } from "@/lib/leads/visibility-query";
import { POSITION_ROUTE_MAP } from "@/industries/education-consultancy/features/new-leads-triage/position-routing";
import type { ApplicationsScope } from "./applications-query";
import { fetchAllPages } from "./board-counts";

// THE one role-scoping rule for application LISTS (EDGEX-141 Phase 3, B1): the board page, the
// board-page API and GET /api/v1/applications all call this, so they can never disagree.
//   own scope    -> lead ids from leads_visible_to_user() (collaborator-aware), paged past 1000
//   branch scope -> the branch's member user ids (filtered via the embedded lead's assigned_to)
//   all          -> no restriction
// A failed visibility read fails CLOSED (no leads), never open.

/** Structural subset of both AuthContext (API routes) and getCurrentUserTenant() (pages). */
export interface ApplicationsScopeAuth {
  tenantId: string;
  userId: string;
  industryId: string | null;
  permissions: ResolvedPermissions;
  branchId: string | null;
  positionSlug: string | null;
}

export interface ApplicationsScopeClients {
  /** RLS-context client: leads_visible_to_user() needs a real auth.uid(). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  user: SupabaseClient<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  service: SupabaseClient<any>;
}

export interface ResolvedApplicationsScope {
  scope: ApplicationsScope;
  /** Set when the own-scope visibility read failed (the scope is then empty: fail closed). */
  error: string | null;
  kind: "own" | "branch" | "all";
}

export async function resolveApplicationsScope(
  clients: ApplicationsScopeClients,
  auth: ApplicationsScopeAuth,
): Promise<ResolvedApplicationsScope> {
  const poolSlug =
    auth.industryId === "education_consultancy" && auth.positionSlug && auth.branchId
      ? (POSITION_ROUTE_MAP[auth.positionSlug] ?? null)
      : null;
  const scope = leadQueryScope(auth.permissions, auth.userId, auth.branchId ?? null, poolSlug);

  if (scope.restrictToSelf && scope.userId) {
    let error: string | null = null;
    // The RPC is uncapped in SQL, but PostgREST still caps each RESPONSE at 1000 rows: page it.
    const rows = await fetchAllPages(async (from, to) => {
      if (error) return [];
      const { data, error: e } = await visibleLeadsBase(clients, auth.tenantId, scope)
        .select("id")
        .is("deleted_at", null)
        .order("id")
        .range(from, to);
      if (e) {
        error = e.message ?? String(e);
        return [];
      }
      return (data ?? []) as { id: string }[];
    });
    if (error) return { scope: { leadIds: [], teamMemberIds: null }, error, kind: "own" };
    return { scope: { leadIds: rows.map((l) => l.id), teamMemberIds: null }, error: null, kind: "own" };
  }
  if (scope.branchId) {
    const members = await branchMemberIds(clients.service, auth.tenantId, scope.branchId);
    return { scope: { leadIds: null, teamMemberIds: members }, error: null, kind: "branch" };
  }
  return { scope: { leadIds: null, teamMemberIds: null }, error: null, kind: "all" };
}
