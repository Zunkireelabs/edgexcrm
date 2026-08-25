import { inngest } from "@/lib/inngest/client";
import { scopedClientForTenant } from "@/lib/supabase/scoped";
import { sendQueuedEmailBatch } from "@/lib/email/outbound/send";
import { logger } from "@/lib/logger";

// Durable send worker for an email blast — OUTREACH-PHASE1-BRIEF.md §5/§6.
// The /api/v1/email-blasts/[id]/send route materializes rows and emits
// email/blast.send; this function is the ONLY thing that ever calls
// sendQueuedEmailBatch for a blast (no second send path). Mirrors
// sms-blast-send.ts's shape — there is no email precedent to mirror instead,
// email had no Inngest function before this phase.

const MAX_RECIPIENTS_PER_CALL = 100;

interface BlastRow {
  id: string;
  scheduled_for: string | null;
  status: string;
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
    .from("email_messages")
    .select("id")
    .eq("source", "blast")
    .eq("source_id", blastId)
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(MAX_RECIPIENTS_PER_CALL);
  return ((data ?? []) as unknown as QueuedIdRow[]).map((r) => r.id);
}

// UTC midnight — the same clock sendQueuedEmailBatch's daily-cap check reads
// (getDailyCapStatus). Resuming at any other boundary would let the worker
// wake up before the cap has actually reset and immediately throttle again.
function nextUtcMidnight(): Date {
  const next = new Date();
  next.setUTCHours(24, 0, 0, 0);
  return next;
}

interface BlastStatusRow {
  status: string;
}

interface BlastCounts {
  sent: number;
  failed: number;
  cancelled: number;
  suppressed: number;
}

// Live counts straight off email_messages — the source of truth. Shared by
// the throttle branch and finalize so a blast's recipients_* columns never
// lag what the per-row recipient table (and the amber throttle banner) shows
// mid-flight, across an arbitrary number of throttle/resume cycles.
export async function computeBlastCounts(tenantId: string, blastId: string): Promise<BlastCounts> {
  const db = await scopedClientForTenant(tenantId);
  const { data: statusRows } = await db.from("email_messages").select("status").eq("source", "blast").eq("source_id", blastId);
  const rows = (statusRows ?? []) as unknown as MessageStatusRow[];
  return {
    sent: rows.filter((r) => r.status === "sent" || r.status === "delivered").length,
    failed: rows.filter((r) => r.status === "failed" || r.status === "bounced").length,
    cancelled: rows.filter((r) => r.status === "cancelled").length,
    suppressed: rows.filter((r) => r.status === "suppressed").length,
  };
}

// F-1 (SMS precedent, SMS-PHASE3A-FIXES-BRIEF.md): a blast the user already
// cancelled (via /cancel, before this run woke up, or mid-run) must NEVER be
// transitioned out of 'cancelled' — not to 'failed', not to 'partially_failed'.
// Rows left 'cancelled' by /cancel are counted SEPARATELY from 'failed':
// recipients_failed means "we tried and it failed", not "we never got to it".
// No credit ledger to settle for email (the one place this genuinely
// simplifies vs. the SMS precedent) — finalize is just a status/counter stamp.
export async function finalizeEmailBlast(
  tenantId: string,
  blastId: string
): Promise<{ finalStatus: string; sent: number; failed: number; cancelled: number; suppressed: number }> {
  const db = await scopedClientForTenant(tenantId);

  const { data: currentBlast } = await db.from("email_blasts").select("status").eq("id", blastId).maybeSingle();
  const wasCancelled = (currentBlast as unknown as BlastStatusRow | null)?.status === "cancelled";

  const { sent, failed, cancelled, suppressed } = await computeBlastCounts(tenantId, blastId);

  let finalStatus: string;
  if (wasCancelled) {
    finalStatus = "cancelled";
  } else if (failed === 0 && cancelled === 0) {
    finalStatus = "sent";
  } else if (sent === 0) {
    finalStatus = "failed";
  } else {
    finalStatus = "partially_failed";
  }

  await db
    .from("email_blasts")
    .update({
      status: finalStatus,
      recipients_sent: sent,
      recipients_failed: failed,
      recipients_suppressed: suppressed,
      completed_at: new Date().toISOString(),
    })
    .eq("id", blastId);

  return { finalStatus, sent, failed, cancelled, suppressed };
}

