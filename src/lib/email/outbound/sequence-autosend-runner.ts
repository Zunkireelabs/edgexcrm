import { createServiceClient } from "@/lib/supabase/server";
import { scopedClientForTenant } from "@/lib/supabase/scoped";
import { sendDraftViaEdgeX } from "@/industries/_shared/features/outreach/lib/send-draft";
import { logger } from "@/lib/logger";

// Auto-send worker for Outreach drip sequences — OUTREACH-PHASE2-BRIEF.md §5. Sends every step of an
// `auto_send = true` sequence by itself once it is due (draft.due_at <= now, enrollment active).
//
// Driven by an in-process timer (src/instrumentation.ts -> startRunnerTimer("sequence-autosend")), like the blast and
// scheduled-send runners — NOT Inngest. It used to be an Inngest cron (every 15 minutes, so an email could be up to 15
// minutes late, and it ran on the shared Inngest quota that has silently stopped other workers before). Due times live
// in the database, so a restart only delays a send, never loses one; sendDraftViaEdgeX upserts on (source_id, lead_id),
// so a draft can never go out twice even if two passes overlap.
//
// it_agency's sequences (email_sequences.auto_send defaults to false) are structurally unreachable here: every query
// below is scoped to `auto_send = true`, so a manual-copy sequence's steps are never touched by this file — verified
// by a regression test in sequence-autosend-runner.test.ts.
//
// Cap priority (§3.1/§5.3): sendQueuedEmailBatch is called here with NO capCaller option, which means the full
// daily-cap remaining is visible — drip claims first. blast-runner.ts passes { capCaller: "blast" }, which reserves
// headroom for whatever this file still has due today. See cap.ts's GetDailyCapStatusOptions doc.
//
// SCALE: the due drafts are found with ONE query that joins the enrollment (an embedded filter on status and on the
// auto-send sequences' ids). The earlier version first loaded EVERY active enrollment id and passed the whole list to an
// `in (…)` filter — fine for a few hundred, but a bulk enroll of 5,000 leads made that URL far too long for PostgREST,
// so auto-send would have stopped working exactly when it was needed.

/** Drafts handled per query. Several are run back to back within one pass while there is work and time. */
const BATCH_SIZE = 50;
/** One pass works for at most this long, then returns; the timer calls it again. */
const PASS_BUDGET_MS = 20_000;
/** Sequence ids per `in (…)` — a handful of auto-send sequences in practice, chunked so it can never grow a URL. */
const SEQUENCE_ID_CHUNK = 100;

/** A draft whose send FAILED is pushed this far into the future so it can't sit at the head of the queue forever. */
const RETRY_AFTER_FAILED_MS = 60 * 60 * 1000;
/** … and one a previous attempt already ended as failed / suppressed (it will never be re-sent) waits longer. */
const RETRY_AFTER_HANDLED_MS = 24 * 60 * 60 * 1000;

let running = false;

interface IdRow {
  id: string;
}

interface TenantIdRow {
  tenant_id: string;
}

interface DueDraftRow {
  id: string;
  lead_id: string;
  subject: string;
  body_html: string;
  due_at: string;
}

export interface AutoSendSummary {
  sent: number;
  throttled: number;
  failed: number;
  skipped: number;
}

const EMPTY: AutoSendSummary = { sent: 0, throttled: 0, failed: 0, skipped: 0 };

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Tenants that currently have a due draft in an auto-send sequence (cross-tenant scan, service role). */
async function findTenantsWithDueAutoSendDrafts(): Promise<string[]> {
  const supabase = await createServiceClient();
  const nowIso = new Date().toISOString();

  const { data: autoSendSeqs, error: seqErr } = await supabase.from("email_sequences").select("id").eq("auto_send", true);
  if (seqErr) {
    logger.error({ err: seqErr }, "sequence-autosend: failed to load auto-send sequences");
    throw seqErr;
  }
  const sequenceIds = ((autoSendSeqs ?? []) as unknown as IdRow[]).map((s) => s.id);
  if (sequenceIds.length === 0) return [];

  const tenantIds = new Set<string>();
  for (const ids of chunk(sequenceIds, SEQUENCE_ID_CHUNK)) {
    const { data, error } = await supabase
      .from("sequence_step_drafts")
      .select("tenant_id, sequence_enrollments!inner(status, sequence_id)")
      .eq("status", "pending")
      .lte("due_at", nowIso)
      .eq("sequence_enrollments.status", "active")
      .in("sequence_enrollments.sequence_id", ids)
      .limit(2000);
    if (error) {
      logger.error({ err: error }, "sequence-autosend: failed to scan for due auto-send drafts");
      throw error;
    }
    for (const row of (data ?? []) as unknown as TenantIdRow[]) tenantIds.add(row.tenant_id);
  }
  return [...tenantIds];
}

