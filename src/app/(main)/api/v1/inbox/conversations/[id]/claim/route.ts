// POST /api/v1/inbox/conversations/[id]/claim
// "Accept this chat": the first person to call this becomes the only one who can reply to a website chat.
// The rules live in src/lib/inbox/claim.ts.

import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { canSeeNav } from "@/lib/api/permissions";
import { apiUnauthorized, apiForbidden, apiNotFound, apiSuccess, apiError } from "@/lib/api/response";
import { createServiceClient } from "@/lib/supabase/server";
import { displayNameFor, ownerOf, requiresClaim, writeSystemNote } from "@/lib/inbox/claim";
import { OWNERLESS_FILTER } from "@/lib/inbox/claim-rules";

/** `{ meta }` without the needs_human flag, or nothing when there is no flag (so the update leaves meta alone). */
function withoutNeedsHuman(meta: Record<string, unknown> | null): { meta?: Record<string, unknown> } {
  if (!meta || !("needs_human" in meta)) return {};
  const { needs_human: _flag, ...rest } = meta;
  void _flag;
  return { meta: rest };
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  // Anyone whose position lets them open the Inbox may accept. (Not lead-scoped: every Inbox user sees a
  // website chat that is waiting, so that the first one free can take it.)
  if (!canSeeNav(auth.permissions, "/inbox")) return apiForbidden();

  const { id } = await params;
  const supabase = await createServiceClient();

  const { data: conv } = await supabase
    .from("conversations")
    .select("id, provider, channel_id, assignee_type, assigned_to_user_id, meta")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .maybeSingle();
  if (!conv) return apiNotFound("Conversation");

  const row = conv as { id: string; provider: string; channel_id: string; assignee_type: string; assigned_to_user_id: string | null; meta: Record<string, unknown> | null };

  // Only channels that need accepting (website chat). Everything else keeps working as before.
  if (!requiresClaim(row.provider)) {
    return apiError("NOT_CLAIMABLE", "This conversation doesn't need to be accepted.", 409);
  }

  const existingOwner = ownerOf(row);
  if (existingOwner === auth.userId) {
    // Double click, or two tabs: already yours. Idempotent, and no second note.
    return apiSuccess({ conversation_id: id, owner_id: auth.userId, already_yours: true });
  }
  if (existingOwner) {
    const name = await displayNameFor(supabase, existingOwner);
    return apiError("ALREADY_ACCEPTED", `${name} is already handling this chat.`, 409, { owner_id: existingOwner, owner_name: name });
  }

  // First one wins: ONE conditional update decides it. It only changes the row while nobody owns it
  // (unassigned, or "human" with a deleted user), so two people clicking at once cannot both succeed.
  const { data: won } = await supabase
    .from("conversations")
    // Accepting also ends AI replies for this chat and clears the "Needs a human" flag (docs/WEBSITE-CHAT-AI-REPLY-BRIEF.md).
    .update({ assignee_type: "human", assigned_to_user_id: auth.userId, ai_autonomy: "off", ...withoutNeedsHuman(row.meta) })
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .or(OWNERLESS_FILTER)
    .select("id")
    .maybeSingle();

  if (!won) {
    // Someone else got there between our read and our update: tell this person who.
    const { data: now } = await supabase
      .from("conversations")
      .select("assignee_type, assigned_to_user_id")
      .eq("id", id)
      .eq("tenant_id", auth.tenantId)
      .maybeSingle();
    const winner = now ? ownerOf(now as { assignee_type: string; assigned_to_user_id: string | null }) : null;
    if (winner === auth.userId) {
      return apiSuccess({ conversation_id: id, owner_id: auth.userId, already_yours: true });
    }
    if (winner) {
      const name = await displayNameFor(supabase, winner);
      return apiError("ALREADY_ACCEPTED", `${name} is already handling this chat.`, 409, { owner_id: winner, owner_name: name });
    }
    return apiError("CHAT_CHANGED", "This chat just changed. Refresh and try again.", 409);
  }

  const name = await displayNameFor(supabase, auth.userId);
  await writeSystemNote(supabase, {
    tenantId: auth.tenantId,
    conversationId: id,
    channelId: row.channel_id,
    userId: auth.userId,
    text: `${name} accepted this chat`,
  });

  return apiSuccess({ conversation_id: id, owner_id: auth.userId, owner_name: name });
}
