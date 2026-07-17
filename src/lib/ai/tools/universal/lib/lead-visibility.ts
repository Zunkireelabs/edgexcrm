/**
 * Lead visibility helpers for the AI tools — reimplements the read-only
 * queries from src/lib/leads/branch-membership.ts + collaborators.ts
 * against `ScopedClient` (tenant filter auto-injected) instead of a raw
 * `SupabaseClient<any>` + explicit tenantId, because src/lib/ai/ is
 * ESLint-forbidden from touching the raw service client / scopedClient's
 * raw() escape hatch. Same tables, same filters, same semantics — kept in
 * sync with GET /api/v1/leads, GET /api/v1/leads/[id], and
 * GET /api/v1/leads/[id]/activities if those routes' scoping changes.
 */
import type { ScopedClient } from "@/lib/supabase/scoped";
import type { AuthContext } from "@/lib/api/auth";
import { leadQueryScope, isSharedPoolList } from "@/lib/api/permissions";
import { POSITION_ROUTE_MAP } from "@/industries/education-consultancy/features/new-leads-triage/position-routing";

export type LeadMembership = { branch_id: string; assigned_to: string | null; is_origin: boolean }[];

export async function getLeadMembership(db: ScopedClient, leadId: string): Promise<LeadMembership> {
  const { data } = await db.from("lead_branches").select("branch_id, assigned_to, is_origin").eq("lead_id", leadId);
  return ((data ?? []) as unknown as Array<{ branch_id: string; assigned_to: string | null; is_origin: boolean }>).map((r) => ({
    branch_id: r.branch_id,
    assigned_to: r.assigned_to ?? null,
    is_origin: r.is_origin ?? false,
  }));
}

export async function branchMemberIds(db: ScopedClient, branchId: string): Promise<string[]> {
  const { data } = await db.from("tenant_users").select("user_id").eq("branch_id", branchId);
  return ((data ?? []) as unknown as Array<{ user_id: string }>).map((r) => r.user_id);
}

export async function sharedBranchLeadIdsForAssignee(db: ScopedClient, userId: string): Promise<string[]> {
  const { data } = await db.from("lead_branches").select("lead_id").eq("assigned_to", userId);
  return ((data ?? []) as unknown as Array<{ lead_id: string }>).map((r) => r.lead_id);
}

const COLLABORATOR_ID_CAP = 300;

