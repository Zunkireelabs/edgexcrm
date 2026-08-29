import { inngest } from "@/lib/inngest/client";
import { createServiceClient } from "@/lib/supabase/server";
import { scopedClientForTenant } from "@/lib/supabase/scoped";
import { sendQueuedEmailBatch } from "@/lib/email/outbound/send";
import { normalizeEmail } from "@/lib/email/outbound/suppression";
import { markDraftSentViaEdgeX } from "@/industries/_shared/features/outreach/lib/engine";
import { logger } from "@/lib/logger";

// Durable auto-send worker for Outreach drip sequences — OUTREACH-PHASE2-BRIEF.md
// §5. Cross-tenant cron scan (mirrors reminders.ts's shape), NOT an
// event-triggered per-tenant worker like email-blast-send.ts — a sequence
// step has no "materialize + emit" call site to hang an event off; due_at
// itself is the trigger, so a scan has to find "what just became due."
//
// it_agency's sequences (email_sequences.auto_send defaults to false) are
// structurally unreachable here: every query below is scoped to
// `auto_send = true`, so a manual-copy sequence's steps are never touched by
// this file — verified by a regression test in sequence-step-send.test.ts.
//
// Cap priority (§3.1/§5.3): sendQueuedEmailBatch is called here with NO
// capCaller option, which means the full daily-cap remaining is visible —
// drip claims first. email-blast-send.ts passes { capCaller: "blast" },
// which reserves headroom for whatever this file still has due today. See
// cap.ts's GetDailyCapStatusOptions doc for the full mechanism.

const MAX_DUE_PER_TENANT_PER_RUN = 50;

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
}

interface LeadEmailRow {
  email: string | null;
}

interface EmailMessageIdRow {
  id: string;
  status: string;
}

// Three plain sequential queries rather than a doubly-nested PostgREST embed
// filter (email_sequences -> sequence_enrollments -> sequence_step_drafts) —
// keeps this scan on the same simple `.in()` pattern the rest of the
// codebase uses, with no dependency on multi-level embedded-filter syntax.
async function findTenantsWithDueAutoSendDrafts(): Promise<string[]> {
  const supabase = await createServiceClient();
  const nowIso = new Date().toISOString();

  const { data: autoSendSeqs, error: seqErr } = await supabase.from("email_sequences").select("id").eq("auto_send", true);
  if (seqErr) {
    logger.error({ err: seqErr }, "sequence-step-send: failed to load auto-send sequences");
    throw seqErr;
  }
  const sequenceIds = ((autoSendSeqs ?? []) as unknown as IdRow[]).map((s) => s.id);
  if (sequenceIds.length === 0) return [];

  const { data: enrollments, error: enrollErr } = await supabase
    .from("sequence_enrollments")
    .select("id")
    .in("sequence_id", sequenceIds)
    .eq("status", "active");
  if (enrollErr) {
    logger.error({ err: enrollErr }, "sequence-step-send: failed to load active enrollments");
    throw enrollErr;
  }
  const enrollmentIds = ((enrollments ?? []) as unknown as IdRow[]).map((e) => e.id);
  if (enrollmentIds.length === 0) return [];

  const { data: dueDrafts, error: draftErr } = await supabase
    .from("sequence_step_drafts")
    .select("tenant_id")
    .eq("status", "pending")
    .lte("due_at", nowIso)
    .in("enrollment_id", enrollmentIds)
    .limit(2000);
  if (draftErr) {
    logger.error({ err: draftErr }, "sequence-step-send: failed to scan for due auto-send drafts");
    throw draftErr;
  }

  const tenantIds = new Set<string>();
  for (const row of (dueDrafts ?? []) as unknown as TenantIdRow[]) tenantIds.add(row.tenant_id);
  return [...tenantIds];
}

