import type { SupabaseClient } from "@supabase/supabase-js";

export type LeadMembership = { branch_id: string; assigned_to: string | null }[];

// Minimal auth shape needed here — avoids circular import with auth.ts.
interface BranchManageAuth {
  permissions: { baseTier: "owner" | "admin" | "member"; leadScope: "all" | "own" | "team" };
  branchId: string | null;
}

/**
 * Can this user manage (share / per-branch-assign) lead branches?
 * Owner/admin: always. Team-scoped member whose branch holds the lead: yes.
 * Counselors (own-scope) and plain viewers: no.
 */
export function canManageLeadBranches(
  auth: BranchManageAuth,
  membership: LeadMembership,
): boolean {
  const { baseTier, leadScope } = auth.permissions;
  if (baseTier === "owner" || baseTier === "admin") return true;
  return (
    leadScope === "team" &&
    !!auth.branchId &&
    membership.some((m) => m.branch_id === auth.branchId)
  );
}

// User IDs of all members assigned to a branch (tenant_users.branch_id).
// Small set (one row per team member) → safe to use in an .in("assigned_to", ids) filter.
export async function branchMemberIds(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any>,
  tenantId: string,
  branchId: string,
): Promise<string[]> {
  const { data } = await db.from("tenant_users")
    .select("user_id").eq("tenant_id", tenantId).eq("branch_id", branchId);
  return (data ?? []).map((r: { user_id: string }) => r.user_id);
}

// Lead IDs that are MEMBERS of a branch (origin OR shared-in).
export async function leadIdsForBranch(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any>,
  tenantId: string,
  branchId: string,
): Promise<string[]> {
  const { data } = await db.from("lead_branches").select("lead_id").eq("tenant_id", tenantId).eq("branch_id", branchId);
  return (data ?? []).map((r: { lead_id: string }) => r.lead_id);
}

// Lead IDs a user can see as a per-branch assignee — membership rows ∪ legacy leads.assigned_to (covers unbranched leads).
export async function leadIdsVisibleToAssignee(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any>,
  tenantId: string,
  userId: string,
): Promise<string[]> {
  const [m, l] = await Promise.all([
    db.from("lead_branches").select("lead_id").eq("tenant_id", tenantId).eq("assigned_to", userId),
    db.from("leads").select("id").eq("tenant_id", tenantId).eq("assigned_to", userId).is("deleted_at", null),
  ]);
  const ids = new Set<string>();
  (m.data ?? []).forEach((r: { lead_id: string }) => ids.add(r.lead_id));
  (l.data ?? []).forEach((r: { id: string }) => ids.add(r.id));
  return [...ids];
}

// All membership rows for one lead (for the access checks on single-lead routes).
export async function getLeadMembership(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any>,
  tenantId: string,
  leadId: string,
): Promise<LeadMembership> {
  const { data } = await db.from("lead_branches").select("branch_id, assigned_to").eq("tenant_id", tenantId).eq("lead_id", leadId);
  return (data ?? []).map((r: { branch_id: string; assigned_to: string | null }) => ({
    branch_id: r.branch_id,
    assigned_to: r.assigned_to ?? null,
  }));
}

// Keep the is_origin row in sync when the existing single-branch columns change.
// branchId null → remove origin row; else upsert the origin row to (branchId, assignedTo).
export async function syncOriginMembership(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any>,
  tenantId: string,
  leadId: string,
  branchId: string | null,
  assignedTo: string | null,
): Promise<void> {
  if (!branchId) {
    await db.from("lead_branches").delete().eq("tenant_id", tenantId).eq("lead_id", leadId).eq("is_origin", true);
    return;
  }
  // Move origin if branch changed: delete any existing origin row not on this branch, then upsert.
  await db.from("lead_branches").delete().eq("tenant_id", tenantId).eq("lead_id", leadId).eq("is_origin", true).neq("branch_id", branchId);
  await db.from("lead_branches")
    .upsert(
      { tenant_id: tenantId, lead_id: leadId, branch_id: branchId, assigned_to: assignedTo, is_origin: true },
      { onConflict: "lead_id,branch_id" },
    );
}
