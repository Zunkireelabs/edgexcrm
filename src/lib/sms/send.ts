import { scopedClientForTenant } from "@/lib/supabase/scoped";
import { getSmsProvider } from "./provider";
import { applyEnvGuard } from "./env-guard";
import { attributeProviderResults } from "./attribute";
import { logger } from "@/lib/logger";

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

    // Attribute provider results by phone number, not array position —
    // Aakash returns valid[] and invalid[] as separate arrays, so a single
    // invalid recipient shifts every later positional match onto the wrong
    // row. The positional path survives only for sandboxed sends, where
    // SMS_TEST_RECIPIENTS redirection makes 1:1 phone matching genuinely
    // impossible and accuracy doesn't matter.
    const { attributions, totalCreditsCharged: groupCredits, unmatched } = attributeProviderResults({
      messages: groupMessages,
      result: outcome.result,
      sandboxed: guarded.sandboxed,
    });

    if (unmatched.length > 0) {
      logger.warn(
        { tenantId, unmatchedCount: unmatched.length, unmatchedIds: unmatched },
        "sendQueuedBatch: recipient(s) found in neither provider valid[] nor invalid[] — provider-contract violation"
      );
    }

    totalCreditsCharged += groupCredits;

    for (const attribution of attributions) {
      if (attribution.outcome === "submitted") {
        sent += 1;
        await db
          .from("sms_messages")
          .update({
            status: "submitted",
            provider_message_id: attribution.providerMessageId,
            provider_credit: attribution.credit,
            provider_network: attribution.network,
            provider_status: attribution.providerStatus,
            sent_at: new Date().toISOString(),
            attempt_count: 1,
          })
          .eq("id", attribution.messageId);
      } else {
        failed += 1;
        await db
          .from("sms_messages")
          .update({
            status: "failed",
            error_code: attribution.errorCode,
            error_message: attribution.errorMessage,
            attempt_count: 1,
          })
          .eq("id", attribution.messageId);
      }
    }
  }

  return { sent, failed, totalCreditsCharged };
}
