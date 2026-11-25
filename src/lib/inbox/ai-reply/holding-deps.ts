// The real database side of the holding message. Every query is scoped to the tenant.

import { createServiceClient } from "@/lib/supabase/server";
import { aiReplyServerEnabled, HOLDING_META_KEY } from "./config";
import { realAiReplyDeps } from "./deps";
import type { HoldingDeps } from "./holding";

type Meta = Record<string, unknown> | null;

export function realHoldingDeps(): HoldingDeps {
  const base = realAiReplyDeps();
  return {
    serverEnabled: aiReplyServerEnabled(),
    loadState: base.loadState,
    stillUnowned: base.stillUnowned,
    sendAi: base.sendAi,

    async claimHolding(tenantId, conversationId) {
      const db = await createServiceClient();
      const { data: conv } = await db.from("conversations").select("meta").eq("id", conversationId).eq("tenant_id", tenantId).maybeSingle();
      if (!conv) return false;
      const meta = ((conv as { meta: Meta }).meta ?? {}) as Record<string, unknown>;
      if (meta[HOLDING_META_KEY]) return false;
      // Not racing: holding.ts runs at most one holding run per chat at a time (in-process lock), and this server is one process.
      const { data: claimed } = await db
        .from("conversations")
        .update({ meta: { ...meta, [HOLDING_META_KEY]: new Date().toISOString() } })
        .eq("id", conversationId)
        .eq("tenant_id", tenantId)
        .select("id")
        .maybeSingle();
      return !!claimed;
    },

    async releaseHolding(tenantId, conversationId) {
      const db = await createServiceClient();
      const { data: conv } = await db.from("conversations").select("meta").eq("id", conversationId).eq("tenant_id", tenantId).maybeSingle();
      if (!conv) return;
      const { [HOLDING_META_KEY]: _sent, ...rest } = ((conv as { meta: Meta }).meta ?? {}) as Record<string, unknown>;
      void _sent;
      await db.from("conversations").update({ meta: rest }).eq("id", conversationId).eq("tenant_id", tenantId);
    },
  };
}
