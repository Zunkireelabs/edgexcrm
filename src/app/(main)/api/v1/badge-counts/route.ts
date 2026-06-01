import { authenticateRequest } from "@/lib/api/auth";
import { apiUnauthorized, apiSuccess } from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/badge-counts
 * Returns unread_notifications and new_leads counts for the sidebar badges.
 * Universal endpoint — email unread is derived client-side to keep this cheap.
 */
export async function GET() {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const db = await scopedClient(auth);

  // Unread notifications (always per-user)
  const { count: unreadNotifications } = await db
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("user_id", auth.userId)
    .is("read_at", null);

  // New leads — counselors only see their assigned leads
  let newLeadsQuery = db
    .from("leads")
    .select("*", { count: "exact", head: true })
    .eq("status", "new")
    .is("deleted_at", null)
    .is("converted_at", null);

  if (auth.role === "counselor") {
    newLeadsQuery = newLeadsQuery.eq("assigned_to", auth.userId);
  }

  const { count: newLeads } = await newLeadsQuery;

  return apiSuccess({
    unread_notifications: unreadNotifications ?? 0,
    new_leads: newLeads ?? 0,
  });
}
