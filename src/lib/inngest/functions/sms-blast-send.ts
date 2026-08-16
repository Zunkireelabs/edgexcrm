import { inngest } from "@/lib/inngest/client";
import { scopedClientForTenant } from "@/lib/supabase/scoped";
import { sendQueuedBatch } from "@/lib/sms/send";
import { loadTenantSmsSettings, resolveTenantTimezone } from "@/lib/sms/settings";
import { resolveSendWindow } from "@/lib/sms/quiet-hours";
import { createNotification, getTenantAdminRecipients } from "@/lib/notifications";
import { logger } from "@/lib/logger";

// Durable send worker for an SMS blast — SMS-PHASE3A-BRIEF.md §7. The
// /api/v1/sms/blasts/[id]/send route materializes rows, reserves credits, and
// emits sms/blast.send; this function is the ONLY thing that ever calls
// sendQueuedBatch for a blast (no second send path).

const MAX_RECIPIENTS_PER_CALL = 100;

interface BlastRow {
  id: string;
  scheduled_for: string | null;
  reserved_credits: number | null;
}

interface QueuedIdRow {
  id: string;
}

interface MessageStatusRow {
  status: string;
}

async function loadBatchIds(tenantId: string, blastId: string): Promise<string[]> {
  const db = await scopedClientForTenant(tenantId);
  const { data } = await db
    .from("sms_messages")
    .select("id")
    .eq("blast_id", blastId)
    .in("status", ["queued", "deferred"])
    .order("created_at", { ascending: true })
    .limit(MAX_RECIPIENTS_PER_CALL);
  return ((data ?? []) as unknown as QueuedIdRow[]).map((r) => r.id);
}

async function batchErrorCodes(tenantId: string, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const db = await scopedClientForTenant(tenantId);
  const { data } = await db.from("sms_messages").select("error_code").in("id", ids).eq("status", "failed");
  const codes = new Set(((data ?? []) as unknown as { error_code: string | null }[]).map((r) => r.error_code).filter(Boolean) as string[]);
  return Array.from(codes);
}

interface BlastStatusRow {
  status: string;
}

// Cancels any remaining queued/deferred rows, settles reserved vs. actual
// credits (p_ref_type passed EXPLICITLY — §8 L-1: relying on the default is
// how mislabeled ledger rows come back in Phase 5; idempotent on ref_id, so
// this is a safe no-op if /cancel already settled — SMS-PHASE3A-FIXES-BRIEF.md
// F-2), and stamps the blast's final status + counters.
//
// F-1: a blast the user already cancelled (via /cancel, before this run woke
// up) must NEVER be transitioned out of 'cancelled' — not to 'failed', not
// to 'partially_failed'. Rows left 'cancelled' (by /cancel, or by this
// function's own cleanup on an insufficient_balance/invalid_token stop) are
// counted SEPARATELY from 'failed': recipients_failed means "we tried and it
// failed", not "we never got to it".
export async function finalizeBlast(
  tenantId: string,
  blastId: string,
  reservedCredits: number,
  actualCredits: number,
  stopReason: "invalid_token" | "insufficient_balance" | null
): Promise<{ finalStatus: string; sent: number; failed: number; cancelled: number; suppressed: number }> {
  const db = await scopedClientForTenant(tenantId);

  const { data: currentBlast } = await db.from("sms_blasts").select("status").eq("id", blastId).maybeSingle();
  const wasCancelled = (currentBlast as unknown as BlastStatusRow | null)?.status === "cancelled";

  // /cancel already did this cleanup for a user-cancelled blast; only needed
  // here for the insufficient_balance/invalid_token stop paths.
  if (!wasCancelled) {
    await db.from("sms_messages").update({ status: "cancelled" }).eq("blast_id", blastId).in("status", ["queued", "deferred"]);
  }

  const { error: settleError } = await db.rpc("sms_credits_settle", {
    p_ref_id: blastId,
    p_reserved: reservedCredits,
    p_actual: actualCredits,
    p_ref_type: "sms_blast",
  });
  if (settleError) {
    logger.error({ err: settleError, tenantId, blastId }, "[sms-blast-send] sms_credits_settle failed");
  }

  const { data: statusRows } = await db.from("sms_messages").select("status").eq("blast_id", blastId);
  const rows = (statusRows ?? []) as unknown as MessageStatusRow[];
  const sent = rows.filter((r) => r.status === "submitted" || r.status === "delivered").length;
  const failed = rows.filter((r) => r.status === "failed").length;
  const cancelled = rows.filter((r) => r.status === "cancelled").length;
  const suppressed = rows.filter((r) => r.status === "suppressed").length;

  let finalStatus: string;
  if (wasCancelled) {
    finalStatus = "cancelled";
  } else if (stopReason === "insufficient_balance") {
    // SMS-PHASE3A-BRIEF.md §7: always partially_failed on this stop, even if
    // nothing was sent yet — it's a mid-blast stop, not a clean failure.
    finalStatus = "partially_failed";
  } else if (failed === 0 && cancelled === 0) {
    finalStatus = "sent";
  } else if (sent === 0) {
    finalStatus = "failed";
  } else {
    finalStatus = "partially_failed";
  }

  await db
    .from("sms_blasts")
    .update({
      status: finalStatus,
      actual_credits: actualCredits,
      recipients_sent: sent,
      recipients_failed: failed,
      recipients_suppressed: suppressed,
      completed_at: new Date().toISOString(),
    })
    .eq("id", blastId);

  return { finalStatus, sent, failed, cancelled, suppressed };
}

