import { inngest } from "@/lib/inngest/client";
import { createServiceClient } from "@/lib/supabase/server";
import { scopedClientForTenant } from "@/lib/supabase/scoped";
import { isSmsEnabled } from "@/lib/sms/flag";
import { logger } from "@/lib/logger";

// Reserved-credit reaper — docs/SMS-PHASE4-BRIEF.md item 5, the accepted F-5
// residual (SMS-PHASE3A-FIX-F5-BRIEF.md): a blast cancelled while `sending`
// whose Inngest run then dies before its `finalize` step never reaches
// finalizeBlast's sms_credits_settle call, leaving its reservation stuck in
// sms_credit_accounts.reserved forever. This sweep finds terminal blasts with
// no settle ledger row for their ref_id and settles them against what the
// provider actually charged.
//
// sms_credits_settle is idempotent on (tenant_id, ref_type, ref_id, reason)
// (migration 202's uq_sms_ledger_reserve_ref) — a blast that DID settle
// normally is a safe no-op if this sweep ever raced it, but the point of the
// existence check below is to avoid calling it at all for the common case.

const TERMINAL_STATUSES = ["sent", "partially_failed", "failed", "cancelled"];

export interface TerminalBlastRow {
  id: string;
  tenant_id: string;
  reserved_credits: number | null;
}

interface SettledRefRow {
  ref_id: string;
}

interface CreditRow {
  provider_credit: number | null;
}

export async function findUnsettledTerminalBlasts(): Promise<TerminalBlastRow[]> {
  const service = await createServiceClient();

  const { data: blasts, error: blastsError } = await service
    .from("sms_blasts")
    .select("id, tenant_id, reserved_credits")
    .in("status", TERMINAL_STATUSES)
    .not("reserved_credits", "is", null)
    .gt("reserved_credits", 0);
  if (blastsError) throw new Error(`sms-credit-reaper: failed to load terminal blasts: ${blastsError.message}`);
  const terminalBlasts = (blasts ?? []) as unknown as TerminalBlastRow[];
  if (terminalBlasts.length === 0) return [];

  const { data: settled, error: settledError } = await service
    .from("sms_credit_ledger")
    .select("ref_id")
    .eq("ref_type", "sms_blast")
    .eq("reason", "settle")
    .in(
      "ref_id",
      terminalBlasts.map((b) => b.id)
    );
  if (settledError) throw new Error(`sms-credit-reaper: failed to load settled ref_ids: ${settledError.message}`);
  const settledIds = new Set(((settled ?? []) as unknown as SettledRefRow[]).map((r) => r.ref_id));

  return terminalBlasts.filter((b) => !settledIds.has(b.id));
}

export async function reapBlast(blast: TerminalBlastRow): Promise<{ blastId: string; actual: number; diff: number } | null> {
  const db = await scopedClientForTenant(blast.tenant_id);

  const { data: chargedRows, error: chargedError } = await db
    .from("sms_messages")
    .select("provider_credit")
    .eq("blast_id", blast.id)
    .in("status", ["submitted", "delivered"]);
  if (chargedError) throw new Error(`sms-credit-reaper: failed to total charged credits for blast ${blast.id}: ${chargedError.message}`);
  const actual = ((chargedRows ?? []) as unknown as CreditRow[]).reduce((sum, r) => sum + (r.provider_credit ?? 0), 0);

  const reserved = blast.reserved_credits ?? 0;
  const { data: settleResult, error: settleError } = await db.rpc("sms_credits_settle", {
    p_ref_id: blast.id,
    p_reserved: reserved,
    p_actual: actual,
    p_ref_type: "sms_blast", // never rely on the RPC default — SMS-PHASE4-BRIEF.md reconciliation rule
  });
  if (settleError) throw new Error(`sms-credit-reaper: sms_credits_settle failed for blast ${blast.id}: ${settleError.message}`);

  const result = settleResult as { ok: boolean; diff?: number; replayed?: boolean };
  if (!result.ok) return null;

  return { blastId: blast.id, actual, diff: result.diff ?? reserved - actual };
}

export const smsCreditReaper = inngest.createFunction(
  // SMS-PHASE4-FIX-F7-BRIEF.md item 2: hourly was 24x more often than the F-5
  // residual it guards against warrants — it's a safety net for a rare
  // Inngest-run-died-mid-blast case, not a hot path.
  { id: "sms-credit-reaper", triggers: [{ cron: "0 4 * * *" }] },
  async ({ step }) => {
    if (!isSmsEnabled()) return { skipped: true, reason: "sms disabled" };

    const candidates = await step.run("find-unsettled-terminal-blasts", findUnsettledTerminalBlasts);
    if (candidates.length === 0) return { reaped: 0 };

    const reaped: { blastId: string; actual: number; diff: number }[] = [];
    for (const blast of candidates) {
      const outcome = await step.run(`reap-${blast.id}`, () => reapBlast(blast));
      if (outcome) reaped.push(outcome);
    }

    if (reaped.length > 0) {
      // A silent reaper hides a real bug upstream (finalizeBlast/cancel should
      // have caught these) — always log what it reaped, never quietly clean up.
      logger.warn({ reaped }, "[sms-credit-reaper] settled reserved credits for terminal blast(s) that finalize/cancel never reached");
    }

    return { reaped: reaped.length, details: reaped };
  }
);
