/**
 * Lead visibility helpers for the AI tools — reimplements the read-only
 * queries from src/lib/leads/branch-membership.ts + collaborators.ts
 * against `ScopedClient` (tenant filter auto-injected) instead of a raw
 * `SupabaseClient<any>` + explicit tenantId, because src/lib/ai/ is
 * ESLint-forbidden from touching the raw service client / scopedClient's
 * raw() escape hatch. Same tables, same filters, same semantics — kept in
 * sync with GET /api/v1/leads, GET /api/v1/leads/[id], and
 * GET /api/v1/leads/[id]/activities if those routes' scoping changes.
 *
 * Phase 5.1b (doc 03 §1): these helpers also run for a background agent's
 * AgentAuthContext, which has permissions but no session (no userId,
 * branchId, branchMemberIds, positionSlug). `actorUserId`/`actorBranchId`/
 * etc. below read those fields only when present (real `in` checks — an
 * AgentAuthContext object genuinely lacks them, not just typed as absent),
 * so an agent's scoping falls out of the SAME leadScope/pipelineAccess
 * permission logic real users go through, with one added fail-safe: a
 * `leadScope:"own"` (or "team" with no branch) actor with no real userId
 * cannot be scoped to an assignee, so it resolves to "sees nothing" rather
 * than querying with an undefined id. Lead Triage's position ships
 * leadScope:"all", so this fail-safe path is not its normal case.
 */
import type { ScopedClient } from "@/lib/supabase/scoped";
import type { AuthContext } from "@/lib/api/auth";
import type { AgentAuthContext } from "@/lib/ai/agent-auth";
import { isSharedPoolList, type ResolvedPermissions } from "@/lib/api/permissions";
import { POSITION_ROUTE_MAP } from "@/industries/education-consultancy/features/new-leads-triage/position-routing";
import { NIL_UUID } from "./sanitize";

type ScopedActor = AuthContext | AgentAuthContext;

export function actorUserId(auth: ScopedActor): string | undefined {
  return "userId" in auth ? auth.userId : undefined;
}
export function actorBranchId(auth: ScopedActor): string | null {
  return "branchId" in auth ? auth.branchId : null;
}
function actorBranchMemberIds(auth: ScopedActor): string[] {
  return "branchMemberIds" in auth ? auth.branchMemberIds : [];
}
function actorPositionSlug(auth: ScopedActor): string | null {
  return "positionSlug" in auth ? auth.positionSlug : null;
}

/**
 * Whether `auth` is restricted to its own leads (own-scope), computed
 * locally instead of via `leadQueryScope` (which requires a non-optional
 * `userId` — not every actor has one). Mirrors that function's §4.1 guard:
 * team-scoped with no branch falls back to own-only.
 */
export function isRestrictedToSelf(permissions: ResolvedPermissions, branchId: string | null): boolean {
  return permissions.leadScope === "own" || (permissions.leadScope === "team" && !branchId);
}

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
  | { kind: "all-scope" }
  | { kind: "none" };

export async function resolveLeadVisibilityPlan(
  db: ScopedClient,
  auth: ScopedActor,
  resolvedListId: string | null,
): Promise<LeadVisibilityPlan> {
  const userId = actorUserId(auth);
  const branchId = actorBranchId(auth);
  const restrictToSelf = isRestrictedToSelf(auth.permissions, branchId);

  // An own/team-no-branch actor with no real user id (a background agent —
  // see the file-header note) cannot be scoped to "its" leads at all: fail
  // safe to nothing rather than querying with an undefined assignee.
  if (restrictToSelf && !userId) {
    return { kind: "none" };
  }

  if (branchId && isSharedPoolList(auth.permissions, resolvedListId)) {
    const memberIds = await branchMemberIds(db, branchId);
    return { kind: "shared-pool", memberIds };
  }

  if (restrictToSelf && userId) {
    const positionSlug = actorPositionSlug(auth);
    const poolSlug =
      auth.industryId === "education_consultancy" && positionSlug && branchId
        ? (POSITION_ROUTE_MAP[positionSlug] ?? null)
        : null;
    const [sharedIds, collabIds, poolIds] = await Promise.all([
      sharedBranchLeadIdsForAssignee(db, userId),
      collaboratorLeadIdsForUser(db, userId),
      poolSlug && branchId ? unassignedCrossBranchLeadIds(db, branchId, poolSlug) : Promise.resolve([]),
    ]);
    const rawExtra = [...new Set([...sharedIds, ...collabIds, ...poolIds])];
    return { kind: "own-scope", userId, extraIds: rawExtra.slice(0, 300) };
  }

  if (auth.permissions.leadScope === "team" && branchId) {
    const { data: sharedRows } = await db.from("lead_branches").select("lead_id").eq("branch_id", branchId);
    const sharedLeadIds = ((sharedRows ?? []) as unknown as Array<{ lead_id: string }>).map((r) => r.lead_id);
    return { kind: "team-branch", branchMemberIds: actorBranchMemberIds(auth), sharedLeadIds };
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
export function applyLeadVisibilityPlan(query: LeadsQuery, plan: LeadVisibilityPlan, auth: ScopedActor): LeadsQuery {
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
    case "none":
      // No real id in this tenant will ever match — the deliberate "sees
      // nothing" fail-safe (see resolveLeadVisibilityPlan's file-header note).
      scoped = scoped.eq("id", NIL_UUID);
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
  auth: ScopedActor,
  lead: { id: string; assigned_to: string | null; branch_id: string | null; pipeline_id: string; list_id?: string | null },
): Promise<boolean> {
  const membership = await getLeadMembership(db, lead.id);
  const userId = actorUserId(auth);
  const branchId = actorBranchId(auth);
  const restrictToSelf = isRestrictedToSelf(auth.permissions, branchId);

  if (restrictToSelf) {
    // Same fail-safe as resolveLeadVisibilityPlan: no real user id to scope
    // "own" by means no visibility, not a crash on an undefined assignee.
    if (!userId) return false;

    const isAssignee = membership.some((m) => m.assigned_to === userId) || lead.assigned_to === userId;
    if (!isAssignee) {
      const isCollab = await isLeadCollaborator(db, lead.id, userId);
      let isCrossBranchPoolLead = false;
      const positionSlug = actorPositionSlug(auth);
      if (!isCollab && auth.industryId === "education_consultancy" && positionSlug && branchId) {
        const routeSlug = POSITION_ROUTE_MAP[positionSlug];
        const inBranchUnassigned = membership.some(
          (m) => m.branch_id === branchId && m.assigned_to === null && !m.is_origin,
        );
        if (routeSlug && inBranchUnassigned && lead.list_id) {
          const { data: listRow } = await db.from("lead_lists").select("slug").eq("id", lead.list_id).maybeSingle();
          isCrossBranchPoolLead = (listRow as { slug?: string } | null)?.slug === routeSlug;
        }
      }
      if (!isCollab && !isCrossBranchPoolLead) return false;
    }
  }

  if (auth.permissions.leadScope === "team" && branchId) {
    const branchMemberIdsList = actorBranchMemberIds(auth);
    const inBranch =
      membership.some((m) => m.branch_id === branchId) ||
      lead.branch_id === branchId ||
      (lead.assigned_to !== null && branchMemberIdsList.includes(lead.assigned_to));
    if (!inBranch) return false;
  }

  if (auth.permissions.pipelineAccess !== "all" && !auth.permissions.pipelineAccess.ids.has(lead.pipeline_id)) {
    return false;
  }

  return true;
}
