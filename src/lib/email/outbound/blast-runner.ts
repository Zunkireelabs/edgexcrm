import { scopedClientForTenant } from "@/lib/supabase/scoped";
import { createServiceClient } from "@/lib/supabase/server";
import { fetchAllRows, type PageResult } from "@/lib/supabase/paginate";
import { sendQueuedEmailBatch } from "@/lib/email/outbound/send";
import { buildUserAuthContext } from "@/lib/api/auth";
import { leadQueryScope } from "@/lib/api/permissions";
import { POSITION_ROUTE_MAP } from "@/industries/education-consultancy/features/new-leads-triage/position-routing";
import { resolveAudience, type AudienceRow } from "@/lib/email/outbound/audience";
import { composeRecipientEmail } from "@/lib/email/outbound/compose";
import { materializeInChunks } from "@/lib/outbound/materialize-chunks";
import { EMPTY_TREE, type FilterTree } from "@/lib/filters/types";
import { logger } from "@/lib/logger";

// Non-Inngest replacement for the old email-blast-send.ts Inngest function —
// migrated 2026-09-28 after the Zunkiree Labs Inngest account exceeded its
// Hobby-tier 50,000 executions/month cap (shared across every Inngest job in
// both staging and production), which silently blocked email-blast-send from
// ever running (blasts finalized 'failed' with zero recipients materialized
// because the function's first step never got to execute at all). See
// docs/SESSION-LOG.md's 2026-09-28 entry for the incident.
//
// Everything below except the orchestration shape is carried over unchanged
// from email-blast-send.ts — materializeBlastAudience, finalizeEmailBlast,
// computeBlastCounts, the batch-send loop, stranded-row reclaim, the daily-cap
// throttle handling, and every comment documenting why each piece of that
// logic exists (F1/F3/F4/F5/F6, docs/BLAST-FINDINGS-2026-09-06.md) still
// applies verbatim — only Inngest's step.run/step.sleep/step.sleepUntil
// wrapping and the durable event-based resume are gone, replaced by a plain
// async function driven by an in-process timer (src/instrumentation.ts) that
// re-invokes it every ~30s. The app runs as a single long-lived Node process
// per environment (Docker container, not serverless), so this doesn't need
// Inngest's distributed durability guarantees to be safe — DB row status is
// the only state that matters, and it survives a process restart exactly as
// it did before (the stranded-row reclaim logic already assumed a worker
// could crash mid-batch; a restarted process just picks it back up).
//
// senderId handling: send/route.ts fires an immediate, guaranteed-to-run
// background call to processOneBlast() via Next's after() the instant it
// flips a blast to 'queued' — after() keeps running even if the client
// disconnects, which is what makes "click Send, then leave the page" safe
// regardless of audience size (the same guarantee Inngest's event handoff
// used to provide). senderId is only available on that immediate call (it's
// the person who clicked Send, not anything stored on the blast row — see
// materializeBlastAudience's own comment for why it's never read back off
// created_by). The periodic cross-tenant scan (runEmailBlastQueue) has no
// senderId, so it never attempts a fresh materialize itself — it only
// resumes blasts already past that point (sending/throttled, or queued with
// recipients_total already set). If a blast is still 'queued' with
// recipients_total null well past when it was queued, that means the
// immediate after() call never completed (the only realistic cause: the
// whole server process crashed in that narrow window) — the periodic scan
// marks it failed with a clear reason after a grace period, exactly as
// visibly as any other failure, rather than leaving it silently stuck
// forever with no explanation.

