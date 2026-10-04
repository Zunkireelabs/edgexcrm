import type { ScopedClient } from "@/lib/supabase/scoped";

// Per-sequence report (Outreach Phase 5): how a sequence is doing — who is in it, what happened to them, and what its
// emails did. Built from COUNT queries only (never row lists): a sequence can hold thousands of leads and PostgREST caps a
// row list at 1,000, so counting rows client-side would quietly under-report.
//
//   enrollments   total, and by state: running (active) / paused / completed / ended (unenrolled)
//   outcomes      replied (the system stopped it because the lead answered), do-not-contact (unsubscribed / bounced),
//                 frozen by Pause all
//   emails        sent (drafts sent), then what the provider reported: delivered / bounced / complained
//   per step      emails sent at each step — the funnel
//   queue         due now (waiting for the timer or the daily cap) and scheduled for later
//
// "Replied" counts leads the system stopped on a reply, so it is only tracked while the sequence is set to pause / end on
// reply — a sequence set to "keep sending" records no replies.

export interface SequenceReport {
  enrollments: {
    total: number;
    running: number;
    paused: number;
    completed: number;
    ended: number;
    replied: number;
    doNotContact: number;
    pausedByStopAll: number;
  };
  emails: { sent: number; delivered: number; bounced: number; complained: number };
  steps: Array<{ stepOrder: number; sent: number }>;
  queue: { dueNow: number; scheduledLater: number };
  rates: { deliveredPct: number | null; bouncedPct: number | null; complainedPct: number | null; repliedPct: number | null };
}

/** A percentage with one decimal, or null when there is nothing to divide by. */
export function pct(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return Math.round((part / whole) * 1000) / 10;
}

type Db = ScopedClient;

async function count(q: PromiseLike<{ count: number | null; error: { message: string } | null }>): Promise<number> {
  const { count: n, error } = await q;
  if (error) throw new Error(`sequence report: ${error.message}`);
  return n ?? 0;
}

export async function buildSequenceReport(db: Db, sequenceId: string, stepOrders: number[]): Promise<SequenceReport> {
  const enrollments = (status?: string, stopReason?: string) => {
    let q = db.from("sequence_enrollments").select("id", { count: "exact", head: true }).eq("sequence_id", sequenceId);
    if (status) q = q.eq("status", status);
    if (stopReason) q = q.eq("stop_reason", stopReason);
    return count(q);
  };

  // sent drafts of this sequence, optionally narrowed by the provider's status on the email they produced or by step
  const sentDrafts = (opts: { emailStatus?: string; stepOrder?: number } = {}) => {
    let q = db
      .from("sequence_step_drafts")
      .select(
        `id, sequence_enrollments!inner(sequence_id)${opts.emailStatus ? ", email_messages!inner(status)" : ""}`,
        { count: "exact", head: true }
      )
      .eq("status", "sent")
      .eq("sequence_enrollments.sequence_id", sequenceId);
    if (opts.emailStatus) q = q.eq("email_messages.status", opts.emailStatus);
    if (opts.stepOrder !== undefined) q = q.eq("step_order", opts.stepOrder);
    return count(q);
  };

  const pendingDrafts = (due: "now" | "later") => {
    const nowIso = new Date().toISOString();
    const q = db
      .from("sequence_step_drafts")
      .select("id, sequence_enrollments!inner(sequence_id, status)", { count: "exact", head: true })
      .eq("status", "pending")
      .eq("sequence_enrollments.sequence_id", sequenceId)
      .eq("sequence_enrollments.status", "active");
    return count(due === "now" ? q.lte("due_at", nowIso) : q.gt("due_at", nowIso));
  };

  const [
    total, running, paused, completed, ended, replied, doNotContact, pausedByStopAll,
    sent, delivered, bounced, complained,
    dueNow, scheduledLater,
    stepCounts,
  ] = await Promise.all([
    enrollments(), enrollments("active"), enrollments("paused"), enrollments("completed"), enrollments("unenrolled"),
    enrollments(undefined, "replied"), enrollments(undefined, "suppressed"), enrollments("paused", "sequence_paused"),
    sentDrafts(), sentDrafts({ emailStatus: "delivered" }), sentDrafts({ emailStatus: "bounced" }), sentDrafts({ emailStatus: "complained" }),
    pendingDrafts("now"), pendingDrafts("later"),
    Promise.all(stepOrders.map(async (stepOrder) => ({ stepOrder, sent: await sentDrafts({ stepOrder }) }))),
  ]);

  return {
    enrollments: { total, running, paused, completed, ended, replied, doNotContact, pausedByStopAll },
    emails: { sent, delivered, bounced, complained },
    steps: stepCounts,
    queue: { dueNow, scheduledLater },
    rates: {
      deliveredPct: pct(delivered, sent),
      bouncedPct: pct(bounced, sent),
      complainedPct: pct(complained, sent),
      repliedPct: pct(replied, total),
    },
  };
}
