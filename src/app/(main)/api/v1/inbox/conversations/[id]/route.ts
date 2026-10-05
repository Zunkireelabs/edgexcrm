// GET /api/v1/inbox/conversations/[id]
// PATCH /api/v1/inbox/conversations/[id]  (status, assignee, stage_tag)

import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import {
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiSuccess,
} from "@/lib/api/response";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { createNotification, NotificationTypes } from "@/lib/notifications";
import { canAccessConversationLead } from "@/lib/inbox/scope";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const { id } = await params;
  const supabase = await createServiceClient();

  const { data, error } = await supabase
    .from("conversations")
    .select("*, inbox_channels(id, provider, display_name, external_account_id), leads(id, first_name, last_name, email, phone)")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .maybeSingle();

  if (error || !data) return apiNotFound("Conversation");

  const conv = data as Record<string, unknown>;
  const userClient = await createClient();
  const canAccess = await canAccessConversationLead(
    { user: userClient, service: supabase },
    auth,
    conv.lead_id as string | null
  );
  if (!canAccess) return apiForbidden();

  return apiSuccess(data);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const { id } = await params;
  const supabase = await createServiceClient();

  // Access check (tenant + branch/counselor scoping) must run before any mutation —
  // editing must match viewing (same check as the GET handler above).
  const { data: conv } = await supabase
    .from("conversations")
    .select("id, lead_id, assigned_to_user_id")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .maybeSingle();

  if (!conv) return apiNotFound("Conversation");

  const userClient = await createClient();
  const canAccess = await canAccessConversationLead(
    { user: userClient, service: supabase },
    auth,
    (conv as { lead_id: string | null }).lead_id
  );
  if (!canAccess) return apiForbidden();

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;

  const allowed = ["status", "assignee_type", "assigned_to_user_id", "stage_tag", "ai_autonomy", "snoozed_until", "lead_id"];
  const patch: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) patch[key] = body[key];
  }

  if (Object.keys(patch).length === 0) {
    return apiSuccess({});
  }

  // Scope gap fix: the access check above only verifies the conversation's CURRENT
  // lead is visible to the caller — without this, a counselor/branch-scoped caller
  // could link the conversation to an arbitrary lead_id elsewhere in the tenant that
  // they can't otherwise see. Apply the same visibility rule (leads API parity) to the
  // NEW lead_id being set. Unsetting (lead_id: null) needs no check — it only removes
  // exposure. 404, not 403, matches the leads API's own convention of never confirming
  // a lead's existence to a caller who can't see it.
  if ("lead_id" in patch && patch.lead_id) {
    const canAccessNewLead = await canAccessConversationLead(
      { user: userClient, service: supabase },
      auth,
      patch.lead_id as string
    );
    if (!canAccessNewLead) return apiNotFound("Lead");
  }

  const { data, error } = await supabase
    .from("conversations")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .select()
    .single();

  if (error || !data) return apiNotFound("Conversation");

  // Notify a newly-assigned user (skip self-assignment and no-op re-assignment).
  const oldAssignee = (conv as { assigned_to_user_id?: string | null }).assigned_to_user_id ?? null;
  const newAssignee =
    "assigned_to_user_id" in patch ? (patch.assigned_to_user_id as string | null) : undefined;
  if (newAssignee && newAssignee !== oldAssignee && newAssignee !== auth.userId) {
    const row = data as Record<string, unknown>;
    const contactName =
      (row.contact_display_name as string | null) ||
      (row.contact_phone as string | null) ||
      "a contact";
    await createNotification({
      tenantId: auth.tenantId,
      userId: newAssignee,
      type: NotificationTypes.INBOX_ASSIGNED,
      title: "New conversation assigned",
      message: `You were assigned the conversation with ${contactName}`,
      link: `/inbox?conversation=${id}`,
    });
  }

  return apiSuccess(data);
}
