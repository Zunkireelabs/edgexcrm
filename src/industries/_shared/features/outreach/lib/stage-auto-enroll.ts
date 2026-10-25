import { logger } from "@/lib/logger";
import { scopedClientForTenant, type ScopedClient } from "@/lib/supabase/scoped";
import { unenrollLead } from "./engine";
import { processBulkEnrollRun } from "./bulk-enroll-runner";
import type { OutreachChannel } from "./channel";

// Stage auto-enroll (migration 277). A sequence can be linked to one or more stages; when a lead ENTERS a linked stage
// the lead is enrolled in that sequence, and when the lead moves to a stage that is NOT linked to it the auto-enrolled
// sequence stops. Called from every place a lead's stage changes.
//
// Rules (the product decisions, in one place):
//   1. Leaving a linked stage stops a rule-started enrollment (stop_reason 'stage_left'). Sequences a person enrolled the
//      lead in — manual or bulk — are never touched.
//   2. A lead already running a sequence on that channel keeps it: the auto one is QUEUED to start when it ends.
//   3. Opted-out leads (lead_auto_enroll_optouts) are skipped, per channel.
//   4. A lead is auto-enrolled into the same sequence ONCE — moving back and forth between stages never restarts it.
//   5. Email and SMS are independent: a stage can have one rule per channel and every rule is evaluated on its own.
//
// Nothing is enrolled inline. The enrollment work is handed to the existing bulk-enroll runner as a saved run
// (restart-safe, chunked, never enrolls anyone twice), so moving 5,000 leads returns immediately.

const ID_CHUNK = 500;
const ITEM_INSERT_CHUNK = 1000;

export interface StageEntryInput {
  tenantId: string;
  leadIds: string[];
  /** The stage the leads came from (null when they had none / were just created). */
  fromListId: string | null;
  /** The stage the leads are now in (null when they were taken out of every stage). */
  toListId: string | null;
}

export interface StageEntryResult {
  /** Rule-started enrollments that were ended because the lead moved to a stage that isn't linked. */
  stopped: number;
  /** Rule-parked "start next" entries (waiting behind a person's sequence) cancelled for the same reason. */
  queuedCancelled: number;
  /** Runs created (one per rule that had at least one eligible lead). */
  runsCreated: number;
  /** Leads handed to a run, summed across rules. */
  leadsQueued: number;
}

interface TriggerRow {
  sequence_id: string;
  list_id: string;
  channel: OutreachChannel;
  created_by: string | null;
}

const EMPTY: StageEntryResult = { stopped: 0, queuedCancelled: 0, runsCreated: 0, leadsQueued: 0 };

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Runs a `.in("lead_id", ids)` query in chunks so a huge bulk move can't overflow the request. */
async function inChunks<R>(ids: string[], run: (part: string[]) => PromiseLike<{ data: unknown; error: unknown }>): Promise<R[]> {
  const rows: R[] = [];
  for (const part of chunk(ids, ID_CHUNK)) {
    const { data, error } = await run(part);
    if (error) throw new Error(`stage-auto-enroll lookup failed: ${(error as { message?: string }).message ?? String(error)}`);
    rows.push(...((data ?? []) as R[]));
  }
  return rows;
}

/**
 * The one entry point. Safe to call for any stage change: with no rules configured it costs a single small query and
 * returns. Throws on a database error — call sites use {@link onLeadsEnteredStageSafe}.
 */
export async function onLeadsEnteredStage(input: StageEntryInput): Promise<StageEntryResult> {
  const leadIds = [...new Set(input.leadIds)];
  if (leadIds.length === 0 || input.fromListId === input.toListId) return { ...EMPTY };

  const db = await scopedClientForTenant(input.tenantId);

  const { data: triggerData, error: triggerError } = await db
    .from("sequence_stage_triggers")
    .select("sequence_id, list_id, channel, created_by")
    .eq("is_active", true);
  if (triggerError) throw new Error(`stage-auto-enroll: failed to load rules: ${triggerError.message}`);
  const triggers = (triggerData ?? []) as unknown as TriggerRow[];

  const result: StageEntryResult = { ...EMPTY };
  const rulesForNewStage = input.toListId ? triggers.filter((t) => t.list_id === input.toListId) : [];

  // ── 1) stop what no longer applies ───────────────────────────────────────
  // Only worth looking when the leads had a stage before (a brand-new lead has nothing to stop).
  if (input.fromListId) {
    result.stopped = await stopRuleEnrollmentsNoLongerLinked(db, leadIds, rulesForNewStage);
    result.queuedCancelled = await cancelQueuedRuleSequences(db, leadIds, rulesForNewStage);
  }

  // ── 2) start what now applies ────────────────────────────────────────────
  for (const rule of rulesForNewStage) {
    const queued = await startRun(db, input.tenantId, leadIds, rule);
    if (queued > 0) {
      result.runsCreated++;
      result.leadsQueued += queued;
    }
  }
  return result;
}

