// What the Website chat card needs to show the "AI replies" part: whether it is available at all (Admizz only, server set up)
// and the saved setting. Part of the card's own GET, so the card makes no extra request.

import type { SupabaseClient } from "@supabase/supabase-js";
import { AI_REPLY_INDUSTRY, aiReplyServerEnabled, readAiReplyConfig, type AiReplyConfig } from "./config";

export interface AiReplyCardState extends AiReplyConfig {
  available: boolean;
}

const UNAVAILABLE: AiReplyCardState = { available: false, enabled: false, siteId: "" };

export async function loadAiReplyCardState(db: SupabaseClient, tenantId: string, industryId: string | null | undefined): Promise<AiReplyCardState> {
  if (industryId !== AI_REPLY_INDUSTRY || !aiReplyServerEnabled()) return UNAVAILABLE;
  const { data } = await db.from("inbox_channels").select("meta").eq("tenant_id", tenantId).eq("provider", "chatwoot").maybeSingle();
  return { available: true, ...readAiReplyConfig((data as { meta?: unknown } | null)?.meta) };
}