const MAX_RECIPIENTS_PER_CALL = 100;
const MATERIALIZE_STUCK_GRACE_MS = 5 * 60 * 1000;
const BETWEEN_BATCH_PACE_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface BlastRow {
  id: string;
  tenant_id: string;
  scheduled_for: string | null;
  status: string;
  recipients_total: number | null;
  started_at: string | null;
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
// ever selects 'queued', so once the main loop runs out of queued rows it has
// no way to notice a stranded 'sending' row exists at all. Feed whatever's
// here back into sendQueuedEmailBatch, which already knows how to safely
// reclaim-or-permanently-fail a stranded row (§5.2 in send.ts).
// email_blasts.recipients_total is NOT NULL DEFAULT 0 (migration 214) — it is
// never actually null, so "has materialize run yet" can't be read off it.
// email_messages existing for this blast is the real signal (and what
// materializeBlastAudience itself writes to, idempotently).
async function hasMaterializedRows(tenantId: string, blastId: string): Promise<boolean> {
  const db = await scopedClientForTenant(tenantId);
  const { data } = await db.from("email_messages").select("id").eq("source", "blast").eq("source_id", blastId).limit(1);
  return (data ?? []).length > 0;
}

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

interface BlastStatusRow {
  status: string;
}

interface BlastCounts {
  sent: number;
  failed: number;
  cancelled: number;
  suppressed: number;
  total: number;
}

// Live counts straight off email_messages — the source of truth. Shared by
// the throttle branch and finalize so a blast's recipients_* columns never
// lag what the per-row recipient table shows mid-flight.
export async function computeBlastCounts(tenantId: string, blastId: string): Promise<BlastCounts> {
  const db = await scopedClientForTenant(tenantId);
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
// cancelled must NEVER be transitioned out of 'cancelled'. Rows left
// 'cancelled' by /cancel are counted separately from 'failed'.
export async function finalizeEmailBlast(
  tenantId: string,
  blastId: string
): Promise<{ finalStatus: string; sent: number; failed: number; cancelled: number; suppressed: number }> {
  const db = await scopedClientForTenant(tenantId);

  const { data: currentBlast } = await db.from("email_blasts").select("status").eq("id", blastId).maybeSingle();
  const wasCancelled = (currentBlast as unknown as BlastStatusRow | null)?.status === "cancelled";

  const { sent, failed, cancelled, suppressed, total } = await computeBlastCounts(tenantId, blastId);
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

const MATERIALIZE_CHUNK_SIZE = 100;
const DEFAULT_MAX_RECIPIENTS_PER_BLAST = 2000;

interface BlastContentRow {
  subject_template: string;
  body_template: string;
  from_name_override: string | null;
  audience_filter: FilterTree | null;
}

export type MaterializeAudienceOutcome = { ok: true; sendable: number; suppressed: number } | { ok: false; error: string };

// Re-resolves the audience, enforces the recipient cap, and materializes every
// email_messages row. Its own internal DB writes (materializeInChunks) are
// idempotent (ON CONFLICT DO NOTHING), so calling this twice on the same
// blast is safe and re-attempts only what didn't land.
export async function materializeBlastAudience(tenantId: string, blastId: string, senderId: string): Promise<MaterializeAudienceOutcome> {
  const db = await scopedClientForTenant(tenantId);

  const { data: blastData } = await db
    .from("email_blasts")
    .select("subject_template, body_template, from_name_override, audience_filter")
    .eq("id", blastId)
    .maybeSingle();
  const blast = blastData as unknown as BlastContentRow | null;
  if (!blast) return { ok: false, error: "blast not found at materialize time" };

  const auth = await buildUserAuthContext(senderId, tenantId);
  if (!auth) return { ok: false, error: "could not resolve the sender's permissions for this tenant" };

  const poolSlug =
    auth.industryId === "education_consultancy" && auth.positionSlug && auth.branchId
      ? (POSITION_ROUTE_MAP[auth.positionSlug] ?? null)
      : null;
  const scope = leadQueryScope(auth.permissions, auth.userId, auth.branchId, poolSlug);
  if (scope.restrictToSelf || scope.branchId) {
    return { ok: false, error: "sender has a restricted lead-visibility scope — cannot safely resolve audience in the background" };
  }

  const service = await createServiceClient();
  const audienceResult = await resolveAudience(auth, blast.audience_filter ?? EMPTY_TREE, { user: service, service, db });
  if (!audienceResult.ok) {
    return { ok: false, error: `audience filter is no longer valid: ${JSON.stringify(audienceResult.errors)}` };
  }
  const { audience } = audienceResult;

  if (audience.sendable.length === 0 && audience.suppressed.length === 0) {
    return { ok: false, error: "no sendable recipients matched this blast's audience filter" };
  }

  const { data: settingsRow } = await db.from("tenant_email_settings").select("max_recipients_per_blast").maybeSingle();
  const maxRecipientsPerBlast =
    (settingsRow as { max_recipients_per_blast?: number } | null)?.max_recipients_per_blast ?? DEFAULT_MAX_RECIPIENTS_PER_BLAST;
  if (audience.sendable.length > maxRecipientsPerBlast) {
    return {
      ok: false,
      error: `audience (${audience.sendable.length}) exceeds the ${maxRecipientsPerBlast}-recipient cap for this tenant`,
    };
  }

  const { data: tenantRow } = await db.raw().from("tenants").select("name").eq("id", tenantId).maybeSingle();
  const tenantName = (tenantRow as { name?: string } | null)?.name;

  function toRow(row: AudienceRow, status: "queued" | "suppressed") {
    const composed = composeRecipientEmail(blast!.subject_template, blast!.body_template, row.lead, tenantName);
    return {
      lead_id: row.leadId,
      source: "blast" as const,
      source_id: blastId,
      to_email: row.email,
      to_email_stored: row.lead.email != null ? String(row.lead.email) : null,
      subject: composed.subject,
      body_html: composed.bodyHtml,
      status,
    };
  }

  const newRows = [...audience.sendable.map((r) => toRow(r, "queued")), ...audience.suppressed.map((r) => toRow(r, "suppressed"))];

  const materializeResult = await materializeInChunks(
    newRows,
    async (chunk) => db.from("email_messages").upsert(chunk, { onConflict: "source_id,lead_id", ignoreDuplicates: true }),
    { chunkSize: MATERIALIZE_CHUNK_SIZE }
  );

  // BUG FIX (2026-09-24 prod incident) — a single failed chunk after N earlier
  // successful ones still leaves N*chunkSize real rows committed. Only report
  // ok:false when NOTHING committed (chunk 0 itself failed); otherwise proceed
  // with what did materialize instead of orphaning it under a false 'failed'.
  if (!materializeResult.ok && materializeResult.failedChunkIndex === 0) {
    return {
      ok: false,
      error: `failed to materialize recipient rows at chunk ${materializeResult.failedChunkIndex}: ${materializeResult.error?.message}`,
    };
  }

  if (!materializeResult.ok) {
    logger.error(
      {
        tenantId,
        blastId,
        failedChunkIndex: materializeResult.failedChunkIndex,
        intendedRows: newRows.length,
        error: materializeResult.error,
      },
      "[materializeBlastAudience] partial materialize failure — proceeding with the rows that already committed instead of orphaning them under a false 'failed'"
    );
  }

  const committedRows = await fetchAllRows<{ status: string }>((offset, limit) =>
    db
      .from("email_messages")
      .select("status")
      .eq("source", "blast")
      .eq("source_id", blastId)
      .order("id", { ascending: true })
      .range(offset, offset + limit - 1) as unknown as Promise<PageResult<{ status: string }>>
  );
  const committedSendable = committedRows.filter((r) => r.status !== "suppressed").length;
  const committedSuppressed = committedRows.filter((r) => r.status === "suppressed").length;

  await db
    .from("email_blasts")
    .update({ recipients_total: committedSendable + committedSuppressed, recipients_suppressed: committedSuppressed })
    .eq("id", blastId)
    .neq("status", "cancelled");

  return { ok: true, sendable: committedSendable, suppressed: committedSuppressed };
}

export interface ProcessOneBlastOutcome {
  blastId: string;
  skipped?: boolean;
  parked?: boolean;
  failed?: boolean | number;
  throttled?: boolean;
  reason?: string;
  finalStatus?: string;
  sent?: number;
  cancelled?: number;
  suppressed?: number;
}

// The plain-async replacement for email-blast-send.ts's Inngest handler body.
// Drives one blast from wherever it currently is to its next pause point
// (materialized-and-parked-for-schedule / throttled / terminal). Safe to call
// repeatedly and concurrently-in-sequence on the same blast — every write is
// idempotent or status-guarded exactly as it was under Inngest.
//
// senderId is only ever present on the immediate post-Send call from
// send/route.ts (via after()) — see this file's header comment. The periodic
// cross-tenant scan never passes one.
export async function processOneBlast(tenantId: string, blastId: string, senderId?: string): Promise<ProcessOneBlastOutcome> {
  const db = await scopedClientForTenant(tenantId);

  const { data } = await db
    .from("email_blasts")
    .select("id, scheduled_for, status, recipients_total, started_at")
    .eq("id", blastId)
    .maybeSingle();
  const blast = data as unknown as (Omit<BlastRow, "tenant_id"> & { tenant_id?: string }) | null;
  if (!blast) return { blastId, skipped: true, reason: "blast not found" };

  if (blast.status === "cancelled") {
    const strandedIds = await loadStrandedSendingIds(tenantId, blastId);
    if (strandedIds.length > 0) {
      await sendQueuedEmailBatch(tenantId, strandedIds, { capCaller: "blast" });
      logger.info({ tenantId, blastId, strandedCount: strandedIds.length }, "[blast-runner] reclaimed row(s) stranded in 'sending' on an already-cancelled blast");
    }
    const outcome = await finalizeEmailBlast(tenantId, blastId);
    return { blastId, ...outcome };
  }

  if (!["queued", "sending", "throttled"].includes(blast.status)) {
    return { blastId, skipped: true, reason: `status '${blast.status}' is not ours to process` };
  }

  // Fresh blast, not yet materialized.
  if (blast.status === "queued" && !(await hasMaterializedRows(tenantId, blastId))) {
    if (!senderId) {
      // No sender identity available (this is the periodic scan, not the
      // immediate post-Send call) — only the immediate call can safely
      // resolve and materialize an audience. Give it a grace period; if the
      // blast is still un-materialized well past that, the immediate call
      // never completed (realistically: a server crash in that narrow
      // window) — surface it loudly instead of leaving it silently stuck.
      const queuedAtMs = blast.started_at ? new Date(blast.started_at).getTime() : 0;
      if (Date.now() - queuedAtMs < MATERIALIZE_STUCK_GRACE_MS) {
        return { blastId, skipped: true, reason: "awaiting materialize from the immediate post-send call" };
      }
      await db
        .from("email_blasts")
        .update({ status: "failed", recipients_total: 0, completed_at: new Date().toISOString() })
        .eq("id", blastId)
        .neq("status", "cancelled");
      logger.error({ tenantId, blastId }, "[blast-runner] blast never materialized within the grace period — marked failed");
      return { blastId, failed: true, reason: "materialize never completed" };
    }

    const materializeOutcome = await materializeBlastAudience(tenantId, blastId, senderId);
    if (!materializeOutcome.ok) {
      await db
        .from("email_blasts")
        .update({ status: "failed", recipients_total: 0, completed_at: new Date().toISOString() })
        .eq("id", blastId)
        .neq("status", "cancelled");
      logger.error({ tenantId, blastId, error: materializeOutcome.error }, "[blast-runner] failed to materialize audience — blast marked failed");
      return { blastId, failed: true, reason: materializeOutcome.error };
    }

    // Race guard: a /cancel call can land while materialize was in flight.
    // /cancel only flips rows already 'queued' at the moment it runs, so rows
    // just written above wouldn't have been touched by it — reclaim them here.
    const { data: postMaterializeBlast } = await db.from("email_blasts").select("status").eq("id", blastId).maybeSingle();
    if ((postMaterializeBlast as { status?: string } | null)?.status === "cancelled") {
      await db.from("email_messages").update({ status: "cancelled" }).eq("source", "blast").eq("source_id", blastId).eq("status", "queued");
      const outcome = await finalizeEmailBlast(tenantId, blastId);
      return { blastId, ...outcome };
    }
  }

  // Scheduled send: not due yet — leave it queued/materialized, re-check on
  // the next tick instead of blocking this one.
  if (blast.scheduled_for && new Date(blast.scheduled_for).getTime() > Date.now()) {
    return { blastId, parked: true, reason: "scheduled for later" };
  }

  await db.from("email_blasts").update({ status: "sending" }).eq("id", blastId).in("status", ["queued", "throttled"]);

  let totalSent = 0;
  let totalFailed = 0;
  let totalSuppressed = 0;

  for (;;) {
    const ids = await loadBatchIds(tenantId, blastId);
    if (ids.length === 0) break;

    const result = await sendQueuedEmailBatch(tenantId, ids, { capCaller: "blast" });
    totalSent += result.sent;
    totalFailed += result.failed;
    totalSuppressed += result.suppressed;

    // §6: hitting the daily cap is a first-class state, not a stop reason.
    // Remaining rows stay 'queued'; mark 'throttled' and stop this tick — the
    // next timer tick after the cap resets (UTC midnight) naturally resumes,
    // since the periodic scan's query includes 'throttled'.
    if (result.throttled > 0) {
      const counts = await computeBlastCounts(tenantId, blastId);
      await db
        .from("email_blasts")
        .update({ status: "throttled", recipients_sent: counts.sent, recipients_failed: counts.failed, recipients_suppressed: counts.suppressed })
        .eq("id", blastId)
        .neq("status", "cancelled");

      const { data: cancelCheck } = await db.from("email_blasts").select("status").eq("id", blastId).maybeSingle();
      if ((cancelCheck as unknown as BlastStatusRow | null)?.status === "cancelled") break;

      logger.info(
        { tenantId, blastId, sent: totalSent, failed: totalFailed, suppressed: totalSuppressed },
        "[blast-runner] daily cap reached — throttled, will resume after reset"
      );
      return { blastId, throttled: true, reason: "daily cap reached", sent: totalSent, failed: totalFailed, suppressed: totalSuppressed };
    }

    if (ids.length === MAX_RECIPIENTS_PER_CALL) {
      await sleep(BETWEEN_BATCH_PACE_MS);
    }
  }

  const strandedIds = await loadStrandedSendingIds(tenantId, blastId);
  if (strandedIds.length > 0) {
    const reclaimResult = await sendQueuedEmailBatch(tenantId, strandedIds, { capCaller: "blast" });
    totalSent += reclaimResult.sent;
    totalFailed += reclaimResult.failed;
    totalSuppressed += reclaimResult.suppressed;
    logger.info({ tenantId, blastId, strandedCount: strandedIds.length, reclaimed: reclaimResult }, "[blast-runner] reclaimed row(s) stranded in 'sending' from a prior crashed run");
  }

  const outcome = await finalizeEmailBlast(tenantId, blastId);
  return { blastId, ...outcome };
}

interface DiscoveredBlastRow {
  id: string;
  tenant_id: string;
}

// In-process guard against overlapping ticks working the same blast twice —
// the plain-process replacement for Inngest's
// concurrency: [{ key: "event.data.tenantId", limit: 1 }]. Sufficient because
// the app runs as a single Node process per environment (same assumption
// already relied on by rate-limit.ts's in-process Resend limiter).
const inFlightBlastIds = new Set<string>();

// Called on a ~30s interval by src/instrumentation.ts. Cross-tenant scan for
// any blast that needs work right now — freshly queued, mid-send, or
// throttled-and-maybe-past-reset. Never passes a senderId (see
// processOneBlast's header comment) — a freshly queued, never-materialized
// blast is handled by the immediate post-Send call instead, with this scan
// as the loud-failure safety net if that call never completed.
export async function runEmailBlastQueue(): Promise<{ processed: number }> {
  const service = await createServiceClient();
  const { data, error } = await service
    .from("email_blasts")
    .select("id, tenant_id")
    .in("status", ["queued", "sending", "throttled"]);

  if (error) {
    logger.error({ err: error }, "[blast-runner] failed to scan for blasts needing work");
    return { processed: 0 };
  }

  const rows = (data ?? []) as unknown as DiscoveredBlastRow[];
  let processed = 0;

  for (const row of rows) {
    if (inFlightBlastIds.has(row.id)) continue;
    inFlightBlastIds.add(row.id);
    try {
      await processOneBlast(row.tenant_id, row.id);
      processed += 1;
    } catch (err) {
      logger.error({ err, tenantId: row.tenant_id, blastId: row.id }, "[blast-runner] processOneBlast threw during periodic scan");
    } finally {
      inFlightBlastIds.delete(row.id);
    }
  }

  return { processed };
}
