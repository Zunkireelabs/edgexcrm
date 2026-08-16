// GET  /api/v1/inbox/conversations/[id]/messages  — list messages in thread
// POST /api/v1/inbox/conversations/[id]/messages  — human composer send
//      body: { content: string, approve_draft_id?: string }

import { NextRequest } from "next/server";
import { authenticateRequest, type AuthContext } from "@/lib/api/auth";
import {
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiSuccess,
  apiError,
} from "@/lib/api/response";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { sendMessage } from "@/lib/inbox/send-message";
import { canAccessConversationLead, type InboxScopeClients } from "@/lib/inbox/scope";

async function checkConversationAccess(
  clients: InboxScopeClients,
  auth: AuthContext,
  conversationId: string
): Promise<{ ok: true; conv: { id: string; tenant_id: string } } | { ok: false; response: ReturnType<typeof apiForbidden> }> {
  const { data: conv } = await clients.service
    .from("conversations")
    .select("id, tenant_id, lead_id")
    .eq("id", conversationId)
    .eq("tenant_id", auth.tenantId)
    .maybeSingle();

  if (!conv) return { ok: false, response: apiNotFound("Conversation") as ReturnType<typeof apiForbidden> };

  const canAccess = await canAccessConversationLead(clients, auth, (conv as { lead_id: string | null }).lead_id);
  if (!canAccess) return { ok: false, response: apiForbidden() };

  return { ok: true, conv: conv as { id: string; tenant_id: string } };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const { id } = await params;
  const supabase = await createServiceClient();
  const userClient = await createClient();

  const access = await checkConversationAccess({ user: userClient, service: supabase }, auth, id);
  if (!access.ok) return access.response;

  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50"), 200);
  const before = searchParams.get("before"); // cursor: ISO timestamp

  let query = supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", id)
    .eq("tenant_id", auth.tenantId)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (before) {
    query = query.lt("created_at", before);
  }

  const { data, error } = await query;
  if (error) return apiSuccess([]);

  // Reset unread count when messages are fetched
  await supabase
    .from("conversations")
    .update({ unread_count: 0 })
    .eq("id", id)
    .eq("tenant_id", auth.tenantId);

  return apiSuccess(data ?? []);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const { id } = await params;
  const supabase = await createServiceClient();
  const userClient = await createClient();

  const access = await checkConversationAccess({ user: userClient, service: supabase }, auth, id);
  if (!access.ok) return access.response;

  const body = await request.json().catch(() => ({})) as { content?: string; approve_draft_id?: string };
  const content = body.content?.trim();
  const approveDraftId = body.approve_draft_id;

  if (!content && !approveDraftId) {
    return apiError("VALIDATION_ERROR", "content or approve_draft_id is required", 422);
  }

  // If approving a draft, fetch its content
  let messageContent = content ?? "";
  if (approveDraftId && !content) {
    const { data: draft } = await supabase
      .from("messages")
      .select("content_text")
      .eq("id", approveDraftId)
      .eq("tenant_id", auth.tenantId)
      .eq("status", "draft")
      .maybeSingle();
    if (!draft) return apiNotFound("Draft message");
    messageContent = (draft as { content_text: string | null }).content_text ?? "";
  }

  const result = await sendMessage({
    tenantId: auth.tenantId,
    conversationId: id,
    content: messageContent,
    author: { type: "human_agent", userId: auth.userId },
    fromDraftMessageId: approveDraftId,
  });

  return apiSuccess(result);
}
