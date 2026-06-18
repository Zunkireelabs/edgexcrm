import type { SupabaseClient } from "@supabase/supabase-js";

export type LeadMembership = { branch_id: string; assigned_to: string | null }[];

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
