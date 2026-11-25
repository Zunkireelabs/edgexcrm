// GET /api/v1/inbox/conversations/[id]
// PATCH /api/v1/inbox/conversations/[id]  (status, assignee, stage_tag)

import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import {
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiSuccess,
  apiError,
  apiValidationError,
} from "@/lib/api/response";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { createNotification, NotificationTypes } from "@/lib/notifications";
import { canAccessConversationLead, canSeeLinkedLead } from "@/lib/inbox/scope";
import { chatChangeLock, requiresClaim } from "@/lib/inbox/claim";

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
    conv.lead_id as string | null,
    conv.provider as string | null
  );
  if (!canAccess) return apiForbidden();

  // Website chats are readable by every Inbox user, but the lead a chat is linked to is still its owner's business:
  // someone who can't see that lead gets the chat without the lead's name, email or phone.
  const canSeeLead = await canSeeLinkedLead({ user: userClient, service: supabase }, auth, conv.lead_id as string | null);
  if (!canSeeLead) return apiSuccess({ ...conv, leads: null });

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
    .select("id, lead_id, assigned_to_user_id, assignee_type, provider, meta")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .maybeSingle();

  if (!conv) return apiNotFound("Conversation");

  const userClient = await createClient();
  const canAccess = await canAccessConversationLead(
    { user: userClient, service: supabase },
    auth,
    (conv as { lead_id: string | null }).lead_id,
    (conv as { provider: string | null }).provider
  );
  if (!canAccess) return apiForbidden();

  // Website chats: only the person handling it (or an admin) may change it. Everyone else reads.
  const locked = await chatChangeLock(
    supabase,
    conv as { provider: string | null; assignee_type: string | null; assigned_to_user_id: string | null },
    auth.userId,
    requireAdmin(auth)
  );
  if (locked) return locked;

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;

  const allowed = ["status", "assignee_type", "assigned_to_user_id", "stage_tag", "ai_autonomy", "snoozed_until", "lead_id"];
  const patch: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) patch[key] = body[key];
  }

  // Website chats change owner only through Accept / Hand over / Take over (they leave a note and notify
  // the new owner). Letting this route move the owner too would let anyone bypass the "one owner" rule.
  if (
    requiresClaim((conv as { provider?: string | null }).provider) &&
    ("assigned_to_user_id" in patch || "assignee_type" in patch)
  ) {
    return apiError("USE_CLAIM", "Use Accept or Hand over to change who handles a website chat.", 409);
  }

  if ("ai_autonomy" in patch) {
    if (patch.ai_autonomy !== "off" && patch.ai_autonomy !== "suggest" && patch.ai_autonomy !== "autonomous") {
      return apiValidationError({ ai_autonomy: ["Must be off, suggest or autonomous"] });
    }
    // Switching AI back on means a person has looked at the chat: drop the "Needs a human" flag.
    const meta = (conv as { meta?: Record<string, unknown> | null }).meta;
    if (patch.ai_autonomy === "autonomous" && meta && "needs_human" in meta) {
      const { needs_human: _flag, ...rest } = meta;
      void _flag;
      patch.meta = rest;
    }
  }

  if (Object.keys(patch).length === 0) {
    return apiSuccess({});
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
