import { inngest } from "@/lib/inngest/client";
import { scopedClientForTenant } from "@/lib/supabase/scoped";
import { fetchAllRows, type PageResult } from "@/lib/supabase/paginate";
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

// F5 (docs/BLAST-FINDINGS-2026-09-06.md) — a row that was mid-send when its
// worker step crashed is left in 'sending' forever: loadBatchIds above only
// ever selects 'queued', so once the main loop runs out of queued rows it
// has no way to notice a stranded 'sending' row exists at all, and would
// otherwise proceed straight to finalize as if nothing were left. This is
// the ONLY other place a row can be waiting on something — feed whatever's
// here back into sendQueuedEmailBatch, which already knows how to safely
// reclaim-or-permanently-fail a stranded row (§5.2 in send.ts) and already
// protects against double-sending a row that's still genuinely in flight.
// Not staleness-filtered here on purpose: sendQueuedEmailBatch itself is the
// one place that decision is made, so there is only one implementation of
// "is this actually stale" to keep in sync.
async function loadStrandedSendingIds(tenantId: string, blastId: string): Promise<string[]> {
  const db = await scopedClientForTenant(tenantId);
  const { data } = await db
    .from("email_messages")
    .select("id")
    .eq("source", "blast")
    .eq("source_id", blastId)
    .eq("status", "sending")
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
  // F5 (docs/BLAST-FINDINGS-2026-09-06.md) — total rows actually materialized
  // for this blast. sent+failed+cancelled+suppressed can legitimately fall
  // short of this (a row still 'queued'/'sending') while the blast is mid-flight
  // — that's normal. finalizeEmailBlast is the one caller for whom a shortfall
  // is NOT normal (it should only ever run once nothing is left outstanding),
  // so it's the one that checks total against the other four.
  total: number;
}

// Live counts straight off email_messages — the source of truth. Shared by
// the throttle branch and finalize so a blast's recipients_* columns never
// lag what the per-row recipient table (and the amber throttle banner) shows
// mid-flight, across an arbitrary number of throttle/resume cycles.
export async function computeBlastCounts(tenantId: string, blastId: string): Promise<BlastCounts> {
  const db = await scopedClientForTenant(tenantId);
  // Paginated: an unpaged select here silently caps at PostgREST's 1000-row
  // default. This function is called both by the mid-flight throttle branch
  // (the "Throttled" banner's counts) and finalize — a real Admizz-scale
  // blast (the 3,118-row incident this branch fixes is already over the cap)
  // would show wrong live counts during the send and a wrong final tally.
  const rows = await fetchAllRows<MessageStatusRow>((offset, limit) =>
    db
      .from("email_messages")
      .select("status")
      .eq("source", "blast")
      .eq("source_id", blastId)
      .order("id", { ascending: true })
      .range(offset, offset + limit - 1) as unknown as Promise<PageResult<MessageStatusRow>>
  );
  return {
    sent: rows.filter((r) => r.status === "sent" || r.status === "delivered").length,
    failed: rows.filter((r) => r.status === "failed" || r.status === "bounced").length,
    cancelled: rows.filter((r) => r.status === "cancelled").length,
    suppressed: rows.filter((r) => r.status === "suppressed").length,
    total: rows.length,
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

  const { sent, failed, cancelled, suppressed, total } = await computeBlastCounts(tenantId, blastId);
  // F5 (docs/BLAST-FINDINGS-2026-09-06.md) — a real incident finalized a
  // blast as 'sent' with 12,100 of 16,000 rows still 'queued'. The caller
  // (email-blast-send.ts's main loop) is supposed to only reach this point
  // once nothing is outstanding — including reclaiming any row stranded in
  // 'sending' by a crashed prior run, see loadStrandedSendingIds — but this
  // is the last line of defense: sent+failed+cancelled+suppressed should
  // always equal every row actually materialized. If it doesn't, something
  // is still 'queued' or 'sending' that this run never accounted for, and
  // finalize must NEVER report that as a clean 'sent' — that is exactly the
  // false-success bug. Surface it loudly (an unaccounted-for recipient is
  // worth paging on) and mark the blast the way a human would want to find
  // it: something needs attention, not "all good."
  const unaccounted = total - (sent + failed + cancelled + suppressed);

  let finalStatus: string;
  if (wasCancelled) {
    finalStatus = "cancelled";
  } else if (unaccounted > 0) {
    logger.error(
      { tenantId, blastId, unaccounted, total, sent, failed, cancelled, suppressed },
      "[finalizeEmailBlast] rows unaccounted for at finalize time (still 'queued' or 'sending') — refusing to report a false 'sent'; marking partially_failed"
    );
    finalStatus = "partially_failed";
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

    // F5 (docs/BLAST-FINDINGS-2026-09-06.md) — the loop above only ever looks
    // for 'queued' rows, so a row stranded in 'sending' by a crashed prior
    // run (this blast's own earlier attempt) is invisible to it and would
    // otherwise go straight to finalize unaccounted for. One last pass here
    // gives sendQueuedEmailBatch's existing reclaim-or-permanently-fail logic
    // (§5.2 in send.ts) a chance to actually run on it before finalize's own
    // unaccounted-for check (the final safety net, not the primary fix).
    const strandedIds = await step.run("load-stranded-sending", () => loadStrandedSendingIds(tenantId, blastId));
    if (strandedIds.length > 0) {
      const reclaimResult = await step.run("reclaim-stranded", () => sendQueuedEmailBatch(tenantId, strandedIds, { capCaller: "blast" }));
      totalSent += reclaimResult.sent;
      totalFailed += reclaimResult.failed;
      totalSuppressed += reclaimResult.suppressed;
      logger.info(
        { tenantId, blastId, strandedCount: strandedIds.length, reclaimed: reclaimResult },
        "[email-blast-send] reclaimed row(s) stranded in 'sending' from a prior crashed run"
      );
    }

    const outcome = await step.run("finalize", () => finalizeEmailBlast(tenantId, blastId));

    return { blastId, ...outcome };
  }
);
