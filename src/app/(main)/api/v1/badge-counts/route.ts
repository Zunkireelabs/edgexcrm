import { authenticateRequest } from "@/lib/api/auth";
import { apiUnauthorized, apiSuccess } from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/badge-counts
 * Returns sidebar badge counts for the current user:
 *  - unread_notifications: all unread notifications (drives the bell count too)
 *  - unread_leads: count of distinct leads with any unread notification (equals
 *    the number of dotted rows in the leads table)
 *  - unread_lead_ids: the distinct lead IDs driving that count
 *  - outreach_due: count of MY pending outreach drafts already due (personal
 *    scope for every role, incl. owner/admin — this is My-Work, not the
 *    company worklist); 0 when the tenant's industry doesn't have Outreach
 */
export async function GET() {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const db = await scopedClient(auth);

  let outreachDue = 0;
  if (getFeatureAccess(auth.industryId, FEATURES.OUTREACH)) {
    const { count } = await db
      .from("sequence_step_drafts")
      .select("id, sequence_enrollments!inner(status)", { count: "exact", head: true })
      .eq("assigned_to", auth.userId)
      .eq("status", "pending")
      .lte("due_at", new Date().toISOString())
      .eq("sequence_enrollments.status", "active");
    outreachDue = count ?? 0;
  }

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
    outreach_due: outreachDue,
  });
}