/** Handles up to BATCH_SIZE due auto-send drafts for one tenant. */
export async function processTenantAutoSendDrafts(tenantId: string): Promise<AutoSendSummary> {
  const db = await scopedClientForTenant(tenantId);
  const nowIso = new Date().toISOString();

  const { data: autoSendSeqs } = await db.from("email_sequences").select("id").eq("auto_send", true);
  const sequenceIds = ((autoSendSeqs ?? []) as unknown as IdRow[]).map((s) => s.id);
  if (sequenceIds.length === 0) return { ...EMPTY };

  // Oldest due first; only drafts whose enrollment is ACTIVE (a paused / ended enrollment never sends).
  const due: DueDraftRow[] = [];
  for (const ids of chunk(sequenceIds, SEQUENCE_ID_CHUNK)) {
    const { data, error } = await db
      .from("sequence_step_drafts")
      .select("id, lead_id, subject, body_html, due_at, sequence_enrollments!inner(status, sequence_id)")
      .eq("status", "pending")
      .lte("due_at", nowIso)
      .eq("sequence_enrollments.status", "active")
      .in("sequence_enrollments.sequence_id", ids)
      .order("due_at", { ascending: true })
      .limit(BATCH_SIZE);
    if (error) {
      logger.error({ err: error, tenantId }, "sequence-autosend: failed to load due drafts");
      throw error;
    }
    due.push(...((data ?? []) as unknown as DueDraftRow[]));
  }
  due.sort((a, b) => (a.due_at < b.due_at ? -1 : a.due_at > b.due_at ? 1 : 0));

  const summary: AutoSendSummary = { ...EMPTY };

  // A failed / already-ended draft is not re-selected next batch: its due time moves out, so a handful of bad
  // addresses can never fill the head of the queue and starve everyone behind them.
  const retryLater = async (draftId: string, afterMs: number, reason: string) => {
    await db
      .from("sequence_step_drafts")
      .update({ due_at: new Date(Date.now() + afterMs).toISOString(), scheduled_error: reason.slice(0, 300) })
      .eq("id", draftId)
      .eq("status", "pending");
  };

  for (const draft of due.slice(0, BATCH_SIZE)) {
    const result = await sendDraftViaEdgeX(db, tenantId, draft);

    switch (result.status) {
      case "sent":
        summary.sent++;
        break;
      case "no_email":
        summary.skipped++;
        break;
      case "throttled":
        // §5.5 — daily cap hit: draft stays 'pending', never marked sent or dropped (and keeps its due time, so it is
        // first in line tomorrow). The due-draft bell (runOutreachDraftReminders) already flags it as "due".
        summary.throttled++;
        break;
      case "failed":
        // The underlying email_messages row carries the reason. The draft stays 'pending' (a human can skip it from the
        // cadence timeline) but is retried in an hour, not on every pass.
        summary.failed++;
        await retryLater(draft.id, RETRY_AFTER_FAILED_MS, result.errorMessage ?? "The email couldn't be sent.");
        break;
      case "already_handled":
        // A previous attempt already ended this message as failed / suppressed — it will never be re-sent, so don't
        // select it again every pass.
        summary.failed++;
        await retryLater(
          draft.id,
          RETRY_AFTER_HANDLED_MS,
          result.errorMessage ?? `A previous send attempt ended as "${result.messageStatus}".`
        );
        break;
      case "already_sent":
      case "in_progress":
        // Healed / mid-send by another pass — nothing to do.
        break;
    }

    // Daily cap reached: every further draft would be throttled too — stop here, try again next pass.
    if (result.status === "throttled") break;
  }

  return summary;
}

/**
 * One pass over every tenant with a due auto-send draft. For each, keeps taking batches while there is work, the daily
 * cap allows, and the pass budget lasts — so a bulk enroll of thousands is released as fast as the cap permits instead
 * of 50 drafts a minute. The module-level guard stops two passes overlapping inside this process; the idempotent
 * upsert in sendDraftViaEdgeX covers a second process.
 */
export async function runAutoSendSequenceSteps(budgetMs: number = PASS_BUDGET_MS): Promise<Record<string, AutoSendSummary>> {
  if (running) return {};
  running = true;
  const results: Record<string, AutoSendSummary> = {};
  const deadline = Date.now() + budgetMs;
  try {
    for (const tenantId of await findTenantsWithDueAutoSendDrafts()) {
      const total: AutoSendSummary = { ...EMPTY };
      try {
        while (Date.now() < deadline) {
          const batch = await processTenantAutoSendDrafts(tenantId);
          total.sent += batch.sent;
          total.throttled += batch.throttled;
          total.failed += batch.failed;
          total.skipped += batch.skipped;
          const handled = batch.sent + batch.failed + batch.skipped;
          // a short batch means the due list is drained; a throttled one means the cap is reached
          if (batch.throttled > 0 || handled < BATCH_SIZE) break;
        }
      } catch (err) {
        logger.error({ err, tenantId }, "sequence-autosend: tenant pass threw");
      }
      results[tenantId] = total;
      if (Date.now() >= deadline) break;
    }
  } finally {
    running = false;
  }
  return results;
}