/** Same as {@link onLeadsEnteredStage} but never throws: a failure here must never fail the stage move itself. */
export async function onLeadsEnteredStageSafe(input: StageEntryInput): Promise<StageEntryResult> {
  try {
    return await onLeadsEnteredStage(input);
  } catch (err) {
    logger.error({ err, tenantId: input.tenantId, toListId: input.toListId }, "stage auto-enroll failed (non-fatal)");
    return { ...EMPTY };
  }
}

async function stopRuleEnrollmentsNoLongerLinked(db: ScopedClient, leadIds: string[], rulesForNewStage: TriggerRow[]): Promise<number> {
  const linkedSequenceIds = new Set(rulesForNewStage.map((r) => r.sequence_id));
  const channelsWithNewRule = new Set(rulesForNewStage.map((r) => r.channel));

  const running = await inChunks<{ id: string; sequence_id: string; channel: string | null }>(leadIds, (part) =>
    db
      .from("sequence_enrollments")
      .select("id, sequence_id, channel")
      .eq("source", "stage_rule")
      .in("status", ["active", "paused"])
      .in("lead_id", part)
  );

  let stopped = 0;
  for (const enrollment of running) {
    // The sequence is still linked to the stage the lead is now in (a sequence may cover several stages): it keeps going.
    if (linkedSequenceIds.has(enrollment.sequence_id)) continue;
    const channel: OutreachChannel = enrollment.channel === "sms" ? "sms" : "email";
    try {
      // When a new rule is about to start on this channel, don't promote a manually queued sequence in between — the new
      // rule enrolls next and the person's queued one keeps waiting. With no new rule, the queue moves on as usual.
      await unenrollLead(db, enrollment.id, { stopReason: "stage_left", promoteQueue: !channelsWithNewRule.has(channel) });
      stopped++;
    } catch (err) {
      logger.error({ err, enrollmentId: enrollment.id }, "stage auto-enroll: failed to stop an enrollment");
    }
  }
  return stopped;
}

/**
 * One-time catch-up for a rule that was just switched on: enrolls the leads ALREADY in `listId`, through the same run and
 * eligibility rules as a stage move. Reads the stage's leads a page at a time (never all in memory at once beyond `limit`).
 */
export async function enrollLeadsAlreadyInStage(
  db: ScopedClient,
  tenantId: string,
  params: { sequenceId: string; channel: OutreachChannel; listId: string; createdBy: string | null; limit: number }
): Promise<{ leadsQueued: number; capped: boolean }> {
  const PAGE = 1000;
  const ids: string[] = [];
  for (let from = 0; ids.length <= params.limit; from += PAGE) {
    const { data, error } = await db
      .from("leads")
      .select("id")
      .eq("list_id", params.listId)
      .is("deleted_at", null)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`stage-auto-enroll: failed to read the stage's leads: ${error.message}`);
    const rows = (data ?? []) as unknown as Array<{ id: string }>;
    ids.push(...rows.map((r) => r.id));
    if (rows.length < PAGE) break;
  }
  const capped = ids.length > params.limit;
  const leadIds = ids.slice(0, params.limit);
  if (leadIds.length === 0) return { leadsQueued: 0, capped: false };
  const leadsQueued = await startRun(db, tenantId, leadIds, {
    sequence_id: params.sequenceId,
    list_id: params.listId,
    channel: params.channel,
    created_by: params.createdBy,
  });
  return { leadsQueued, capped };
}

/**
 * A rule can PARK its sequence behind a sequence a person started ("start when that one ends"). If the lead leaves the stage
 * before that happens, the parked sequence must not start later for a lead who has moved on — cancel it. Entries a person
 * queued by hand (no rule run behind them) are never touched.
 */
async function cancelQueuedRuleSequences(db: ScopedClient, leadIds: string[], rulesForNewStage: TriggerRow[]): Promise<number> {
  const linkedSequenceIds = new Set(rulesForNewStage.map((r) => r.sequence_id));

  const waiting = await inChunks<{ id: string; sequence_id: string; run_id: string | null }>(leadIds, (part) =>
    db.from("sequence_enrollment_queue").select("id, sequence_id, run_id").eq("status", "waiting").in("lead_id", part)
  );
  const withRun = waiting.filter((q) => q.run_id && !linkedSequenceIds.has(q.sequence_id));
  if (withRun.length === 0) return 0;

  const runIds = [...new Set(withRun.map((q) => q.run_id as string))];
  const { data: runData, error } = await db.from("sequence_bulk_enrollments").select("id, trigger_kind").in("id", runIds);
  if (error) throw new Error(`stage-auto-enroll: failed to read the queued runs: ${error.message}`);
  const ruleRuns = new Set(((runData ?? []) as unknown as Array<{ id: string; trigger_kind: string }>).filter((r) => r.trigger_kind === "stage_rule").map((r) => r.id));

  let cancelled = 0;
  for (const entry of withRun) {
    if (!ruleRuns.has(entry.run_id as string)) continue;
    const { error: updateError } = await db
      .from("sequence_enrollment_queue")
      .update({ status: "cancelled", reason: "The lead moved to another stage." })
      .eq("id", entry.id)
      .eq("status", "waiting");
    if (updateError) {
      logger.error({ err: updateError, queueId: entry.id }, "stage auto-enroll: failed to cancel a parked sequence");
      continue;
    }
    cancelled++;
  }
  return cancelled;
}