export async function processTenantAutoSendDrafts(
  tenantId: string
): Promise<{ sent: number; throttled: number; failed: number; skipped: number }> {
  const db = await scopedClientForTenant(tenantId);
  const nowIso = new Date().toISOString();

  const { data: autoSendSeqs } = await db.from("email_sequences").select("id").eq("auto_send", true);
  const sequenceIds = ((autoSendSeqs ?? []) as unknown as IdRow[]).map((s) => s.id);
  if (sequenceIds.length === 0) return { sent: 0, throttled: 0, failed: 0, skipped: 0 };

  const { data: enrollments } = await db
    .from("sequence_enrollments")
    .select("id")
    .in("sequence_id", sequenceIds)
    .eq("status", "active");
  const enrollmentIds = ((enrollments ?? []) as unknown as IdRow[]).map((e) => e.id);
  if (enrollmentIds.length === 0) return { sent: 0, throttled: 0, failed: 0, skipped: 0 };

  const { data: dueDrafts, error: draftErr } = await db
    .from("sequence_step_drafts")
    .select("id, lead_id, subject, body_html")
    .eq("status", "pending")
    .lte("due_at", nowIso)
    .in("enrollment_id", enrollmentIds)
    .order("due_at", { ascending: true })
    .limit(MAX_DUE_PER_TENANT_PER_RUN);

  if (draftErr) {
    logger.error({ err: draftErr, tenantId }, "sequence-step-send: failed to load due drafts");
    throw draftErr;
  }

  let sent = 0;
  let throttled = 0;
  let failed = 0;
  let skipped = 0;

  for (const draft of (dueDrafts ?? []) as unknown as DueDraftRow[]) {
    const { data: leadRow } = await db.from("leads").select("email").eq("id", draft.lead_id).maybeSingle();
    const email = (leadRow as LeadEmailRow | null)?.email;
    if (!email) {
      logger.warn({ tenantId, draftId: draft.id }, "sequence-step-send: lead has no email — leaving draft pending");
      skipped++;
      continue;
    }

    // Idempotent materialization — mirrors the blast /send route's upsert
    // convention exactly: (source_id, lead_id) unique, ignoreDuplicates makes
    // a re-scanned draft (e.g. after a mid-cycle crash) a safe no-op. Draft
    // content is already fully rendered by createDraftForStep at
    // enrollment/advance time — no template re-render needed here.
    const { error: upsertError } = await db.from("email_messages").upsert(
      {
        lead_id: draft.lead_id,
        source: "sequence",
        source_id: draft.id,
        to_email: normalizeEmail(email),
        to_email_stored: email,
        subject: draft.subject,
        body_html: draft.body_html,
        status: "queued",
      },
      { onConflict: "source_id,lead_id", ignoreDuplicates: true }
    );
    if (upsertError) {
      logger.error({ err: upsertError, tenantId, draftId: draft.id }, "sequence-step-send: failed to materialize email_messages row");
      failed++;
      continue;
    }

    const { data: messageRow } = await db
      .from("email_messages")
      .select("id, status")
      .eq("source_id", draft.id)
      .eq("lead_id", draft.lead_id)
      .maybeSingle();
    const message = messageRow as EmailMessageIdRow | null;
    if (!message) {
      logger.error({ tenantId, draftId: draft.id }, "sequence-step-send: email_messages row missing right after upsert");
      failed++;
      continue;
    }
    if (message.status !== "queued" && message.status !== "sending") {
      // Already sent/failed/suppressed by a previous run — nothing to do.
      continue;
    }

    const result = await sendQueuedEmailBatch(tenantId, [message.id]);

    if (result.sent === 1) {
      await markDraftSentViaEdgeX(db, tenantId, draft.id, message.id);
      sent++;
    } else if (result.throttled === 1) {
      // §5.5 — daily cap hit: draft stays 'pending', never marked sent or
      // dropped. The due-draft bell (runOutreachDraftReminders) already
      // flags this as "due" — no new code needed there.
      throttled++;
    } else {
      // Failed or suppressed — the underlying email_messages row carries the
      // reason. Draft stays 'pending'; a human resolves via the cadence
      // timeline's existing skip action. Known gap: a permanently-failing
      // address stays pending forever rather than auto-skipping — flagged
      // in the phase report, not fixed here.
      failed++;
    }
  }

  return { sent, throttled, failed, skipped };
}

export const sequenceStepSend = inngest.createFunction(
  { id: "sequence-step-send", triggers: [{ cron: "*/15 * * * *" }] },
  async ({ step }) => {
    const tenantIds = await step.run("find-due-tenants", findTenantsWithDueAutoSendDrafts);

    const results: Record<string, { sent: number; throttled: number; failed: number; skipped: number }> = {};
    for (const tenantId of tenantIds) {
      results[tenantId] = await step.run(`process-tenant-${tenantId}`, () => processTenantAutoSendDrafts(tenantId));
    }

    return { tenantsProcessed: tenantIds.length, results };
  }
);
