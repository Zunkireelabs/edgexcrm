/**
 * Self/manager/HR scoping helpers shared by the employees + employee-skills
 * routes. Employee identity is tenant_users.id — NOT auth.userId — so every
 * route resolves the caller's own tenant_users row before applying scope.
 *
 * Rule (HRMS Phase 1 brief): canManageHR (or owner/admin, which resolves to
 * canManageHR: true) sees/edits everyone. Otherwise a caller may read/write
 * only their own employee_profiles row; a manager may READ (not write)
 * their direct reports' rows (employee_profiles.manager_tenant_user_id).
 */
import type { AuthContext } from "@/lib/api/auth";
import type { scopedClient } from "@/lib/supabase/scoped";

type ScopedDb = Awaited<ReturnType<typeof scopedClient>>;

export async function getSelfTenantUserId(db: ScopedDb, auth: AuthContext): Promise<string | null> {
  const { data } = await db
    .from("tenant_users")
    .select("id")
    .eq("user_id", auth.userId)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

export async function getDirectReportIds(db: ScopedDb, selfTenantUserId: string): Promise<string[]> {
  const { data } = await db
    .from("employee_profiles")
    .select("tenant_user_id")
    .eq("manager_tenant_user_id", selfTenantUserId);
  return ((data ?? []) as unknown as { tenant_user_id: string }[]).map((r) => r.tenant_user_id);
}

/** Read access: self, canManageHR, or the caller manages this person. */
export async function canReadEmployee(
  db: ScopedDb,
  selfTenantUserId: string | null,
  hasManageHR: boolean,
  targetTenantUserId: string,
): Promise<boolean> {
  if (hasManageHR) return true;
  if (!selfTenantUserId) return false;
  if (targetTenantUserId === selfTenantUserId) return true;
  const { data } = await db
    .from("employee_profiles")
    .select("id")
    .eq("tenant_user_id", targetTenantUserId)
    .eq("manager_tenant_user_id", selfTenantUserId)
    .maybeSingle();
  return !!data;
}

/** Write access: self or canManageHR only — managers are read-only on reports. */
export function canWriteEmployee(
  selfTenantUserId: string | null,
  hasManageHR: boolean,
  targetTenantUserId: string,
): boolean {
  if (hasManageHR) return true;
  return !!selfTenantUserId && targetTenantUserId === selfTenantUserId;
}