export const emailBlastSend = inngest.createFunction(
  {
    id: "email-blast-send",
    triggers: [{ event: "email/blast.send" }],
    // Two blasts for one tenant must never interleave — same daily-cap
    // budget is shared across every blast (and any future sequence sends)
    // for that tenant, so concurrent runs would double-count "sent today".
    concurrency: [{ key: "event.data.tenantId", limit: 1 }],
  },
  async ({ event, step }) => {
    const { tenantId, blastId } = event.data as { tenantId: string; blastId: string };

    const blast = await step.run("load-blast", async () => {
      const db = await scopedClientForTenant(tenantId);
      const { data } = await db.from("email_blasts").select("id, scheduled_for, status").eq("id", blastId).maybeSingle();
      return (data as unknown as BlastRow | null) ?? null;
    });
    if (!blast) return { skipped: true, reason: "blast not found" };
    if (blast.status === "cancelled") {
      // Cancelled before this run even started (e.g. a re-emitted resume
      // event racing a /cancel that landed first) — finalize is a no-op
      // status stamp, nothing to send.
      const outcome = await step.run("finalize-precancelled", () => finalizeEmailBlast(tenantId, blastId));
      return { blastId, ...outcome };
    }

    // Scheduled send: park the whole run until the requested time.
    if (blast.scheduled_for) {
      const when = new Date(blast.scheduled_for);
      if (when.getTime() > Date.now()) {
        await step.sleepUntil("wait-for-scheduled-time", when);
      }
    }

    await step.run("mark-sending", async () => {
      const db = await scopedClientForTenant(tenantId);
      await db.from("email_blasts").update({ status: "sending" }).eq("id", blastId).in("status", ["queued", "throttled"]);
    });

    let totalSent = 0;
    let totalFailed = 0;
    let totalSuppressed = 0;
    let batchIndex = 0;

    // Batches of MAX_RECIPIENTS_PER_CALL as memoized step.runs.
    for (;;) {
      const ids = await step.run(`load-batch-${batchIndex}`, () => loadBatchIds(tenantId, blastId));
      if (ids.length === 0) break;

      const result = await step.run(`send-batch-${batchIndex}`, () =>
        sendQueuedEmailBatch(tenantId, ids, { capCaller: "blast" })
      );
      totalSent += result.sent;
      totalFailed += result.failed;
      totalSuppressed += result.suppressed;

      // §6: hitting the daily cap is a first-class state, not a stop reason.
      // Remaining rows stay 'queued' (sendQueuedEmailBatch never touches
      // them); mark the blast 'throttled', sleep until the cap resets, then
      // re-emit a fresh event and end THIS run — keeps each run's step
      // history bounded instead of one run sleeping across many days for a
      // 16.7k-at-2000/day blast (~9 throttle cycles).
      if (result.throttled > 0) {
        // Stamp live counters alongside the status flip — without this the
        // recipients_sent column (and the amber "X of Y sent so far" banner
        // that reads it) stays stuck at whatever /send set it to, since
        // finalizeEmailBlast never runs on this branch. Recomputed from
        // email_messages, not accumulated from this run's local totals,
        // because a resumed run after a throttle/sleep cycle starts a fresh
        // step history with totalSent back at 0.
        await step.run(`mark-throttled-${batchIndex}`, async () => {
          const db = await scopedClientForTenant(tenantId);
          const counts = await computeBlastCounts(tenantId, blastId);
          await db
            .from("email_blasts")
            .update({ status: "throttled", recipients_sent: counts.sent, recipients_failed: counts.failed, recipients_suppressed: counts.suppressed })
            .eq("id", blastId)
            .neq("status", "cancelled");
        });

        const stillCancelled = await step.run(`check-cancelled-${batchIndex}`, async () => {
          const db = await scopedClientForTenant(tenantId);
          const { data } = await db.from("email_blasts").select("status").eq("id", blastId).maybeSingle();
          return (data as unknown as BlastStatusRow | null)?.status === "cancelled";
        });
        if (stillCancelled) break;

        const resumeAt = await step.run(`compute-resume-${batchIndex}`, () => nextUtcMidnight().toISOString());
        await step.sleepUntil(`throttle-wait-${batchIndex}`, new Date(resumeAt));
        await step.run(`re-emit-${batchIndex}`, () => inngest.send({ name: "email/blast.send", data: { tenantId, blastId } }));

        logger.info({ tenantId, blastId, batchIndex, resumeAt }, "[email-blast-send] daily cap reached — throttled, re-emitted for resume");
        return { blastId, throttled: true, resumeAt, sent: totalSent, failed: totalFailed, suppressed: totalSuppressed };
      }

      batchIndex++;
      if (ids.length === MAX_RECIPIENTS_PER_CALL) {
        await step.sleep(`sleep-after-batch-${batchIndex}`, "2s");
      }
    }

    const outcome = await step.run("finalize", () => finalizeEmailBlast(tenantId, blastId));

    return { blastId, ...outcome };
  }
);
