import { inngest } from "@/lib/inngest/client";
import { createServiceClient } from "@/lib/supabase/server";
import { scopedClientForTenant } from "@/lib/supabase/scoped";
import { getSmsProvider } from "@/lib/sms/provider";
import { matchDeliveryReports, type CandidateMessage } from "@/lib/sms/delivery-match";
import { isSmsEnabled } from "@/lib/sms/flag";
import { logger } from "@/lib/logger";

// Durable delivery-receipt poller — docs/SMS-PHASE4-BRIEF.md item 1. Aakash
// gives no webhook; POST /sms/v4/api-report is poll-only and its rows carry
// no join key back to our send-response ids, so this is a thin caller around
// the pure matchDeliveryReports() (delivery-match.ts) — all the "which
// candidate does this report row belong to" logic lives there and is unit
// tested without a DB.
//
// Aakash's report endpoint is ACCOUNT-WIDE, not per-tenant (one shared
// prepaid pool — docs/SMS-PHASE1-BRIEF.md §2), so this fetches the report
// once per run and reconciles across every tenant with rows still awaiting
// receipt, not once per tenant.
//
// Two pollers share the constants and helpers below (docs/SMS-PHASE4-FIX-F7-
// BRIEF.md): smsBlastPollReceipts (below) is the primary path — event-driven,
// fired by sms-blast-send right after finalize, walking POLL_BACKOFF_DELAYS
// for the one blast that just sent. smsDeliveryPoll is a daily fallback drain
// for anything whose event was lost, same role ops-inbox-process's poll plays.

// The 8 rungs of the per-blast backoff ladder — sums to ~27h50m, so an
// attempt cap of 8 lets the ladder alone exhaust a healthy blast without ever
// needing the daily fallback. MAX_AGE_HOURS gives ~2h of slack past that sum
// so the daily fallback still has a window to catch a blast whose
// sms/blast.poll-receipts event never fired at all (0 attempts consumed).
export const POLL_BACKOFF_DELAYS = ["5m", "15m", "30m", "1h", "2h", "4h", "8h", "12h"];
const MAX_POLL_ATTEMPTS = POLL_BACKOFF_DELAYS.length;
const MAX_AGE_HOURS = 30;
const REPORT_WINDOW_DAYS = 3;

