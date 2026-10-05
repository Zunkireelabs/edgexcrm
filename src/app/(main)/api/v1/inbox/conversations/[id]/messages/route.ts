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
import { sendMessage, type OutboundAttachmentInput } from "@/lib/inbox/send-message";
import { canAccessConversationLead, type InboxScopeClients } from "@/lib/inbox/scope";

function mediaTypeFor(mimeType: string): OutboundAttachmentInput["type"] {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  return "document";
}

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

  const contentType = request.headers.get("content-type") ?? "";
  let content: string | undefined;
  let approveDraftId: string | undefined;
  let attachment: OutboundAttachmentInput | undefined;

  // A file picked in the composer arrives as multipart/form-data (D4); the plain-text
  // send path is unchanged JSON. At most ONE file per send — matches the composer's
  // one-attachment-per-message UX; sending several files is several sends.
  if (contentType.includes("multipart/form-data")) {
    // "to EdgeX" timing (S3 item 4): how long it took the client's upload to reach us —
    // the stage that was silently failing with no UI signal (a 2.2 MB PDF aborting
    // mid-upload). Measured around formData() since that's where the body is read.
    const edgeXStart = Date.now();
    const form = await request.formData().catch(() => null);
    if (!form) return apiError("VALIDATION_ERROR", "invalid multipart body", 422);
    const toEdgeXMs = Date.now() - edgeXStart;
    content = (form.get("content") as string | null)?.trim() ?? undefined;
    const file = form.get("file");
    if (file instanceof File) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      attachment = {
        bytes,
        filename: file.name || null,
        mimeType: file.type || "application/octet-stream",
        type: mediaTypeFor(file.type),
        toEdgeXMs,
      };
    }
  } else {
    const body = await request.json().catch(() => ({})) as { content?: string; approve_draft_id?: string };
    content = body.content?.trim();
    approveDraftId = body.approve_draft_id;
  }

  if (!content && !approveDraftId && !attachment) {
    return apiError("VALIDATION_ERROR", "content, approve_draft_id, or a file is required", 422);
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
    attachment,
  });

  return apiSuccess(result);
}
