/**
 * Shared leave-domain helpers used across the /api/v1/leave/* routes.
 * Approval authority = the reporting line OR HR (see HRMS Phase 2a brief) —
 * resolveApprover implements that fallback chain.
 */
import type { scopedClient } from "@/lib/supabase/scoped";

type ScopedDb = Awaited<ReturnType<typeof scopedClient>>;

/**
 * Resolve who approves a given employee's leave:
 * 1. employee_profiles.manager_tenant_user_id, if set.
 * 2. else the employee's branch manager (branches.manager_user_id), mapped
 *    to that user's tenant_users.id in this tenant.
 * 3. else null — any canManageHR user may approve.
 */
export async function resolveApprover(
  db: ScopedDb,
  employeeTenantUserId: string,
): Promise<string | null> {
  const { data: employee } = await db
    .from("tenant_users")
    .select("branch_id, employee_profiles!employee_profiles_tenant_user_id_fkey(manager_tenant_user_id)")
    .eq("id", employeeTenantUserId)
    .maybeSingle();

  const row = employee as unknown as {
    branch_id: string | null;
    employee_profiles: { manager_tenant_user_id: string | null } | { manager_tenant_user_id: string | null }[] | null;
  } | null;
  if (!row) return null;

  const profile = Array.isArray(row.employee_profiles) ? row.employee_profiles[0] ?? null : row.employee_profiles;
  if (profile?.manager_tenant_user_id) return profile.manager_tenant_user_id;

  if (!row.branch_id) return null;
  const { data: branch } = await db
    .from("branches")
    .select("manager_user_id")
    .eq("id", row.branch_id)
    .maybeSingle();
  const managerUserId = (branch as unknown as { manager_user_id: string | null } | null)?.manager_user_id;
  if (!managerUserId) return null;

  const { data: managerTenantUser } = await db
    .from("tenant_users")
    .select("id")
    .eq("user_id", managerUserId)
    .maybeSingle();
  return (managerTenantUser as unknown as { id: string } | null)?.id ?? null;
}

/** Union of a branch's own holidays plus the tenant-wide (NULL-branch) defaults, as a Set of YYYY-MM-DD. */
export async function getHolidaySet(
  db: ScopedDb,
  branchId: string | null,
  fromISO: string,
  toISO: string,
): Promise<Set<string>> {
  const query = db
    .from("holidays")
    .select("holiday_date, branch_id")
    .gte("holiday_date", fromISO)
    .lte("holiday_date", toISO);

  const { data } = branchId
    ? await query.or(`branch_id.eq.${branchId},branch_id.is.null`)
    : await query.is("branch_id", null);

  const rows = (data ?? []) as unknown as { holiday_date: string }[];
  return new Set(rows.map((r) => r.holiday_date));
}