/**
 * Who a rule's background run acts as. It is the admin who set the rule up — but that person can leave, be suspended or be
 * demoted months later, and a run started as someone without access fails as a whole ("no longer has access"), silently
 * enrolling nobody. So the rule keeps working: fall back to an active tenant owner, then an active admin. Null only if the tenant
 * has neither (the run then fails with a clear message, as before).
 */
export async function resolveRuleActor(db: ScopedClient, createdBy: string | null): Promise<string | null> {
  const { data, error } = await db.from("tenant_users").select("user_id, role").in("role", ["owner", "admin"]).is("suspended_at", null);
  if (error) throw new Error(`stage-auto-enroll: failed to resolve who runs the rule: ${error.message}`);
  const people = (data ?? []) as unknown as Array<{ user_id: string; role: string }>;
  if (createdBy && people.some((p) => p.user_id === createdBy)) return createdBy;
  return people.find((p) => p.role === "owner")?.user_id ?? people[0]?.user_id ?? null;
}

/** Saves one run for this rule (eligible leads only) and kicks the worker. Returns how many leads were queued. */
async function startRun(db: ScopedClient, tenantId: string, leadIds: string[], rule: TriggerRow): Promise<number> {
  const { data: seq } = await db.from("email_sequences").select("id, status").eq("id", rule.sequence_id).maybeSingle();
  if (!seq || (seq as unknown as { status: string }).status !== "active") return 0;

  const optedOut = new Set(
    (
      await inChunks<{ lead_id: string }>(leadIds, (part) =>
        db.from("lead_auto_enroll_optouts").select("lead_id").eq("channel", rule.channel).in("lead_id", part)
      )
    ).map((r) => r.lead_id)
  );
  // once-only: any earlier rule-started enrollment in this sequence, finished or not
  const alreadyAuto = new Set(
    (
      await inChunks<{ lead_id: string }>(leadIds, (part) =>
        db.from("sequence_enrollments").select("lead_id").eq("sequence_id", rule.sequence_id).eq("source", "stage_rule").in("lead_id", part)
      )
    ).map((r) => r.lead_id)
  );

  const eligible = leadIds.filter((id) => !optedOut.has(id) && !alreadyAuto.has(id));
  if (eligible.length === 0) return 0;

  const { data: run, error } = await db
    .from("sequence_bulk_enrollments")
    .insert({
      sequence_id: rule.sequence_id,
      created_by: await resolveRuleActor(db, rule.created_by),
      source_mode: "selected",
      source_snapshot: { lead_ids: eligible.length, trigger: "stage_rule", list_id: rule.list_id },
      conflict_policy: "queue",
      status: "queued",
      total_count: eligible.length,
      trigger_kind: "stage_rule",
      trigger_list_id: rule.list_id,
    })
    .select("id")
    .single();
  if (error || !run) throw new Error(`stage-auto-enroll: failed to create the run: ${error?.message ?? "no row"}`);
  const runId = (run as unknown as { id: string }).id;

  for (const part of chunk(eligible, ITEM_INSERT_CHUNK)) {
    const { error: itemsError } = await db
      .from("sequence_bulk_enrollment_items")
      .insert(part.map((leadId) => ({ run_id: runId, lead_id: leadId, outcome: "pending", reason: null })));
    if (itemsError) {
      // Never leave a half-saved run for the worker to pick up.
      await db.from("sequence_bulk_enrollments").update({ status: "failed", error: "Could not save the list of leads" }).eq("id", runId);
      throw new Error(`stage-auto-enroll: failed to save the run's leads: ${itemsError.message}`);
    }
  }

  await kickRunner(tenantId, runId);
  return eligible.length;
}

/**
 * Starts working on the run right away when we are inside a request (after() keeps it alive once the response is sent).
 * Outside a request — or if that fails — the in-process timer in src/instrumentation.ts picks the queued run up within
 * ~30 s, so nothing depends on this call succeeding.
 */
async function kickRunner(tenantId: string, runId: string): Promise<void> {
  try {
    const { after } = await import("next/server");
    after(async () => {
      try {
        await processBulkEnrollRun(tenantId, runId);
      } catch (err) {
        logger.error({ err, runId }, "stage auto-enroll: first pass threw (the timer will retry)");
      }
    });
  } catch {
    // not in a request scope — the timer will take it
  }
}
