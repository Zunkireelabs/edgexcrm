import { NextRequest } from "next/server";
import { isAssistantEnabled } from "@/lib/ai/flag";
import { authenticateRequest } from "@/lib/api/auth";
import { scopedClient } from "@/lib/supabase/scoped";
import { apiSuccess, apiUnauthorized, apiNotFound, apiServiceUnavailable } from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";

interface ConversationRow {
  id: string;
  user_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * GET /api/v1/ai/conversations/[id]
 * Fetch one conversation (own-only) and its ordered messages.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAssistantEnabled()) return apiNotFound();

  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "GET",
    path: `/api/v1/ai/conversations/${id}`,
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const db = await scopedClient(auth);

  const { data: conversation } = await db
    .from("ai_conversations")
    .select("id, user_id, title, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();
  const row = conversation as ConversationRow | null;

  // Tenant filter is auto-applied by scopedClient (a cross-tenant id already
  // returns null here); the user_id check additionally blocks a same-tenant,
  // different-user peek.
  if (!row || row.user_id !== auth.userId) return apiNotFound("Conversation");

  const { data: messages, error } = await db
    .from("ai_messages")
    .select("id, role, content, model, input_tokens, output_tokens, created_at")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true });

  if (error) {
    log.error({ err: error, conversationId: id }, "Failed to fetch conversation messages");
    return apiServiceUnavailable("Failed to fetch conversation");
  }

  return apiSuccess({
    conversation: { id: row.id, title: row.title, created_at: row.created_at, updated_at: row.updated_at },
    messages: messages || [],
  });
}

/**
 * DELETE /api/v1/ai/conversations/[id]
 * Delete a conversation (own-only). ai_messages cascade via FK.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAssistantEnabled()) return apiNotFound();

  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "DELETE",
    path: `/api/v1/ai/conversations/${id}`,
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const db = await scopedClient(auth);

  const { data: conversation } = await db
    .from("ai_conversations")
    .select("id, user_id")
    .eq("id", id)
    .maybeSingle();
  const row = conversation as Pick<ConversationRow, "id" | "user_id"> | null;

  if (!row || row.user_id !== auth.userId) return apiNotFound("Conversation");

  const { error } = await db.from("ai_conversations").delete().eq("id", id);

  if (error) {
    log.error({ err: error, conversationId: id }, "Failed to delete conversation");
    return apiServiceUnavailable("Failed to delete conversation");
  }

  return apiSuccess({ id });
}
