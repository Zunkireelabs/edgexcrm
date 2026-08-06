import { scopedClientForTenant } from "@/lib/supabase/scoped";

/**
 * Minimal shape these helpers need — satisfied by the API-route `AuthContext`
 * (src/lib/api/auth.ts) as well as the `getCurrentUserTenant()` Server Component
 * shape (src/lib/supabase/queries.ts), which has `role`/`userId`/`tenant.id`
 * instead of a flat `tenantId`. Callers pass either directly.
 */
interface ClassAccessSubject {
  role: string;
  userId: string;
  tenantId: string;
}

/**
 * Classes-access capabilities (enroll students, mark attendance, view full
 * roster) are gated by the `class_managers` grant table — a per-user,
 * per-capability allowlist admins manage from Settings — rather than a
 * position permission, because they must name specific users without
 * granting the rest of their position (e.g. counselor) any new access.
 * Owners/admins always pass.
 *
 * `class_managers` replaces two older mechanisms: the `class_attendance_markers`
 * allowlist table (still read-only/historical — do not write to it) and the
 * hardcoded `CLASS_ENROLL_POSITIONS` position-slug list in permissions.ts.
 */
export async function canMarkClassAttendance(auth: ClassAccessSubject): Promise<boolean> {
  if (auth.role === "owner" || auth.role === "admin") return true;

  const db = await scopedClientForTenant(auth.tenantId);
  const { data } = await db
    .from("class_managers")
    .select("user_id")
    .eq("user_id", auth.userId)
    .eq("mark_attendance", true)
    .maybeSingle();

  return !!data;
}

export async function canEnrollStudents(auth: ClassAccessSubject): Promise<boolean> {
  if (auth.role === "owner" || auth.role === "admin") return true;

  const db = await scopedClientForTenant(auth.tenantId);
  const { data } = await db
    .from("class_managers")
    .select("user_id")
    .eq("user_id", auth.userId)
    .eq("enroll_students", true)
    .maybeSingle();

  return !!data;
}

export async function canViewFullRoster(auth: ClassAccessSubject): Promise<boolean> {
  if (auth.role === "owner" || auth.role === "admin") return true;

  const db = await scopedClientForTenant(auth.tenantId);
  const { data } = await db
    .from("class_managers")
    .select("user_id")
    .eq("user_id", auth.userId)
    .eq("view_roster", true)
    .maybeSingle();

  return !!data;
}
