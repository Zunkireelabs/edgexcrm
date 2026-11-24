// POST /api/v1/inbox/conversations/[id]/handover   body: { to_user_id }
// The owner hands a website chat to a teammate. An owner/admin can also take a chat over (hand it to
// themselves) when the owner is away, so a chat is never stuck. Rules: src/lib/inbox/claim.ts.

import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import { apiUnauthorized, apiNotFound, apiSuccess, apiError, apiValidationError } from "@/lib/api/response";
import { createServiceClient } from "@/lib/supabase/server";
import { createNotification, NotificationTypes } from "@/lib/notifications";
import { logger } from "@/lib/logger";
import { displayNameFor, memberCanOpenInbox, ownerOf, requiresClaim, writeSystemNote } from "@/lib/inbox/claim";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const body = (await request.json().catch(() => ({}))) as { to_user_id?: unknown };
  const toUserId = typeof body.to_user_id === "string" ? body.to_user_id : "";
  if (!UUID_RE.test(toUserId)) {
    return apiValidationError({ to_user_id: ["to_user_id must be a user id"] });
  }

  const { id } = await params;
  const supabase = await createServiceClient();

  const { data: conv } = await supabase
    .from("conversations")
    .select("id, provider, channel_id, assignee_type, assigned_to_user_id, contact_display_name, contact_phone")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .maybeSingle();
  if (!conv) return apiNotFound("Conversation");

  const row = conv as {
    id: string; provider: string; channel_id: string; assignee_type: string; assigned_to_user_id: string | null;
    contact_display_name: string | null; contact_phone: string | null;
  };

  if (!requiresClaim(row.provider)) {
    return apiError("NOT_CLAIMABLE", "This conversation doesn't use accept and hand-over.", 409);
  }

  const owner = ownerOf(row);
  if (!owner) {
    return apiError("NOT_ACCEPTED", "Nobody is handling this chat yet. Use Accept instead.", 409);
  }

  // Only the current owner, or an owner/admin (take-over), may move a chat.
  const isOwner = owner === auth.userId;
  const isAdmin = requireAdmin(auth);
  if (!isOwner && !isAdmin) {
    const ownerName = await displayNameFor(supabase, owner);
    return apiError("NOT_CHAT_OWNER", `${ownerName} is handling this chat. Only they or an admin can hand it over.`, 403, { owner_id: owner });
  }

  if (toUserId === owner) {
    return apiSuccess({ conversation_id: id, owner_id: owner, unchanged: true });
  }

  // Never hand a chat to someone who can't open the Inbox (their position hides it) or isn't in this team.
  if (!(await memberCanOpenInbox(supabase, auth.tenantId, toUserId))) {
    return apiError("TARGET_CANNOT_OPEN_INBOX", "That person can't open the Inbox, so they can't take this chat.", 422);
  }

  // Move it only while it still belongs to the owner we just read, so two people acting at once can't both win.
  const { data: moved } = await supabase
    .from("conversations")
    .update({ assignee_type: "human", assigned_to_user_id: toUserId })
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .eq("assignee_type", "human")
    .eq("assigned_to_user_id", owner)
    .select("id")
    .maybeSingle();
  if (!moved) {
    return apiError("CHAT_CHANGED", "This chat just changed owner. Refresh and try again.", 409);
  }

  const actorName = await displayNameFor(supabase, auth.userId);
  const toName = toUserId === auth.userId ? actorName : await displayNameFor(supabase, toUserId);

  let text: string;
  if (toUserId === auth.userId && !isOwner) {
    text = `${actorName} (admin) took over this chat`;
  } else if (isOwner) {
    text = `${actorName} handed this chat to ${toName}`;
  } else {
    const ownerName = await displayNameFor(supabase, owner);
    text = `${actorName} (admin) moved this chat from ${ownerName} to ${toName}`;
  }
  await writeSystemNote(supabase, {
    tenantId: auth.tenantId,
    conversationId: id,
    channelId: row.channel_id,
    userId: auth.userId,
    text,
  });

  // Tell the new owner (not when they did it to themselves). Non-fatal: the hand-over already happened.
  if (toUserId !== auth.userId) {
    try {
      const contactName = row.contact_display_name || row.contact_phone || "a visitor";
      await createNotification({
        tenantId: auth.tenantId,
        userId: toUserId,
        type: NotificationTypes.INBOX_ASSIGNED,
        title: "A website chat was handed to you",
        message: `${actorName} handed you the chat with ${contactName}`,
        link: `/inbox?conversation=${id}`,
      });
    } catch (err) {
      logger.warn({ err, conversation_id: id }, "handover: failed to notify the new owner (non-fatal)");
    }
  }

  return apiSuccess({ conversation_id: id, owner_id: toUserId, owner_name: toName });
}
