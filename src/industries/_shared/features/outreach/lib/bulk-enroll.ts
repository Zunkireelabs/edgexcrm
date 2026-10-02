import type { AuthContext } from "@/lib/api/auth";
import type { FilterTree } from "@/lib/filters/types";
import { filterTreeSchema } from "@/lib/filters/schema";
import type { ScopedClient } from "@/lib/supabase/scoped";
import { resolveAudience, resolveAudienceForLeadIds, type AudienceRow, type ResolveAudienceClients } from "@/lib/email/outbound/audience";
import { getDailyCapStatus } from "@/lib/email/outbound/cap";
import { isBulkEmailEnabledForTenant, isEmailOutboundSandbox } from "@/lib/email/outbound/flag";

// Bulk enroll (OUTREACH-BULK-ENROLL-BRIEF.md) — resolve an audience, show what WOULD happen (preview, no
// writes), then on Start save one row per lead (sequence_bulk_enrollment_items) so a background worker
// (bulk-enroll-runner.ts) can enroll them in chunks, restart-safe and idempotent.
//
// Resolution happens in the REQUEST (here), not in the worker: own/branch-scope callers' visibility comes from
// a real user-authenticated client (leads_visible_to_user() fails closed for a service-role client), which
// only exists while the request does. The worker then only reads the saved rows.

/** One run can enroll at most this many leads. */
export const BULK_ENROLL_MAX_LEADS = 10_000;
/** From this many leads up the rep must type a confirmation word before Start. */
export const BULK_ENROLL_CONFIRM_FROM = 100;
/** Phase 2a: leads already in a sequence are skipped. Switch / Queue next arrive in 2b. */
export const SUPPORTED_CONFLICT_POLICIES = ["skip"] as const;
export type ConflictPolicy = (typeof SUPPORTED_CONFLICT_POLICIES)[number];

export type BulkSource = { mode: "selected"; leadIds: string[] } | { mode: "filter"; tree: FilterTree };

export type SkipReason =
  | "no_email"
  | "malformed_email"
  | "duplicate_email"
  | "suppressed"
  | "already_in_sequence"
  | "lead_deleted"
  | "cancelled";

export interface BulkEnrollPreview {
  /** Leads the caller can see that the source resolved to (before the email / duplicate / suppression rules). */
  matched: number;
  /** Selected-rows mode only: ids asked for that are not visible / not found / deleted. */
  notVisible: number;
  /** Leads that WOULD be enrolled. */
  willEnroll: number;
  skipped: {
    noEmail: number;
    malformedEmail: number;
    duplicateEmail: number;
    suppressed: number;
    alreadyInSequence: number;
  };
  overLimit: boolean;
  limit: number;
  confirmFrom: number;
  cap: { dailyCap: number; sentToday: number; remaining: number };
  /** Rough whole days until the daily cap has released every first email (0 when it all fits today). */
  estimatedExtraDays: number;
  sandbox: boolean;
  sendingEnabled: boolean;
  sampleNames: string[];
}

export interface PlannedItem {
  leadId: string;
  outcome: "pending" | "skipped";
  reason: SkipReason | null;
}

export interface BulkPlan {
  preview: BulkEnrollPreview;
  /** One entry per lead we know about (enrollable + skipped) — saved as the run's items on Start. */
  items: PlannedItem[];
}

interface ExcludedCounts {
  noEmail: number;
  malformed: number;
  suppressed: number;
  duplicate: number;
}

const EXCLUDED_REASON: Record<string, SkipReason> = {
  noEmail: "no_email",
  malformed: "malformed_email",
  duplicate: "duplicate_email",
};

async function resolveSource(auth: AuthContext, source: BulkSource, clients: ResolveAudienceClients) {
  if (source.mode === "selected") {
    const resolved = await resolveAudienceForLeadIds(auth, source.leadIds, clients);
    return {
      matched: resolved.audience.matched,
      notVisible: Math.max(0, resolved.requested - resolved.audience.matched),
      sendable: resolved.audience.sendable,
      suppressed: resolved.audience.suppressed,
      excluded: resolved.audience.excluded as unknown as ExcludedCounts,
      excludedRows: resolved.audience.excludedRows,
    };
  }
  const resolved = await resolveAudience(auth, source.tree, clients);
  if (!resolved.ok) return { ok: false as const, errors: resolved.errors };
  return {
    matched: resolved.audience.matched,
    notVisible: 0,
    sendable: resolved.audience.sendable,
    suppressed: resolved.audience.suppressed,
    excluded: {
      noEmail: resolved.audience.excluded.noEmail,
      malformed: resolved.audience.excluded.malformed,
      suppressed: resolved.audience.excluded.suppressed,
      duplicate: resolved.audience.excluded.duplicateEmail,
    },
    excludedRows: resolved.audience.excludedRows ?? [],
  };
}

