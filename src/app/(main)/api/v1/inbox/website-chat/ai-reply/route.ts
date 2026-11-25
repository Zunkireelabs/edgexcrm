// PUT /api/v1/inbox/website-chat/ai-reply — switch it on or off and set the Admizz AI site id (admin only)
//
// The saved setting is read through GET /api/v1/inbox/website-chat (the card's own request).
// Admizz (education_consultancy) only, and only when the server is set up for it (INBOX_AI_REPLY_ENABLED + the AI address and
// key). The tenant always comes from the signed-in session. Stored at inbox_channels.meta.website_chat_ai.

import { NextRequest } from "next/server";
import { apiNotFound, apiSuccess, apiValidationError } from "@/lib/api/response";
import { guard, errorResponse } from "@/lib/inbox/website-chat/route-helpers";
import { AI_REPLY_INDUSTRY, aiReplyServerEnabled, parseAiReplyInput } from "@/lib/inbox/ai-reply/config";

export async function PUT(request: NextRequest) {
  const g = await guard();
  if (!g.ok) return g.response;
  if (g.auth.industryId !== AI_REPLY_INDUSTRY || !aiReplyServerEnabled()) return apiNotFound("AI replies");

  const parsed = parseAiReplyInput(await request.json().catch(() => null));
  if (!parsed.ok) return apiValidationError(parsed.errors);

  try {
    const db = g.db.raw();
    const { data: channel } = await db.from("inbox_channels").select("id, meta").eq("tenant_id", g.auth.tenantId).eq("provider", "chatwoot").maybeSingle();
    if (!channel) return apiNotFound("Website chat");
    const row = channel as { id: string; meta: Record<string, unknown> | null };

    // Only this key changes: the widget settings (meta.website_chat) and everything else on the channel are kept as they are.
    const { error } = await db
      .from("inbox_channels")
      .update({ meta: { ...(row.meta ?? {}), website_chat_ai: parsed.value } })
      .eq("id", row.id)
      .eq("tenant_id", g.auth.tenantId);
    if (error) throw new Error(error.message);
    return apiSuccess(parsed.value);
  } catch (err) {
    return errorResponse(err);
  }
}