export interface SubmittedRow {
  id: string;
  tenant_id: string;
  to_phone: string;
  body: string;
  sent_at: string | null;
  delivery_poll_attempts: number;
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function loadAwaitingReceipt(): Promise<SubmittedRow[]> {
  const service = await createServiceClient();
  const cutoff = new Date(Date.now() - MAX_AGE_HOURS * 60 * 60 * 1000).toISOString();
  const { data, error } = await service
    .from("sms_messages")
    .select("id, tenant_id, to_phone, body, sent_at, delivery_poll_attempts")
    .eq("status", "submitted")
    .lt("delivery_poll_attempts", MAX_POLL_ATTEMPTS)
    .gte("sent_at", cutoff)
    .order("sent_at", { ascending: true })
    .limit(5000);
  if (error) throw new Error(`sms-delivery-poll: failed to load submitted rows: ${error.message}`);
  return (data ?? []) as unknown as SubmittedRow[];
}

// Same shape as loadAwaitingReceipt but scoped to one blast — what the
// event-driven poller below walks on each backoff rung, instead of the
// account-wide sweep the daily fallback does.
export async function loadAwaitingReceiptForBlast(tenantId: string, blastId: string): Promise<SubmittedRow[]> {
  const db = await scopedClientForTenant(tenantId);
  const cutoff = new Date(Date.now() - MAX_AGE_HOURS * 60 * 60 * 1000).toISOString();
  const { data, error } = await db
    .from("sms_messages")
    .select("id, tenant_id, to_phone, body, sent_at, delivery_poll_attempts")
    .eq("blast_id", blastId)
    .eq("status", "submitted")
    .lt("delivery_poll_attempts", MAX_POLL_ATTEMPTS)
    .gte("sent_at", cutoff)
    .order("sent_at", { ascending: true })
    .limit(5000);
  if (error) throw new Error(`sms-delivery-poll: failed to load blast ${blastId} submitted rows: ${error.message}`);
  return (data ?? []) as unknown as SubmittedRow[];
}

// Thin DB-write caller around matchDeliveryReports(). Groups the tenant's
// unresolved rows by their CURRENT attempt count so the "+1 attempt" bump is
// one bulk update per distinct count, not one update per row.
export async function reconcileTenant(
  tenantId: string,
  rows: SubmittedRow[],
  reportRows: Awaited<ReturnType<ReturnType<typeof getSmsProvider>["report"]>>
): Promise<{ matched: number; stillAwaiting: number; gaveUp: number }> {
  const candidates: CandidateMessage[] = rows
    .filter((r): r is SubmittedRow & { sent_at: string } => r.sent_at != null)
    .map((r) => ({ id: r.id, to_phone: r.to_phone, body: r.body, sent_at: r.sent_at }));

  const { matches, unresolvedMessageIds } = matchDeliveryReports(candidates, reportRows);
  const db = await scopedClientForTenant(tenantId);
  const nowIso = new Date().toISOString();

  for (const m of matches) {
    await db
      .from("sms_messages")
      .update({
        status: m.outcome,
        delivered_at: m.outcome === "delivered" ? nowIso : null,
        provider_status: m.reportStatus,
        delivery_last_polled_at: nowIso,
        ...(m.outcome === "failed" ? { error_code: "delivery_failed", error_message: `Provider report: ${m.reportStatus}` } : {}),
      })
      .eq("id", m.messageId);
  }

  const attemptsById = new Map(rows.map((r) => [r.id, r.delivery_poll_attempts]));
  const unresolvedByAttempt = new Map<number, string[]>();
  for (const id of unresolvedMessageIds) {
    const attempts = attemptsById.get(id) ?? 0;
    const list = unresolvedByAttempt.get(attempts) ?? [];
    list.push(id);
    unresolvedByAttempt.set(attempts, list);
  }

  let gaveUp = 0;
  for (const [attempts, ids] of unresolvedByAttempt) {
    const nextAttempts = attempts + 1;
    await db
      .from("sms_messages")
      .update({ delivery_poll_attempts: nextAttempts, delivery_last_polled_at: nowIso })
      .in("id", ids);
    if (nextAttempts >= MAX_POLL_ATTEMPTS) gaveUp += ids.length;
  }

  return { matched: matches.length, stillAwaiting: unresolvedMessageIds.length, gaveUp };
}

export const smsDeliveryPoll = inngest.createFunction(
  { id: "sms-delivery-poll", triggers: [{ cron: "0 3 * * *" }] },
  async ({ step }) => {
    if (!isSmsEnabled()) return { skipped: true, reason: "sms disabled" };

    const submitted = await step.run("load-awaiting-receipt", loadAwaitingReceipt);
    if (submitted.length === 0) return { polled: 0, matched: 0, stillAwaiting: 0, gaveUp: 0 };

    const reportRows = await step.run("fetch-provider-report", async () => {
      const provider = getSmsProvider();
      const end = new Date();
      const start = new Date(end.getTime() - REPORT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
      return provider.report(formatDate(start), formatDate(end));
    });

    const byTenant = new Map<string, SubmittedRow[]>();
    for (const row of submitted) {
      const list = byTenant.get(row.tenant_id) ?? [];
      list.push(row);
      byTenant.set(row.tenant_id, list);
    }

    let matchedTotal = 0;
    let stillAwaitingTotal = 0;
    let gaveUpTotal = 0;

    for (const [tenantId, rows] of byTenant) {
      const outcome = await step.run(`reconcile-tenant-${tenantId}`, () => reconcileTenant(tenantId, rows, reportRows));
      matchedTotal += outcome.matched;
      stillAwaitingTotal += outcome.stillAwaiting;
      gaveUpTotal += outcome.gaveUp;
      if (outcome.gaveUp > 0) {
        logger.warn(
          { tenantId, gaveUp: outcome.gaveUp, maxPollAttempts: MAX_POLL_ATTEMPTS },
          "[sms-delivery-poll] recipient(s) hit the poll-attempt cap with delivery status still unresolved — left as 'submitted', will not be polled again"
        );
      }
    }

    return { polled: submitted.length, matched: matchedTotal, stillAwaiting: stillAwaitingTotal, gaveUp: gaveUpTotal };
  }
);

// Event-driven primary poller (docs/SMS-PHASE4-FIX-F7-BRIEF.md item 1) —
// fired by sms-blast-send right after its finalize step, one event per blast
// that actually sent something. Walks POLL_BACKOFF_DELAYS, reconciling just
// this blast's still-awaiting rows on each rung, and exits the moment
// nothing is left awaiting a receipt instead of burning the rest of the
// ladder. sms-delivery-poll (above) is only a daily fallback drain for a
// blast whose event never arrived.
export const smsBlastPollReceipts = inngest.createFunction(
  { id: "sms-blast-poll-receipts", triggers: [{ event: "sms/blast.poll-receipts" }] },
  async ({ event, step }) => {
    if (!isSmsEnabled()) return { skipped: true, reason: "sms disabled" };

    const { tenantId, blastId } = event.data as { tenantId: string; blastId: string };

    for (let i = 0; i < POLL_BACKOFF_DELAYS.length; i++) {
      await step.sleep(`wait-${i}`, POLL_BACKOFF_DELAYS[i]);

      const rows = await step.run(`load-blast-rows-${i}`, () => loadAwaitingReceiptForBlast(tenantId, blastId));
      if (rows.length === 0) return { attempts: i + 1, exitedEarly: true, blastId };

      const reportRows = await step.run(`fetch-provider-report-${i}`, async () => {
        const provider = getSmsProvider();
        const end = new Date();
        const start = new Date(end.getTime() - REPORT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
        return provider.report(formatDate(start), formatDate(end));
      });

      const outcome = await step.run(`reconcile-${i}`, () => reconcileTenant(tenantId, rows, reportRows));
      if (outcome.stillAwaiting === 0) return { attempts: i + 1, exitedEarly: true, blastId, ...outcome };
    }

    return { attempts: POLL_BACKOFF_DELAYS.length, exitedEarly: false, blastId };
  }
);
