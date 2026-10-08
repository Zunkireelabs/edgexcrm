// PATCH  /api/v1/inbox/channels/[id] — update a channel's token/display name (admin only)
// DELETE /api/v1/inbox/channels/[id] — remove a channel (admin only; cascades conversations + messages)

import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import {
  apiUnauthorized,
  apiForbidden,
  apiSuccess,
  apiNotFound,
  apiValidationError,
  apiInternalError,
} from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { encryptToken } from "@/lib/inbox/crypto";
import { createRequestLogger } from "@/lib/logger";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "PATCH",
    path: "/api/v1/inbox/channels/[id]",
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!requireAdmin(auth)) return apiForbidden();

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ body: ["Invalid JSON"] });
  }

  const b = body as Record<string, unknown>;
  const accessToken = typeof b.access_token === "string" ? b.access_token.trim() : undefined;
  const displayName = typeof b.display_name === "string" ? b.display_name.trim() : undefined;

  const errors: Record<string, string[]> = {};
  if (accessToken !== undefined && !accessToken) errors.access_token = ["Cannot be blank"];
  if (displayName !== undefined && !displayName) errors.display_name = ["Cannot be blank"];
  if (accessToken === undefined && displayName === undefined) {
    errors.body = ["Provide access_token and/or display_name"];
  }
  if (Object.keys(errors).length > 0) return apiValidationError(errors);

  const db = await scopedClient(auth);

  const { data: existing } = await db
    .from("inbox_channels")
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (!existing) return apiNotFound("Channel");

  const patch: Record<string, unknown> = {};
  if (displayName !== undefined) patch.display_name = displayName;
  if (accessToken !== undefined) {
    try {
      patch.access_token = encryptToken(accessToken);
    } catch (err) {
      log.error({ err }, "inbox channel update: failed to encrypt token");
      return apiInternalError();
    }
  }

  const { data, error } = await db
    .from("inbox_channels")
    .update(patch)
    .eq("id", id)
    .select("id, provider, external_account_id, display_name, status, updated_at")
    .single();

  if (error) {
    log.error({ err: error, channelId: id }, "inbox channel update: failed");
    return apiInternalError();
  }

  return apiSuccess({ channel: data });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "DELETE",
    path: "/api/v1/inbox/channels/[id]",
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!requireAdmin(auth)) return apiForbidden();

  const { id } = await params;

  const db = await scopedClient(auth);

  // Verify the channel exists + belongs to this tenant before deleting
  const { data: existing } = await db
    .from("inbox_channels")
    .select("id, provider, display_name")
    .eq("id", id)
    .maybeSingle();

  if (!existing) return apiNotFound("Channel");

  // messages.channel_id has no ON DELETE action (044:121), so a channel with
  // messages can't be deleted directly. Delete its conversations first —
  // conversations.channel_id cascades to messages via conversation_id (044:63,120) —
  // then delete the now-childless channel.
  const { error: conversationsError } = await db
    .from("conversations")
    .delete()
    .eq("channel_id", id);

  if (conversationsError) {
    log.error({ err: conversationsError, channelId: id }, "inbox channel delete: failed to clear conversations");
    return apiInternalError();
  }

  const { error } = await db.from("inbox_channels").delete().eq("id", id);

  if (error) {
    log.error({ err: error, channelId: id }, "inbox channel delete: failed");
    return apiInternalError();
  }

  return apiSuccess({ deleted: true });
}
