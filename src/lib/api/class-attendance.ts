import type { AuthContext } from "@/lib/api/auth";
import { scopedClient } from "@/lib/supabase/scoped";

/**
 * Attendance marking is gated by a dedicated allowlist table
 * (class_attendance_markers) rather than a position permission, because it must
 * name specific users (Purnima, Kamana, Pratima) without granting the rest of
 * their position (counselor) any new access. Owners/admins always pass.
 */
export async function canMarkClassAttendance(auth: AuthContext): Promise<boolean> {
  if (auth.role === "owner" || auth.role === "admin") return true;

  const db = await scopedClient(auth);
  const { data } = await db
    .from("class_attendance_markers")
    .select("user_id")
    .eq("user_id", auth.userId)
    .maybeSingle();

  return !!data;
}
