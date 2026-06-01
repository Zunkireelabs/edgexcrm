import { authenticateRequest } from "@/lib/api/auth";
import { apiUnauthorized, apiSuccess } from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/badge-counts
 * Returns sidebar badge counts for the current user:
 *  - unread_notifications: all unread notifications (drives the bell count too)
 *  - unread_leads: unread `lead.created` notifications — "new leads you haven't
 *    opened yet", like unread messages. Routing already scopes these per-user
 *    (assignee, or admins for unassigned leads), so no role special-casing and
 *    no historical flood (only leads created since the feature shipped count).
 *    Cleared when the user opens the lead (its lead.created notification is
 *    marked read — see notifications/read-by-link).
 */
export async function GET() {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const db = await scopedClient(auth);

  const { count: unreadNotifications } = await db
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("user_id", auth.userId)
    .is("read_at", null);

  const { count: unreadLeads } = await db
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("user_id", auth.userId)
    .eq("type", "lead.created")
    .is("read_at", null);

  return apiSuccess({
    unread_notifications: unreadNotifications ?? 0,
    unread_leads: unreadLeads ?? 0,
  });
}
