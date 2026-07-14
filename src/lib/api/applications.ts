import type { AuthContext } from "@/lib/api/auth";
import { requireLeadBranchAccess } from "@/lib/api/auth";
import { shouldRestrictToSelf } from "@/lib/api/permissions";
import { getLeadMembership, type LeadMembership } from "@/lib/leads/branch-membership";
import { isLeadCollaborator } from "@/lib/leads/collaborators";
import { scopedClient } from "@/lib/supabase/scoped";
import { createServiceClient } from "@/lib/supabase/server";

/** Minimal parent-lead shape the access helpers reason about. */
type LeadAccessShape = { assigned_to: string | null; branch_id: string | null };

/**
 * Auth fields the application access helpers need. Structural subset so both an
 * API-route `AuthContext` and the SSR `getCurrentUserTenant()` result satisfy it.
 */
type AppAuth = Pick<AuthContext, "userId" | "permissions" | "positionSlug" | "branchId">;

/**
 * Edit / delete of a SPECIFIC application card:
 *   owner/admin · branch-manager of the lead's ASSIGNED branch · the lead assignee.
 * Same rule as create/reorder — application cards no longer have their own assignee.
 */
export function canManageApplicationForLead(auth: AppAuth, lead: LeadAccessShape): boolean {
  const p = auth.permissions;
  if (p.baseTier === "owner" || p.baseTier === "admin") return true;
  if (auth.positionSlug === "branch-manager" && auth.branchId && auth.branchId === lead.branch_id) return true;
  if (lead.assigned_to === auth.userId) return true;
  return false;
}

/**
 * Create a new application OR reorder the whole list — these operate before/across
 * individual rows, so they key off the parent-lead assignee rather than an app assignee:
 *   owner/admin · branch-manager of the lead's ASSIGNED branch · the lead assignee.
 */
export function canCreateOrReorderApplications(auth: AppAuth, lead: LeadAccessShape): boolean {
  const p = auth.permissions;
  if (p.baseTier === "owner" || p.baseTier === "admin") return true;
  if (auth.positionSlug === "branch-manager" && auth.branchId && auth.branchId === lead.branch_id) return true;
  if (lead.assigned_to === auth.userId) return true; // lead assignee
  return false;
}

interface ApplicationAccessResult<T> {
  allowed: boolean;
  application: T | null;
  /** Parent lead (id, assigned_to, branch_id) — null when the app/lead wasn't found. */
  parentLead: { id: string; assigned_to: string | null; branch_id: string | null } | null;
  /** Lead branch membership — used by write gates without a second query. */
  membership: LeadMembership;
  /**
   * True when access was granted ONLY via the collaborator VIEW bypass (own-scope
   * user, not currently assigned, but an ever-collaborator). Such users get read
   * access but must not write sub-resources (e.g. notes). False on every other path.
   */
  viaCollaborator: boolean;
  /**
   * True only when the initial applications query itself failed (a genuine
   * DB/backend error) — distinct from "row doesn't exist" or "not allowed",
   * both of which also leave `application: null`. Callers should return a
   * 500 (not a 404) when this is true, or a real backend failure gets
   * reported to the client as "not found," masking the actual cause.
   */
  dbError?: boolean;
}

// Shared parent-lead scope check for every /api/v1/applications/[id]* route
// (the application itself and its sub-resources like notes): tenant
// membership alone isn't enough — a counselor must also be allowed to see
// this specific student, not just any application in their tenant.
export async function getApplicationWithAccess<T extends { lead_id: string }>(
  auth: AuthContext,
  applicationId: string,
  selectColumns: string
): Promise<ApplicationAccessResult<T>> {
  const db = await scopedClient(auth);
  const { data: application, error } = await db
    .from("applications")
    .select(selectColumns)
    .eq("id", applicationId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) return { allowed: false, application: null, parentLead: null, membership: [], viaCollaborator: false, dbError: true };
  if (!application) return { allowed: false, application: null, parentLead: null, membership: [], viaCollaborator: false };
  const appRow = application as unknown as T;

  const supabase = await createServiceClient();
  const { data: parentLead } = await supabase
    .from("leads")
    .select("id, assigned_to, branch_id")
    .eq("id", appRow.lead_id)
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!parentLead) return { allowed: false, application: appRow, parentLead: null, membership: [], viaCollaborator: false };
  const parentLeadRow = parentLead as unknown as { id: string; assigned_to: string | null; branch_id: string | null };

  const membership = await getLeadMembership(supabase, auth.tenantId, parentLeadRow.id);

  const denied = (): ApplicationAccessResult<T> => ({
    allowed: false,
    application: appRow,
    parentLead: parentLeadRow,
    membership,
    viaCollaborator: false,
  });
  const allow = (viaCollaborator = false): ApplicationAccessResult<T> => ({
    allowed: true,
    application: appRow,
    parentLead: parentLeadRow,
    membership,
    viaCollaborator,
  });

  // Collaborator VIEW bypass: a lead collaborator (ever-assigned, incl. reassigned
  // away) may READ the application even when own-scope and not currently assigned.
  // Write gates (PATCH/DELETE) run canManageApplicationForLead separately, so this
  // only widens read access, not mutation.
  const isRestrictedAndUnassigned =
    shouldRestrictToSelf(auth.permissions) &&
    !(
      parentLeadRow.assigned_to === auth.userId ||
      membership.some((m: { assigned_to: string | null }) => m.assigned_to === auth.userId)
    );

  if (isRestrictedAndUnassigned) {
    if (await isLeadCollaborator(supabase, auth.tenantId, parentLeadRow.id, auth.userId)) return allow(true);
    return denied();
  }
  if (!requireLeadBranchAccess(auth, parentLeadRow, membership)) {
    if (await isLeadCollaborator(supabase, auth.tenantId, parentLeadRow.id, auth.userId)) return allow(true);
    return denied();
  }
  return allow();
}