export const smsBlastSend = inngest.createFunction(
  {
    id: "sms-blast-send",
    triggers: [{ event: "sms/blast.send" }],
    // Two blasts for one tenant must never interleave.
    concurrency: [{ key: "event.data.tenantId", limit: 1 }],
  },
  async ({ event, step }) => {
    const { tenantId, blastId } = event.data as { tenantId: string; blastId: string };

    const blast = await step.run("load-blast", async () => {
      const db = await scopedClientForTenant(tenantId);
      const { data } = await db.from("sms_blasts").select("id, scheduled_for, reserved_credits").eq("id", blastId).maybeSingle();
      return (data as unknown as BlastRow | null) ?? null;
    });
    if (!blast) return { skipped: true, reason: "blast not found" };

    // Scheduled send: park the whole run until the requested time.
    if (blast.scheduled_for) {
      const when = new Date(blast.scheduled_for);
      if (when.getTime() > Date.now()) {
        await step.sleepUntil("wait-for-scheduled-time", when);
      }
    }

    // Quiet hours: resolveSendWindow is pure (Phase 2) — this is where 3A
    // wires it. Not allowed right now -> defer every queued row and sleep
    // until the window opens, then release them back to queued.
    const quietHoursCheck = await step.run("check-quiet-hours", async () => {
      const db = await scopedClientForTenant(tenantId);
      const settings = await loadTenantSmsSettings(db);
      if (!settings.quiet_hours_enabled) return { allowed: true as const };
      const timezone = await resolveTenantTimezone(db, tenantId, settings.timezone);
      const window = resolveSendWindow(new Date(), timezone, settings.quiet_hours_start, settings.quiet_hours_end);
      if (window.allowed) return { allowed: true as const };
      await db
        .from("sms_messages")
        .update({ status: "deferred", deferred_until: window.deferUntil.toISOString() })
        .eq("blast_id", blastId)
        .eq("status", "queued");
      return { allowed: false as const, deferUntil: window.deferUntil.toISOString() };
    });

    if (!quietHoursCheck.allowed) {
      await step.sleepUntil("quiet-hours-release", new Date(quietHoursCheck.deferUntil));
      await step.run("release-deferred", async () => {
        const db = await scopedClientForTenant(tenantId);
        await db.from("sms_messages").update({ status: "queued" }).eq("blast_id", blastId).eq("status", "deferred");
      });
    }

    let totalActualCredits = 0;
    let stopReason: "invalid_token" | "insufficient_balance" | null = null;
    let batchIndex = 0;

    // Batches of MAX_RECIPIENTS_PER_CALL as memoized step.runs. Aakash's
    // per-call limits are undocumented; stay conservative.
    for (;;) {
      const ids = await step.run(`load-batch-${batchIndex}`, () => loadBatchIds(tenantId, blastId));
      if (ids.length === 0) break;

      const result = await step.run(`send-batch-${batchIndex}`, () => sendQueuedBatch(tenantId, ids));
      totalActualCredits += result.totalCreditsCharged;

      const errorCodes = await step.run(`check-batch-${batchIndex}`, () => batchErrorCodes(tenantId, ids));

      if (errorCodes.includes("invalid_token")) {
        // Retrying is pointless — the box's IP changed or the token died.
        logger.error({ tenantId, blastId, batchIndex }, "[sms-blast-send] invalid_token — aborting blast");
        stopReason = "invalid_token";
        break;
      }
      if (errorCodes.includes("insufficient_balance")) {
        stopReason = "insufficient_balance";
        break;
      }

      batchIndex++;
      if (ids.length === MAX_RECIPIENTS_PER_CALL) {
        await step.sleep(`sleep-after-batch-${batchIndex}`, "2s");
      }
    }

    const outcome = await step.run("finalize", () =>
      finalizeBlast(tenantId, blastId, blast.reserved_credits ?? totalActualCredits, totalActualCredits, stopReason)
    );

    if (stopReason === "insufficient_balance") {
      await step.run("notify-low-credits", async () => {
        const db = await scopedClientForTenant(tenantId);
        const admins = await getTenantAdminRecipients(db.raw(), tenantId);
        await Promise.all(
          admins.map((userId) =>
            createNotification({
              tenantId,
              userId,
              type: "sms_credits_low",
              title: "SMS blast stopped — insufficient credits",
              message: `Blast ${blastId} stopped mid-send: the tenant's SMS credit balance ran out. Remaining recipients were cancelled.`,
              link: `/sms/${blastId}`,
            })
          )
        );
      });
    }

    return { blastId, stopReason, ...outcome };
  }
);
