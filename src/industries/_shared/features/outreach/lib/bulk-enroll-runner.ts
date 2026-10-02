import { buildUserAuthContext, type AuthContext } from "@/lib/api/auth";
import { logger } from "@/lib/logger";
import { createServiceClient } from "@/lib/supabase/server";
import { scopedClientForTenant, type ScopedClient } from "@/lib/supabase/scoped";
import { enrollLead, unenrollLead, EnrollmentConflictError } from "./engine";
import { queueNextSequence } from "./queue-next";

// Worker for bulk enroll (OUTREACH-BULK-ENROLL-BRIEF.md §7). NOT an Inngest function — like blast-runner.ts and
// sequence-schedule-runner.ts it is driven by an in-process timer (src/instrumentation.ts) plus an immediate
// after() call from the Start route. The list of leads was saved when the rep clicked Start
// (sequence_bulk_enrollment_items), so everything here is just "enroll the pending rows":
//   - restart-safe: outcomes are persisted per lead, a restart continues with what is still 'pending'
//   - idempotent: a lead is only ever marked from 'pending', and enrollLead itself refuses a second running
//     enrollment (unique index), so a repeated pass can never enroll anyone twice
//   - time-boxed: one pass works for ~25 s and returns; the timer calls it again, so a 10,000-lead run
//     never blocks the process and a cancel is noticed within a chunk
//   - a failing lead is recorded and the run carries on

const CHUNK_SIZE = 25;
const PASS_BUDGET_MS = 25_000;
const MAX_RUNS_PER_SCAN = 20;

let running = false;

interface RunRow {
  id: string;
  sequence_id: string;
  created_by: string | null;
  conflict_policy: "skip" | "switch" | "queue";
  status: "queued" | "running" | "completed" | "cancelled" | "failed";
  cancel_requested: boolean;
}

interface ItemRow {
  id: string;
  lead_id: string;
}

interface LeadRow {
  id: string;
  assigned_to: string | null;
  deleted_at: string | null;
}

export interface RunPassSummary {
  enrolled: number;
  skipped: number;
  failed: number;
  finished: boolean;
}

interface EnrollInput {
  sequenceId: string;
  leadId: string;
  assignedTo: string;
  enrolledBy: string;
}

interface Resolved {
  outcome: "enrolled" | "skipped" | "failed";
  reason: string | null;
}

const errorReason = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 200);

/**
 * The lead is already in a running sequence (a lead can be in only one). What happens is the run's conflict
 * policy: skip leaves them, queue parks this sequence to start when theirs ends, switch ends theirs and
 * enrolls them here.
 */
async function resolveConflict(
  ctx: { db: ScopedClient; auth: AuthContext; run: RunRow },
  input: EnrollInput
): Promise<Resolved> {
  const { db, auth, run } = ctx;

  if (run.conflict_policy === "queue") {
    try {
      const queued = await queueNextSequence(db, { leadId: input.leadId, sequenceId: run.sequence_id, queuedBy: auth.userId, runId: run.id });
      return { outcome: "skipped", reason: queued === "queued" ? "queued_next" : "already_queued" };
    } catch (err) {
      logger.error({ err, runId: run.id, leadId: input.leadId }, "bulk-enroll: failed to queue a lead");
      return { outcome: "failed", reason: errorReason(err) };
    }
  }

  if (run.conflict_policy === "switch") {
    try {
      const { data: current } = await db
        .from("sequence_enrollments")
        .select("id, sequence_id")
        .eq("lead_id", input.leadId)
        .in("status", ["active", "paused"])
        .maybeSingle();
      const cur = current as unknown as { id: string; sequence_id: string } | null;
      if (cur && cur.sequence_id === run.sequence_id) return { outcome: "skipped", reason: "already_in_this_sequence" };
      // promoteQueue:false — we enroll them somewhere else right now, so a queued sequence must not jump in first
      if (cur) await unenrollLead(db, cur.id, { promoteQueue: false });
      await enrollLead(db, auth, input);
      return { outcome: "enrolled", reason: "switched" };
    } catch (err) {
      if (err instanceof EnrollmentConflictError) return { outcome: "skipped", reason: "already_in_sequence" };
      logger.error({ err, runId: run.id, leadId: input.leadId }, "bulk-enroll: failed to switch a lead");
      return { outcome: "failed", reason: errorReason(err) };
    }
  }

  return { outcome: "skipped", reason: "already_in_sequence" };
}

async function refreshCounts(db: ScopedClient, runId: string): Promise<void> {
  const count = async (outcome: string): Promise<number> => {
    const { count: n } = await db
      .from("sequence_bulk_enrollment_items")
      .select("id", { count: "exact", head: true })
      .eq("run_id", runId)
      .eq("outcome", outcome);
    return n ?? 0;
  };
  const [enrolled, skipped, failed] = await Promise.all([count("enrolled"), count("skipped"), count("failed")]);
  await db
    .from("sequence_bulk_enrollments")
    .update({ enrolled_count: enrolled, skipped_count: skipped, failed_count: failed })
    .eq("id", runId);
}

async function finish(db: ScopedClient, runId: string, status: "completed" | "cancelled" | "failed", error?: string) {
  if (status === "cancelled") {
    await db
      .from("sequence_bulk_enrollment_items")
      .update({ outcome: "skipped", reason: "cancelled", processed_at: new Date().toISOString() })
      .eq("run_id", runId)
      .eq("outcome", "pending");
  }
  await refreshCounts(db, runId);
  await db
    .from("sequence_bulk_enrollments")
    .update({ status, finished_at: new Date().toISOString(), error: error ?? null })
    .eq("id", runId)
    .in("status", ["queued", "running"]);
}

