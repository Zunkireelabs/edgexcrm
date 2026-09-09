import { inngest } from "@/lib/inngest/client";
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

// Durable send worker for an email blast — OUTREACH-PHASE1-BRIEF.md §5/§6.
// The /api/v1/email-blasts/[id]/send route does only cheap, synchronous
// validation and then emits email/blast.send; THIS function is what
// re-resolves the audience, enforces the recipient cap, materializes every
// email_messages row (materializeBlastAudience, below), and is the ONLY
// thing that ever calls sendQueuedEmailBatch for a blast (no second send
// path). Moving materialization here (out of the HTTP request) is what makes
// "click Send, then leave the page" safe regardless of audience size — see
// materializeBlastAudience's own header comment for why. Mirrors
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

// Mirrors the identical constant that used to live in send/route.ts — a
// single unchunked upsert of a few thousand real-size HTML emails is tens of
// MB in one request and fails outright (observed live on a 3,114-row Admizz
// blast). 100 keeps each chunk small regardless of template/audience size.
const MATERIALIZE_CHUNK_SIZE = 100;

// Mirrors tenant_email_settings.max_recipients_per_blast's own DB default
// (migration 228) — used only if the settings row doesn't exist yet for this
// tenant (lazily created, same posture as tenant_sms_settings).
const DEFAULT_MAX_RECIPIENTS_PER_BLAST = 2000;

interface BlastContentRow {
  subject_template: string;
  body_template: string;
  from_name_override: string | null;
  audience_filter: FilterTree | null;
}

export type MaterializeAudienceOutcome = { ok: true; sendable: number; suppressed: number } | { ok: false; error: string };