export async function collaboratorLeadIdsForUser(db: ScopedClient, userId: string): Promise<string[]> {
  const { data } = await db
    .from("lead_collaborators")
    .select("lead_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(COLLABORATOR_ID_CAP);
  return ((data ?? []) as unknown as Array<{ lead_id: string }>).map((r) => r.lead_id);
}

export async function isLeadCollaborator(db: ScopedClient, leadId: string, userId: string): Promise<boolean> {
  const { data } = await db
    .from("lead_collaborators")
    .select("lead_id")
    .eq("lead_id", leadId)
    .eq("user_id", userId)
    .maybeSingle();
  return !!data;
}

export async function unassignedCrossBranchLeadIds(
  db: ScopedClient,
  branchId: string,
  listSlug: string,
): Promise<string[]> {
  const { data: lbRows } = await db
    .from("lead_branches")
    .select("lead_id")
    .eq("branch_id", branchId)
    .is("assigned_to", null)
    .eq("is_origin", false);
  const leadIds = ((lbRows ?? []) as unknown as Array<{ lead_id: string }>).map((r) => r.lead_id);
  if (leadIds.length === 0) return [];

  const { data: listRows } = await db.from("lead_lists").select("id").eq("slug", listSlug);
  const listIds = ((listRows ?? []) as unknown as Array<{ id: string }>).map((r) => r.id);
  if (listIds.length === 0) return [];

  const { data: leads } = await db
    .from("leads")
    .select("id")
    .in("id", leadIds)
    .in("list_id", listIds)
    .is("assigned_to", null)
    .is("deleted_at", null);
  return ((leads ?? []) as unknown as Array<{ id: string }>).map((r) => r.id);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LeadsQuery = any;

// A Postgrest query builder is a "thenable" (it has .then() so `await query`
// runs it) — an async function that `return`s one gets it silently awaited
// (executed) as part of settling the function's own promise, handing the
// caller a resolved `{data, error}` instead of the builder. So the async ID
// lookups and the synchronous query-chaining are deliberately split into two
// functions below; never merge them back into one `async` function that
// returns a builder.
type LeadVisibilityPlan =
  | { kind: "shared-pool"; memberIds: string[] }
  | { kind: "own-scope"; userId: string; extraIds: string[] }
  | { kind: "team-branch"; branchMemberIds: string[]; sharedLeadIds: string[] }
  | { kind: "all-scope" };

export async function resolveLeadVisibilityPlan(
  db: ScopedClient,
  auth: AuthContext,
  resolvedListId: string | null,
): Promise<LeadVisibilityPlan> {
  const scope = leadQueryScope(auth.permissions, auth.userId, auth.branchId);

  if (auth.branchId && isSharedPoolList(auth.permissions, resolvedListId)) {
    const memberIds = await branchMemberIds(db, auth.branchId);
    return { kind: "shared-pool", memberIds };
  }

  if (scope.restrictToSelf) {
    const poolSlug =
      auth.industryId === "education_consultancy" && auth.positionSlug && auth.branchId
        ? (POSITION_ROUTE_MAP[auth.positionSlug] ?? null)
        : null;
    const [sharedIds, collabIds, poolIds] = await Promise.all([
      sharedBranchLeadIdsForAssignee(db, auth.userId),
      collaboratorLeadIdsForUser(db, auth.userId),
      poolSlug && auth.branchId ? unassignedCrossBranchLeadIds(db, auth.branchId, poolSlug) : Promise.resolve([]),
    ]);
    const rawExtra = [...new Set([...sharedIds, ...collabIds, ...poolIds])];
    return { kind: "own-scope", userId: auth.userId, extraIds: rawExtra.slice(0, 300) };
  }

  if (scope.branchId) {
    const { data: sharedRows } = await db.from("lead_branches").select("lead_id").eq("branch_id", scope.branchId);
    const sharedLeadIds = ((sharedRows ?? []) as unknown as Array<{ lead_id: string }>).map((r) => r.lead_id);
    return { kind: "team-branch", branchMemberIds: auth.branchMemberIds, sharedLeadIds };
  }

  return { kind: "all-scope" };
}

/**
 * Applies a previously-resolved LeadVisibilityPlan (own/team/all + branch
 * shared-pool + cross-branch pool + pipeline-access) to a leads query already
 * filtered to tenant/deleted_at/list. Mirrors GET /api/v1/leads — keep in
 * lockstep with that route's GET handler.
 *
 * Deliberately synchronous — see the LeadVisibilityPlan comment above for
 * why an async function must never `return` a query builder. Call
 * `await resolveLeadVisibilityPlan(...)` first, then this.
 */
export function applyLeadVisibilityPlan(query: LeadsQuery, plan: LeadVisibilityPlan, auth: AuthContext): LeadsQuery {
  let scoped = query;

  switch (plan.kind) {
    case "shared-pool":
      scoped = scoped.in("assigned_to", plan.memberIds);
      break;
    case "own-scope":
      scoped =
        plan.extraIds.length > 0
          ? scoped.or(`assigned_to.eq.${plan.userId},id.in.(${plan.extraIds.join(",")})`)
          : scoped.eq("assigned_to", plan.userId);
      break;
    case "team-branch":
      if (plan.branchMemberIds.length > 0 && plan.sharedLeadIds.length > 0) {
        scoped = scoped.or(
          `assigned_to.in.(${plan.branchMemberIds.join(",")}),id.in.(${plan.sharedLeadIds.join(",")})`,
        );
      } else if (plan.sharedLeadIds.length > 0) {
        scoped = scoped.in("id", plan.sharedLeadIds);
      } else {
        scoped = scoped.in("assigned_to", plan.branchMemberIds);
      }
      break;
    case "all-scope":
      break;
  }

  if (auth.permissions.pipelineAccess !== "all") {
    scoped = scoped.in("pipeline_id", [...auth.permissions.pipelineAccess.ids]);
  }

  return scoped;
}


/**
 * Can this user see `lead` per GET /api/v1/leads/[id]'s rules — own-scope
 * assignee/collaborator, team-scope branch membership, cross-branch pool,
 * or pipeline access? Mirrors that route's GET handler.
 */
export async function canViewLead(
  db: ScopedClient,
  auth: AuthContext,
  lead: { id: string; assigned_to: string | null; branch_id: string | null; pipeline_id: string; list_id?: string | null },
): Promise<boolean> {
  const membership = await getLeadMembership(db, lead.id);
  const scope = leadQueryScope(auth.permissions, auth.userId, auth.branchId);

  if (scope.restrictToSelf) {
    const isAssignee = membership.some((m) => m.assigned_to === auth.userId) || lead.assigned_to === auth.userId;
    if (!isAssignee) {
      const isCollab = await isLeadCollaborator(db, lead.id, auth.userId);
      let isCrossBranchPoolLead = false;
      if (!isCollab && auth.industryId === "education_consultancy" && auth.positionSlug && auth.branchId) {
        const routeSlug = POSITION_ROUTE_MAP[auth.positionSlug];
        const inBranchUnassigned = membership.some(
          (m) => m.branch_id === auth.branchId && m.assigned_to === null && !m.is_origin,
        );
        if (routeSlug && inBranchUnassigned && lead.list_id) {
          const { data: listRow } = await db.from("lead_lists").select("slug").eq("id", lead.list_id).maybeSingle();
          isCrossBranchPoolLead = (listRow as { slug?: string } | null)?.slug === routeSlug;
        }
      }
      if (!isCollab && !isCrossBranchPoolLead) return false;
    }
  }

  if (scope.branchId) {
    const inBranch =
      membership.some((m) => m.branch_id === auth.branchId) ||
      lead.branch_id === auth.branchId ||
      (lead.assigned_to !== null && auth.branchMemberIds.includes(lead.assigned_to));
    if (!inBranch) return false;
  }

  if (auth.permissions.pipelineAccess !== "all" && !auth.permissions.pipelineAccess.ids.has(lead.pipeline_id)) {
    return false;
  }

  return true;
}
