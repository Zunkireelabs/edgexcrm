// POST /api/v1/inbox/conversations/[id]/draft
// Approve an AI draft: flips status=draft → queued → sent via sendMessage.
// Body: { draft_message_id: string }

import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import {
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiSuccess,
  apiError,
} from "@/lib/api/response";
import { createServiceClient } from "@/lib/supabase/server";
import { sendMessage } from "@/lib/inbox/send-message";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const { id } = await params;
  const supabase = await createServiceClient();

  // Verify conversation access
  const { data: conv } = await supabase
    .from("conversations")
    .select("id, tenant_id, lead_id")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .maybeSingle();

  if (!conv) return apiNotFound("Conversation");

  if (auth.role === "counselor") {
    const leadId = (conv as { lead_id: string | null }).lead_id;
    if (!leadId) return apiForbidden();
    const { data: lead } = await supabase
      .from("leads")
      .select("assigned_to")
      .eq("id", leadId)
      .eq("tenant_id", auth.tenantId)
      .maybeSingle();
    if (!lead || (lead as { assigned_to: string | null }).assigned_to !== auth.userId) {
      return apiForbidden();
    }
  }

  const body = await request.json().catch(() => ({})) as { draft_message_id?: string };
  if (!body.draft_message_id) {
    return apiError("VALIDATION_ERROR", "draft_message_id is required", 422);
  }

  // Fetch draft content
  const { data: draft } = await supabase
    .from("messages")
    .select("content_text, status")
    .eq("id", body.draft_message_id)
    .eq("tenant_id", auth.tenantId)
    .eq("conversation_id", id)
    .maybeSingle();

  if (!draft) return apiNotFound("Draft message");
  if ((draft as { status: string }).status !== "draft") {
    return apiError("CONFLICT", "Message is not in draft status", 409);
  }

  const content = (draft as { content_text: string | null }).content_text ?? "";

  const result = await sendMessage({
    tenantId: auth.tenantId,
    conversationId: id,
    content,
    author: { type: "human_agent", userId: auth.userId },
    fromDraftMessageId: body.draft_message_id,
  });

  return apiSuccess(result);
}
