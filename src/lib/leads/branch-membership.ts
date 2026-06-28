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
// NOTE: returns the FULL combined set (can be 500+ IDs). Passing this into .in("id", result) builds a long URL
// that exceeds Node/undici's 16 KB maxHeaderSize at ~440+ leads.
// For queries on the LEADS table, use sharedBranchLeadIdsForAssignee + inline assigned_to filter instead.
// This function is still correct for cross-table queries (e.g. applications, classes) where you need
// the full ID list to filter a foreign-key column — chunk that .in() call into ≤250-ID batches.
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

// URL-safe subset: ONLY lead_branches rows for this assignee (the "shared-in" set, normally small).
// Use this to build an inline OR filter on the leads table:
//   if (sharedIds.length > 0) q.or(`assigned_to.eq.${userId},id.in.(${sharedIds})`)
//   else                        q.eq("assigned_to", userId)
// This avoids the UND_ERR_HEADERS_OVERFLOW that hits when all 500+ assigned lead IDs go into .in("id", bigArray).
export async function sharedBranchLeadIdsForAssignee(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any>,
  tenantId: string,
  userId: string,
): Promise<string[]> {
  const { data } = await db.from("lead_branches").select("lead_id")
    .eq("tenant_id", tenantId).eq("assigned_to", userId);
  return (data ?? []).map((r: { lead_id: string }) => r.lead_id);
}

// Targeted visibility check for a single lead — avoids enumerating all assigned IDs.
// Use instead of leadIdsVisibleToAssignee(...).includes(leadId) to prevent URL overflow.
export async function shouldLeadBeVisibleToAssignee(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any>,
  tenantId: string,
  leadId: string,
  userId: string,
): Promise<boolean> {
  const [direct, branch] = await Promise.all([
    db.from("leads").select("id").eq("id", leadId).eq("tenant_id", tenantId).eq("assigned_to", userId).is("deleted_at", null).maybeSingle(),
    db.from("lead_branches").select("lead_id").eq("tenant_id", tenantId).eq("lead_id", leadId).eq("assigned_to", userId).maybeSingle(),
  ]);
  return !!direct.data || !!branch.data;
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