/**
 * Works through one run for up to `budgetMs`. Safe to call repeatedly / concurrently with the same run id
 * (see the header). Returns what this pass did.
 */
export async function processBulkEnrollRun(
  tenantId: string,
  runId: string,
  budgetMs: number = PASS_BUDGET_MS
): Promise<RunPassSummary> {
  const summary: RunPassSummary = { enrolled: 0, skipped: 0, failed: 0, finished: false };
  const db = await scopedClientForTenant(tenantId);

  const { data: runData } = await db
    .from("sequence_bulk_enrollments")
    .select("id, sequence_id, created_by, conflict_policy, status, cancel_requested")
    .eq("id", runId)
    .maybeSingle();
  const run = runData as unknown as RunRow | null;
  if (!run || (run.status !== "queued" && run.status !== "running")) return summary;

  if (run.cancel_requested) {
    await finish(db, runId, "cancelled");
    summary.finished = true;
    return summary;
  }

  if (run.status === "queued") {
    await db
      .from("sequence_bulk_enrollments")
      .update({ status: "running", started_at: new Date().toISOString() })
      .eq("id", runId)
      .eq("status", "queued");
  }

  const { data: seq } = await db.from("email_sequences").select("id, status").eq("id", run.sequence_id).maybeSingle();
  if (!seq || (seq as unknown as { status: string }).status !== "active") {
    await finish(db, runId, "failed", "The sequence is no longer active.");
    summary.finished = true;
    return summary;
  }

  const auth = run.created_by ? await buildUserAuthContext(run.created_by, tenantId) : null;
  if (!auth) {
    await finish(db, runId, "failed", "The person who started this run no longer has access.");
    summary.finished = true;
    return summary;
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < budgetMs) {
    const { data: flag } = await db.from("sequence_bulk_enrollments").select("cancel_requested").eq("id", runId).maybeSingle();
    if ((flag as unknown as { cancel_requested: boolean } | null)?.cancel_requested) {
      await finish(db, runId, "cancelled");
      summary.finished = true;
      return summary;
    }

    const { data: itemData, error: itemError } = await db
      .from("sequence_bulk_enrollment_items")
      .select("id, lead_id")
      .eq("run_id", runId)
      .eq("outcome", "pending")
      .order("created_at", { ascending: true })
      .limit(CHUNK_SIZE);
    if (itemError) {
      logger.error({ err: itemError, runId }, "bulk-enroll: failed to load pending items");
      return summary;
    }
    const items = (itemData ?? []) as unknown as ItemRow[];
    if (items.length === 0) {
      await finish(db, runId, "completed");
      summary.finished = true;
      return summary;
    }

    const { data: leadData } = await db
      .from("leads")
      .select("id, assigned_to, deleted_at")
      .in("id", items.map((i) => i.lead_id));
    const leadById = new Map(((leadData ?? []) as unknown as LeadRow[]).map((l) => [l.id, l]));

    for (const item of items) {
      const mark = async (outcome: "enrolled" | "skipped" | "failed", reason: string | null) => {
        // only ever from 'pending' — a second pass can't overwrite a result
        await db
          .from("sequence_bulk_enrollment_items")
          .update({ outcome, reason, processed_at: new Date().toISOString() })
          .eq("id", item.id)
          .eq("outcome", "pending");
        summary[outcome]++;
      };

      const lead = leadById.get(item.lead_id);
      if (!lead || lead.deleted_at) {
        await mark("skipped", "lead_deleted");
        continue;
      }
      const enrollInput = {
        sequenceId: run.sequence_id,
        leadId: lead.id,
        assignedTo: lead.assigned_to ?? auth.userId,
        enrolledBy: auth.userId,
      };
      try {
        await enrollLead(db, auth, enrollInput);
        await mark("enrolled", null);
      } catch (err) {
        if (err instanceof EnrollmentConflictError) {
          const resolved = await resolveConflict({ db, auth, run }, enrollInput);
          await mark(resolved.outcome, resolved.reason);
        } else {
          logger.error({ err, runId, leadId: item.lead_id }, "bulk-enroll: failed to enroll a lead");
          await mark("failed", errorReason(err));
        }
      }
    }

    await refreshCounts(db, runId);
  }

  return summary;
}

/** One scan: continue every queued / running run (all tenants), oldest first. */
export async function runBulkEnrollQueue(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const supabase = await createServiceClient();
    const { data, error } = await supabase
      .from("sequence_bulk_enrollments")
      .select("id, tenant_id")
      .in("status", ["queued", "running"])
      .order("created_at", { ascending: true })
      .limit(MAX_RUNS_PER_SCAN);
    if (error) {
      logger.error({ err: error }, "bulk-enroll-runner: failed to scan for runs");
      return;
    }
    for (const run of (data ?? []) as unknown as { id: string; tenant_id: string }[]) {
      try {
        await processBulkEnrollRun(run.tenant_id, run.id);
      } catch (err) {
        logger.error({ err, runId: run.id }, "bulk-enroll-runner: run pass threw");
      }
    }
  } finally {
    running = false;
  }
}
