// GET /api/v1/inbox/conversations/[id]/attachments/signed-url?messageId=&path=
// Mints a short-lived signed URL for ONE attachment. Signed URLs are never embedded in
// the server-rendered thread payload (they'd leak into page source and outlive the
// view) — the client fetches this on demand, e.g. on image click / download click
// (docs/INBOX-ATTACHMENTS-BRIEF.md §3b).
//
// Scoping is exactly the conversation's scoping, not a separate check: a signed URL
// minted for a message the caller cannot see is a scoping bypass the same as being able
// to read the message itself. `path` must additionally appear in THAT message's own
// `attachments` column (and that message must belong to this conversation) — without
// that check, a caller who CAN see the conversation could still request an arbitrary
// path in the shared `inbox-media` bucket.

import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { apiUnauthorized, apiForbidden, apiNotFound, apiSuccess, apiError } from "@/lib/api/response";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { canAccessConversationLead } from "@/lib/inbox/scope";
import { getStorageProvider } from "@/lib/storage/provider";
import { INBOX_MEDIA_BUCKET } from "@/lib/inbox/media";

const SIGNED_URL_TTL_SECONDS = 300; // 5 minutes — this is a click-to-view/download, not a cached asset

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const { id: conversationId } = await params;
  const { searchParams } = new URL(request.url);
  const messageId = searchParams.get("messageId");
  const path = searchParams.get("path");
  if (!messageId || !path) {
    return apiError("VALIDATION_ERROR", "messageId and path are required", 422);
  }

  const supabase = await createServiceClient();

  const { data: conv } = await supabase
    .from("conversations")
    .select("id, lead_id")
    .eq("id", conversationId)
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

  const { data: msg } = await supabase
    .from("messages")
    .select("attachments")
    .eq("id", messageId)
    .eq("conversation_id", conversationId)
    .eq("tenant_id", auth.tenantId)
    .maybeSingle();
  if (!msg) return apiNotFound("Message");

  const attachments = ((msg as { attachments: unknown }).attachments ?? []) as { bucket?: string; path?: string }[];
  const match = attachments.find((a) => a.path === path);
  if (!match || match.bucket !== INBOX_MEDIA_BUCKET) {
    return apiForbidden();
  }

  const url = await getStorageProvider().getSignedDownloadUrl(INBOX_MEDIA_BUCKET, path, SIGNED_URL_TTL_SECONDS);
  return apiSuccess({ url });
}
