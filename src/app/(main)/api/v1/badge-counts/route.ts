import { authenticateRequest } from "@/lib/api/auth";
import { apiUnauthorized, apiSuccess } from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/badge-counts
 * Returns sidebar badge counts for the current user:
 *  - unread_notifications: all unread notifications (drives the bell count too)
 *  - unread_leads: count of distinct leads with any unread notification (equals
 *    the number of dotted rows in the leads table)
 *  - unread_lead_ids: the distinct lead IDs driving that count
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

  const { data: rawLeadRows } = await db
    .from("notifications")
    .select("link")
    .eq("user_id", auth.userId)
    .is("read_at", null)
    .like("link", "/leads/%");

  const unreadLeadRows = (rawLeadRows as unknown as Array<{ link: string }> | null) ?? [];

  const unreadLeadIds = [
    ...new Set(
      unreadLeadRows
        .map((r) => r.link.slice("/leads/".length))
        .filter((id) => id && !id.includes("/"))
    ),
  ];

  return apiSuccess({
    unread_notifications: unreadNotifications ?? 0,
    unread_leads: unreadLeadIds.length,
    unread_lead_ids: unreadLeadIds,
  });
}
