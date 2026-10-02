import { inngest } from "@/lib/inngest/client";
import { createServiceClient } from "@/lib/supabase/server";
import { scopedClientForTenant } from "@/lib/supabase/scoped";
import { sendDraftViaEdgeX } from "@/industries/_shared/features/outreach/lib/send-draft";
import { logger } from "@/lib/logger";

// Durable auto-send worker for Outreach drip sequences — OUTREACH-PHASE2-BRIEF.md
// §5. Cross-tenant cron scan (mirrors reminders.ts's shape), NOT an
// event-triggered per-tenant worker like blast-runner.ts — a sequence
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
// drip claims first. blast-runner.ts passes { capCaller: "blast" },
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
    const result = await sendDraftViaEdgeX(db, tenantId, draft);

    switch (result.status) {
      case "sent":
        sent++;
        break;
      case "no_email":
        skipped++;
        break;
      case "throttled":
        // §5.5 — daily cap hit: draft stays 'pending', never marked sent or
        // dropped. The due-draft bell (runOutreachDraftReminders) already
        // flags this as "due" — no new code needed there.
        throttled++;
        break;
      case "failed":
        // Failed or suppressed — the underlying email_messages row carries the
        // reason. Draft stays 'pending'; a human resolves via the cadence
        // timeline's existing skip action. Known gap: a permanently-failing
        // address stays pending forever rather than auto-skipping — flagged
        // in the phase report, not fixed here.
        failed++;
        break;
      case "already_sent":
      case "already_handled":
      case "in_progress":
        // Already sent/failed/suppressed by a previous run — nothing to do.
        break;
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