// Everything that used to run synchronously inside send/route.ts's HTTP
// handler before it fired the Inngest event — re-resolve the audience,
// enforce the recipient cap, and materialize every email_messages row — now
// runs here instead, as a single step inside the durable worker. This is the
// piece of work that used to sit BEFORE the background handoff, in the exact
// window a client disconnecting (navigation, closed tab, proxy timeout)
// could interrupt; moving it to AFTER the handoff (this file) is what makes
// "click Send, then leave" safe regardless of audience size. Called from a
// single `step.run` in emailBlastSend below — its own internal DB writes
// (materializeInChunks) are already idempotent (ON CONFLICT DO NOTHING), so a
// step retry after a transient failure safely re-attempts only what didn't
// land, exactly as send/route.ts's version did.
//
// Re-resolves permissions via buildUserAuthContext(senderId) rather than
// trusting anything captured at click time — same "never trust a
// client-supplied count" posture the old route comment documented, just
// re-derived from a passed-in user id instead of a live session.
// `senderId` is send/route.ts's OWN authenticated auth.userId at click time
// (carried through event.data, NOT read back off blast.created_by): the
// person who actually clicks Send is not always who drafted the blast, and
// created_by is nullable — it's wiped to NULL if that original drafter's
// account is later deleted (ON DELETE SET NULL, migration 214). Resolving
// against created_by would silently re-scope (or outright fail) a send based
// on the wrong person's — or nobody's — permissions.
//
// Deliberately refuses (rather than silently under-resolving) when the
// sender's lead-visibility scope is restricted (own/branch) — see the
// matching comment in send/route.ts's synchronous pre-check for why: this
// function only has a service-role client available, and the RLS RPC that
// scope requires fails closed (zero rows) under one. send/route.ts already
// rejects that case instantly at click time, before ever emitting the event
// this function responds to — this is a second, defense-in-depth check, not
// the primary guard.
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
  // Unrestricted scope confirmed above, so the own/branch RLS-RPC branch of
  // resolveAudience can never actually be reached — passing the service
  // client for both `user` and `service` is safe here (see this function's
  // header comment for why a real RLS client isn't available at all).
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

  // tenants has no tenant_id column (it IS the tenant) — see the identical
  // comment in the /preview route.
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
  if (!materializeResult.ok) {
    return {
      ok: false,
      error: `failed to materialize recipient rows at chunk ${materializeResult.failedChunkIndex}: ${materializeResult.error?.message}`,
    };
  }

  await db
    .from("email_blasts")
    .update({ recipients_total: audience.sendable.length + audience.suppressed.length, recipients_suppressed: audience.suppressed.length })
    .eq("id", blastId)
    .neq("status", "cancelled");

  return { ok: true, sendable: audience.sendable.length, suppressed: audience.suppressed.length };
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
    // senderId: the auth.userId who actually clicked Send (send/route.ts),
    // carried through here rather than re-derived from blast.created_by — see
    // materializeBlastAudience's header comment for why. Only present on a
    // fresh event; a resumed/re-emitted run (throttle cycle) doesn't need it,
    // since materialize only ever runs once, on the first 'queued' pass.
    const { tenantId, blastId, senderId } = event.data as { tenantId: string; blastId: string; senderId?: string };

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
      //
      // F5 follow-up (docs/BLAST-FINDINGS-2026-09-06.md): /cancel only flips
      // 'queued' rows to 'cancelled' — it never touches a row that happened
      // to be 'sending' at that exact moment (e.g. left behind by an earlier
      // crashed run of THIS blast). Without this reclaim pass, that row
      // would never be revisited, on a blast that will never run this loop
      // again. finalizeEmailBlast's wasCancelled branch always wins over the
      // unaccounted-for check, so the blast correctly stays 'cancelled'
      // either way — this just gives that stray row a real chance to
      // resolve first, instead of leaving it orphaned forever.
      const strandedIds = await step.run("load-stranded-sending-precancelled", () => loadStrandedSendingIds(tenantId, blastId));
      if (strandedIds.length > 0) {
        await step.run("reclaim-stranded-precancelled", () => sendQueuedEmailBatch(tenantId, strandedIds, { capCaller: "blast" }));
        logger.info(
          { tenantId, blastId, strandedCount: strandedIds.length },
          "[email-blast-send] reclaimed row(s) stranded in 'sending' on an already-cancelled blast"
        );
      }

      const outcome = await step.run("finalize-precancelled", () => finalizeEmailBlast(tenantId, blastId));
      return { blastId, ...outcome };
    }

    // Materialize the audience — ONLY on this blast's first run. A fresh run
    // can observe the row as EITHER 'draft' or 'queued' here, depending on
    // which of send/route.ts's own two writes (inngest.send(), then its
    // status update to 'queued') this step's read happened to race against —
    // there is no atomicity between them, so neither order is guaranteed.
    // Both states mean the same thing: this is a fresh send, not a resume.
    // A resumed run after a throttle cycle re-enters here with status
    // 'throttled' (set by mark-throttled below, before the resume event is
    // ever re-emitted) and must NOT re-resolve/re-materialize: the audience
    // was already snapshotted on the first run, and re-running this every
    // cycle would waste a full audience resolution and risk silently growing
    // recipients_total if new leads started matching the filter in between
    // cycles — the loop below only ever sends rows already materialized as
    // 'queued', by design. See the confirm-queued step below for how the row
    // is normalized to 'queued' before mark-sending runs, regardless of
    // which of 'draft'/'queued' was observed here.
    if (blast.status === "queued" || blast.status === "draft") {
      // senderId is always present on the fresh event that sets 'queued'
      // (send/route.ts always includes it) — this guard exists only so a
      // malformed/hand-fired event fails loudly as a real error instead of
      // materializeBlastAudience crashing on an undefined userId.
      if (!senderId) {
        await step.run("mark-failed-no-sender", async () => {
          const db = await scopedClientForTenant(tenantId);
          await db
            .from("email_blasts")
            .update({ status: "failed", recipients_total: 0, completed_at: new Date().toISOString() })
            .eq("id", blastId)
            .neq("status", "cancelled");
        });
        logger.error({ tenantId, blastId }, "[email-blast-send] event carried no senderId — blast marked failed");
        return { blastId, failed: true, reason: "event carried no senderId" };
      }

      const materializeOutcome = await step.run("materialize-audience", () => materializeBlastAudience(tenantId, blastId, senderId));
      if (!materializeOutcome.ok) {
        // .neq("status", "cancelled") (not a blanket update) so a /cancel
        // that raced this step and already flipped the blast to 'cancelled'
        // is never overwritten back to 'failed' — same F-1 invariant
        // finalizeEmailBlast enforces elsewhere in this file. Not
        // .eq("status","queued"): the row here can legitimately still be
        // 'draft' (see comment above), so a queued-only filter would
        // silently no-op and leave the blast stuck instead of marking it
        // failed.
        await step.run("mark-failed-no-audience", async () => {
          const db = await scopedClientForTenant(tenantId);
          await db
            .from("email_blasts")
            .update({ status: "failed", recipients_total: 0, completed_at: new Date().toISOString() })
            .eq("id", blastId)
            .neq("status", "cancelled");
        });
        logger.error({ tenantId, blastId, error: materializeOutcome.error }, "[email-blast-send] failed to materialize audience — blast marked failed");
        return { blastId, failed: true, reason: materializeOutcome.error };
      }

      // Race guard: send/route.ts flips the blast to 'queued' (making
      // "Cancel blast" clickable) BEFORE this step runs, not after — unlike
      // the old synchronous-materialize design, a user can now click Cancel
      // while materialization is still in flight. /cancel only flips
      // email_messages rows that are ALREADY 'queued' at the moment it runs
      // (see cancel/route.ts) — rows this step is about to write don't exist
      // yet at that moment, so /cancel can't see or cancel them, and the send
      // loop below would otherwise happily send them anyway. Re-checking here
      // and reclaiming any such rows closes that window.
      const stillQueued = await step.run("check-not-cancelled-post-materialize", async () => {
        const db = await scopedClientForTenant(tenantId);
        const { data } = await db.from("email_blasts").select("status").eq("id", blastId).maybeSingle();
        return (data as { status?: string } | null)?.status !== "cancelled";
      });
      if (!stillQueued) {
        await step.run("cancel-post-materialize-rows", async () => {
          const db = await scopedClientForTenant(tenantId);
          await db.from("email_messages").update({ status: "cancelled" }).eq("source", "blast").eq("source_id", blastId).eq("status", "queued");
        });
        const outcome = await step.run("finalize-post-materialize-cancel", () => finalizeEmailBlast(tenantId, blastId));
        return { blastId, ...outcome };
      }

      // If load-blast (this run's very first step, above) raced ahead of
      // send/route.ts's own status-flip and observed 'draft' instead of
      // 'queued', normalize the row to 'queued' now — before mark-sending
      // below, whose .in(["queued","throttled"]) filter assumes the row is
      // never still 'draft' at that point. No-op (skipped entirely) when
      // send/route.ts already won that race and the row was already
      // 'queued' at load-blast time — the common case pays nothing extra.
      if (blast.status === "draft") {
        await step.run("confirm-queued", async () => {
          const db = await scopedClientForTenant(tenantId);
          await db
            .from("email_blasts")
            .update({ status: "queued", started_at: new Date().toISOString() })
            .eq("id", blastId)
            .eq("status", "draft");
        });
      }
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
        await step.run(`re-emit-${batchIndex}`, () => inngest.send({ name: "email/blast.send", data: { tenantId, blastId, senderId } }));

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