/** Ids (of `leadIds`) that already have a running (active / paused) enrollment — chunked so the URL stays short. */
export async function findLeadsInSequence(db: ScopedClient, leadIds: string[]): Promise<Set<string>> {
  const inSequence = new Set<string>();
  for (let i = 0; i < leadIds.length; i += 200) {
    const { data, error } = await db
      .from("sequence_enrollments")
      .select("lead_id")
      .in("lead_id", leadIds.slice(i, i + 200))
      .in("status", ["active", "paused"]);
    if (error) throw new Error(`findLeadsInSequence failed: ${error.message}`);
    for (const row of (data ?? []) as unknown as { lead_id: string }[]) inSequence.add(row.lead_id);
  }
  return inSequence;
}

export function estimateExtraDays(willEnroll: number, remainingToday: number, dailyCap: number): number {
  if (willEnroll <= remainingToday || dailyCap <= 0) return 0;
  return Math.ceil((willEnroll - Math.max(0, remainingToday)) / dailyCap);
}

function sampleName(row: AudienceRow): string {
  const lead = row.lead as { first_name?: string | null; last_name?: string | null };
  return `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim() || "Unnamed lead";
}

/**
 * Resolves the audience and works out, per lead, whether it would be enrolled or skipped (and why). Writes
 * nothing — the preview shows `plan.preview`, and Start saves `plan.items`.
 */
export async function planBulkEnroll(
  auth: AuthContext,
  source: BulkSource,
  clients: ResolveAudienceClients
): Promise<{ ok: true; plan: BulkPlan } | { ok: false; errors: Record<string, string[]> }> {
  const resolved = await resolveSource(auth, source, clients);
  if ("ok" in resolved && resolved.ok === false) return { ok: false, errors: resolved.errors };
  const r = resolved as Exclude<typeof resolved, { ok: false }>;

  const inSequence = await findLeadsInSequence(clients.db, r.sendable.map((row) => row.leadId));

  const items: PlannedItem[] = [];
  const enrollable: AudienceRow[] = [];
  for (const row of r.sendable) {
    if (inSequence.has(row.leadId)) {
      items.push({ leadId: row.leadId, outcome: "skipped", reason: "already_in_sequence" });
    } else {
      items.push({ leadId: row.leadId, outcome: "pending", reason: null });
      enrollable.push(row);
    }
  }
  for (const row of r.suppressed) items.push({ leadId: row.leadId, outcome: "skipped", reason: "suppressed" });
  for (const row of r.excludedRows) {
    items.push({ leadId: row.leadId, outcome: "skipped", reason: EXCLUDED_REASON[row.reason] ?? "no_email" });
  }

  const cap = await getDailyCapStatus(clients.db);
  const willEnroll = enrollable.length;

  return {
    ok: true,
    plan: {
      items,
      preview: {
        matched: r.matched,
        notVisible: r.notVisible,
        willEnroll,
        skipped: {
          noEmail: r.excluded.noEmail,
          malformedEmail: r.excluded.malformed,
          duplicateEmail: r.excluded.duplicate,
          suppressed: r.excluded.suppressed,
          alreadyInSequence: r.sendable.length - willEnroll,
        },
        overLimit: willEnroll > BULK_ENROLL_MAX_LEADS,
        limit: BULK_ENROLL_MAX_LEADS,
        confirmFrom: BULK_ENROLL_CONFIRM_FROM,
        cap: { dailyCap: cap.dailyCap, sentToday: cap.sentToday, remaining: cap.remaining },
        estimatedExtraDays: estimateExtraDays(willEnroll, cap.remaining, cap.dailyCap),
        sandbox: isEmailOutboundSandbox(),
        sendingEnabled: await isBulkEmailEnabledForTenant(auth.tenantId),
        sampleNames: enrollable.slice(0, 3).map(sampleName),
      },
    },
  };
}

export interface StartInput {
  sequenceId: string;
  source: BulkSource;
  conflictPolicy: ConflictPolicy;
  plan: BulkPlan;
}

const ITEM_INSERT_CHUNK = 1000;

/** Saves the run + one item per lead. Returns the run id; the worker takes it from here. */
export async function createBulkEnrollRun(
  db: ScopedClient,
  auth: Pick<AuthContext, "userId" | "tenantId">,
  input: StartInput
): Promise<string> {
  const { plan } = input;
  const skipped = plan.items.filter((i) => i.outcome === "skipped").length;

  const { data: run, error } = await db
    .from("sequence_bulk_enrollments")
    .insert({
      sequence_id: input.sequenceId,
      created_by: auth.userId,
      source_mode: input.source.mode,
      source_snapshot: input.source.mode === "filter" ? input.source.tree : { lead_ids: input.source.leadIds.length },
      conflict_policy: input.conflictPolicy,
      status: "queued",
      total_count: plan.preview.willEnroll,
      skipped_count: skipped,
    })
    .select("id")
    .single();
  if (error || !run) throw new Error(`Failed to create bulk enrollment run: ${error?.message ?? "no row"}`);
  const runId = (run as unknown as { id: string }).id;

  for (let i = 0; i < plan.items.length; i += ITEM_INSERT_CHUNK) {
    const rows = plan.items.slice(i, i + ITEM_INSERT_CHUNK).map((item) => ({
      run_id: runId,
      lead_id: item.leadId,
      outcome: item.outcome,
      reason: item.reason,
      processed_at: item.outcome === "skipped" ? new Date().toISOString() : null,
    }));
    const { error: itemsError } = await db.from("sequence_bulk_enrollment_items").insert(rows);
    if (itemsError) {
      // Never leave a half-saved run for the worker to pick up.
      await db.from("sequence_bulk_enrollments").update({ status: "failed", error: "Could not save the list of leads" }).eq("id", runId);
      throw new Error(`Failed to save bulk enrollment items: ${itemsError.message}`);
    }
  }
  return runId;
}

/** Asks the worker to stop. A queued run is cancelled on its next pass; a running one between chunks. */
export async function requestCancel(db: ScopedClient, runId: string): Promise<boolean> {
  const { data, error } = await db
    .from("sequence_bulk_enrollments")
    .update({ cancel_requested: true })
    .eq("id", runId)
    .in("status", ["queued", "running"])
    .select("id");
  if (error) throw new Error(`requestCancel failed: ${error.message}`);
  return !!data && data.length > 0;
}

const CSV_HEADER = "lead_id,reason";

/** The skipped / failed leads of a run, as CSV (lead_id, reason). */
export function skippedItemsToCsv(items: { lead_id: string; outcome: string; reason: string | null }[]): string {
  const lines = items
    .filter((i) => i.outcome === "skipped" || i.outcome === "failed")
    .map((i) => `${i.lead_id},${csvCell(i.outcome === "failed" ? `failed: ${i.reason ?? "unknown"}` : (i.reason ?? ""))}`);
  return [CSV_HEADER, ...lines].join("\n") + "\n";
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Shape-checks the body shared by preview and start: `{ sequence_id, source }`. */
export function parseBulkBody(
  body: Record<string, unknown>
): { ok: true; sequenceId: string; source: BulkSource } | { ok: false; errors: Record<string, string[]> } {
  const errors: Record<string, string[]> = {};

  const sequenceId = typeof body.sequence_id === "string" ? body.sequence_id : "";
  if (!UUID_RE.test(sequenceId)) errors.sequence_id = ["sequence_id must be a uuid"];

  const raw = body.source as Record<string, unknown> | undefined;
  let source: BulkSource | null = null;
  if (!raw || typeof raw !== "object") {
    errors.source = ["source is required"];
  } else if (raw.mode === "selected") {
    const ids = raw.lead_ids;
    if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === "string" && UUID_RE.test(id))) {
      errors.source = ["source.lead_ids must be a non-empty array of uuids"];
    } else if (ids.length > BULK_ENROLL_MAX_LEADS) {
      errors.source = [`At most ${BULK_ENROLL_MAX_LEADS} leads per run`];
    } else {
      source = { mode: "selected", leadIds: ids as string[] };
    }
  } else if (raw.mode === "filter") {
    const parsed = filterTreeSchema.safeParse(raw.tree);
    if (!parsed.success) {
      errors.source = [parsed.error.issues.map((i) => i.message).join("; ") || "invalid filter tree"];
    } else {
      source = { mode: "filter", tree: parsed.data };
    }
  } else {
    errors.source = ['source.mode must be "selected" or "filter"'];
  }

  if (Object.keys(errors).length > 0 || !source) return { ok: false, errors };
  return { ok: true, sequenceId, source };
}
