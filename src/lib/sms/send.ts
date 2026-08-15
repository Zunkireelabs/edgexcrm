import { scopedClientForTenant } from "@/lib/supabase/scoped";
import { getSmsProvider } from "./provider";
import { applyEnvGuard } from "./env-guard";

// The single orchestration path every future caller (blast sends in Phase 3,
// 1:1 sends in Phase 5, sequence steps in Phase 6+) goes through. Loads the
// given queued/deferred messages, groups identical rendered bodies into one
// provider call (Aakash accepts one shared `text` + comma-separated `to`),
// applies the sandbox env guard, sends, then writes back per-recipient
// provider_message_id / credit / network / status and flips row status.
//
// NOTE: merge-tagged bodies differ per recipient, so in practice grouping
// degrades to one provider call per recipient whenever render.ts resolved
// per-lead tokens into the body before this function ever sees the rows —
// personalization and batching are mutually exclusive on this API. Phase 3
// decides the product answer (batch identical boilerplate vs. always
// personalize); this function just needs to handle both shapes, which the
// grouping-by-body below already does.

interface QueuedMessageRow {
  id: string;
  tenant_id: string;
  to_phone: string;
  body: string;
}

export interface SendQueuedBatchResult {
  sent: number;
  failed: number;
  totalCreditsCharged: number;
}

export async function sendQueuedBatch(tenantId: string, messageIds: string[]): Promise<SendQueuedBatchResult> {
  if (messageIds.length === 0) return { sent: 0, failed: 0, totalCreditsCharged: 0 };

  const db = await scopedClientForTenant(tenantId);

  const { data: rows, error } = await db
    .from("sms_messages")
    .select("id, tenant_id, to_phone, body")
    .in("id", messageIds)
    .in("status", ["queued", "deferred"]);

  if (error) throw new Error(`sendQueuedBatch: failed to load messages: ${error.message}`);
  const messages = (rows ?? []) as unknown as QueuedMessageRow[];
  if (messages.length === 0) return { sent: 0, failed: 0, totalCreditsCharged: 0 };

  // Group message ids by identical rendered body — batches boilerplate,
  // degrades to 1:1 for personalized bodies.
  const groups = new Map<string, QueuedMessageRow[]>();
  for (const msg of messages) {
    const existing = groups.get(msg.body);
    if (existing) existing.push(msg);
    else groups.set(msg.body, [msg]);
  }

  const provider = getSmsProvider();
  let sent = 0;
  let failed = 0;
  let totalCreditsCharged = 0;

  for (const [body, groupMessages] of groups) {
    const intendedTo = groupMessages.map((m) => m.to_phone);
    const guarded = applyEnvGuard(intendedTo, body);

    await db.from("sms_messages").update({ status: "sending" }).in(
      "id",
      groupMessages.map((m) => m.id)
    );

    const outcome = await provider.send({ to: guarded.to, text: guarded.text });

    if (!outcome.ok) {
      failed += groupMessages.length;
      for (const msg of groupMessages) {
        await db
          .from("sms_messages")
          .update({
            status: "failed",
            error_code: outcome.code,
            error_message: outcome.message,
            attempt_count: 1,
          })
          .eq("id", msg.id);
      }
      continue;
    }

    // Sandboxed sends route to SMS_TEST_RECIPIENTS, which won't line up 1:1
    // with intended recipients by position/count — write back provider
    // results in order against however many messages this group has, best
    // effort, rather than trying to re-match by phone number.
    const byIndex = outcome.result.valid;
    for (let i = 0; i < groupMessages.length; i++) {
      const msg = groupMessages[i];
      const providerResult = byIndex[i] ?? byIndex[byIndex.length - 1];
      if (!providerResult) {
        failed += 1;
        continue;
      }
      totalCreditsCharged += providerResult.credit;
      sent += 1;
      await db
        .from("sms_messages")
        .update({
          status: "submitted",
          provider_message_id: providerResult.id,
          provider_credit: providerResult.credit,
          provider_network: providerResult.network,
          provider_status: providerResult.status,
          sent_at: new Date().toISOString(),
          attempt_count: 1,
        })
        .eq("id", msg.id);
    }
  }

  return { sent, failed, totalCreditsCharged };
}
