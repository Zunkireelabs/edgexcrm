import type { AuthContext } from "@/lib/api/auth";
import type { FilterTree } from "@/lib/filters/types";
import { filterTreeSchema } from "@/lib/filters/schema";
import type { ScopedClient } from "@/lib/supabase/scoped";
import {
  resolveAudience as resolveEmailAudience,
  resolveAudienceForLeadIds as resolveEmailAudienceForLeadIds,
  type ResolveAudienceClients,
} from "@/lib/email/outbound/audience";
import { resolveAudience as resolveSmsAudience, resolveAudienceForLeadIds as resolveSmsAudienceForLeadIds } from "@/lib/sms/audience";
import { getDailyCapStatus } from "@/lib/email/outbound/cap";
import { isBulkEmailEnabledForTenant, isEmailOutboundSandbox } from "@/lib/email/outbound/flag";
import { isSmsEnabledForTenant, isSmsSandbox } from "@/lib/sms/flag";
import { loadTenantSmsSettings } from "@/lib/sms/settings";
import { composeRecipientMessage, type TenantSmsSettingsRow } from "@/lib/sms/compose";
import { renderTemplate } from "@/lib/email/render-template";
import type { Lead } from "@/types/database";
import type { OutreachChannel } from "./channel";

// Bulk enroll (OUTREACH-BULK-ENROLL-BRIEF.md) — resolve an audience, show what WOULD happen (preview, no
// writes), then on Start save one row per lead (sequence_bulk_enrollment_items) so a background worker
// (bulk-enroll-runner.ts) can enroll them in chunks, restart-safe and idempotent.
//
// Resolution happens in the REQUEST (here), not in the worker: own/branch-scope callers' visibility comes from
// a real user-authenticated client (leads_visible_to_user() fails closed for a service-role client), which
// only exists while the request does. The worker then only reads the saved rows.

// Channels (migration 274): a run enrolls into ONE sequence, and that sequence is email OR SMS. The channel decides who
// counts as contactable (an email address vs a valid Nepal mobile number), which do-not-contact list applies, which
// running enrollments count as "already in a sequence" (only the SAME channel's), and what the preview warns about
// (the daily email cap vs SMS credits). Everything after the plan (saving the items, the worker) is channel-neutral.

/** One run can enroll at most this many leads. */
export const BULK_ENROLL_MAX_LEADS = 10_000;
/** From this many leads up the rep must type a confirmation word before Start. */
export const BULK_ENROLL_CONFIRM_FROM = 100;
/**
 * What to do with a lead that is already in a running sequence (a lead can be in only one):
 *   skip   leave them where they are
 *   switch end their current enrollment and enroll them in this sequence
 *   queue  start this sequence automatically when their current one ends ("Queue next")
 */
export const SUPPORTED_CONFLICT_POLICIES = ["skip", "switch", "queue"] as const;
export type ConflictPolicy = (typeof SUPPORTED_CONFLICT_POLICIES)[number];

export type BulkSource = { mode: "selected"; leadIds: string[] } | { mode: "filter"; tree: FilterTree };

export type SkipReason =
  | "no_email"
  | "malformed_email"
  | "duplicate_email"
  | "no_phone"
  | "foreign_number"
  | "malformed_phone"
  | "duplicate_phone"
  | "suppressed"
  | "already_in_sequence"
  | "already_in_this_sequence"
  | "queued_next"
  | "already_queued"
  | "lead_deleted"
  | "cancelled";

/** SMS-only part of the preview: what the texts will cost against the tenant's credits. */
export interface SmsEnrollPreview {
  /** Credits the FIRST text of every lead that would be enrolled needs (the sender label + opt-out footer are included). */
  creditsFirstStep: number;
  /** Credits every text of every step needs, if all of them are sent. */
  creditsAllSteps: number;
  stepCount: number;
  balance: number;
  /** balance covers the first texts / the whole run */
  sufficientFirstStep: boolean;
  sufficientAllSteps: boolean;
}

export interface BulkEnrollPreview {
  channel: OutreachChannel;
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
    noPhone: number;
    foreignNumber: number;
    malformedPhone: number;
    duplicatePhone: number;
    suppressed: number;
    /** In a running sequence and left alone: always the ones already in THIS sequence, plus the others when the policy is skip. */
    alreadyInSequence: number;
  };
  /** The policy this preview was computed for. */
  conflictPolicy: ConflictPolicy;
  /** Leads that are in a running sequence OTHER than this one — the ones the policy decides about. */
  inOtherSequence: number;
  /** Of `willEnroll`, how many replace a running enrollment (policy switch). */
  willSwitch: number;
  /** Of `willEnroll`, how many are parked to start when their current sequence ends (policy queue). */
  willQueue: number;
  overLimit: boolean;
  limit: number;
  confirmFrom: number;
  /** EMAIL only meaningful: the daily send cap (zeros for SMS, which is limited by credits instead). */
  cap: { dailyCap: number; sentToday: number; remaining: number };
  /** Rough whole days until the daily cap has released every first email (0 when it all fits today, always 0 for SMS). */
  estimatedExtraDays: number;
  /** Email: the email sandbox. SMS: the SMS sandbox. */
  sandbox: boolean;
  /** Email: the tenant's bulk-email grant. SMS: SMS enabled for the tenant. */
  sendingEnabled: boolean;
  /** Present for SMS sequences only. */
  sms: SmsEnrollPreview | null;
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

interface AudienceLite {
  leadId: string;
  lead: Record<string, unknown>;
}

/** The two channels' audiences, in one shape: who is contactable, who is on the do-not-contact list, who was left out and why. */
interface ResolvedSource {
  matched: number;
  notVisible: number;
  sendable: AudienceLite[];
  suppressed: AudienceLite[];
  /** per reason counts, by the SAME names the preview's `skipped` block uses */
  excluded: { noContact: number; foreign: number; malformed: number; suppressed: number; duplicate: number };
  excludedRows: { leadId: string; reason: SkipReason }[];
}

// The core's per-lead reason is the adapter's own key, and "malformed" / "duplicate" mean different things per channel,
// so each channel has its own map to a SkipReason.
const EMAIL_EXCLUDED_REASON: Record<string, SkipReason> = {
  noEmail: "no_email",
  malformed: "malformed_email",
  duplicate: "duplicate_email",
};
const SMS_EXCLUDED_REASON: Record<string, SkipReason> = {
  noPhone: "no_phone",
  foreignNumber: "foreign_number",
  malformed: "malformed_phone",
  duplicate: "duplicate_phone",
};

async function resolveSource(
  auth: AuthContext,
  source: BulkSource,
  clients: ResolveAudienceClients,
  channel: OutreachChannel
): Promise<ResolvedSource | { ok: false; errors: Record<string, string[]> }> {
  const reasons = channel === "sms" ? SMS_EXCLUDED_REASON : EMAIL_EXCLUDED_REASON;
  const fallback: SkipReason = channel === "sms" ? "no_phone" : "no_email";
  const mapRows = (rows: { leadId: string; reason: string }[] | undefined) =>
    (rows ?? []).map((r) => ({ leadId: r.leadId, reason: reasons[r.reason] ?? fallback }));

  if (source.mode === "selected") {
    if (channel === "sms") {
      const r = await resolveSmsAudienceForLeadIds(auth, source.leadIds, clients);
      return {
        matched: r.audience.matched,
        notVisible: Math.max(0, r.requested - r.audience.matched),
        sendable: r.audience.sendable,
        suppressed: r.audience.suppressed,
        excluded: {
          noContact: r.audience.excluded.noPhone,
          foreign: r.audience.excluded.foreignNumber,
          malformed: r.audience.excluded.malformed,
          suppressed: r.audience.excluded.suppressed,
          duplicate: r.audience.excluded.duplicatePhone,
        },
        excludedRows: mapRows(r.audience.excludedRows),
      };
    }
    const r = await resolveEmailAudienceForLeadIds(auth, source.leadIds, clients);
    return {
      matched: r.audience.matched,
      notVisible: Math.max(0, r.requested - r.audience.matched),
      sendable: r.audience.sendable,
      suppressed: r.audience.suppressed,
      excluded: {
        noContact: r.audience.excluded.noEmail,
        foreign: 0,
        malformed: r.audience.excluded.malformed,
        suppressed: r.audience.excluded.suppressed,
        duplicate: r.audience.excluded.duplicate,
      },
      excludedRows: mapRows(r.audience.excludedRows),
    };
  }

  if (channel === "sms") {
    const r = await resolveSmsAudience(auth, source.tree, clients);
    if (!r.ok) return { ok: false, errors: r.errors };
    return {
      matched: r.audience.matched,
      notVisible: 0,
      sendable: r.audience.sendable,
      suppressed: r.audience.suppressed,
      excluded: {
        noContact: r.audience.excluded.noPhone,
        foreign: r.audience.excluded.foreignNumber,
        malformed: r.audience.excluded.malformed,
        suppressed: r.audience.excluded.suppressed,
        duplicate: r.audience.excluded.duplicatePhone,
      },
      excludedRows: mapRows(r.audience.excludedRows),
    };
  }
  const r = await resolveEmailAudience(auth, source.tree, clients);
  if (!r.ok) return { ok: false, errors: r.errors };
  return {
    matched: r.audience.matched,
    notVisible: 0,
    sendable: r.audience.sendable,
    suppressed: r.audience.suppressed,
    excluded: {
      noContact: r.audience.excluded.noEmail,
      foreign: 0,
      malformed: r.audience.excluded.malformed,
      suppressed: r.audience.excluded.suppressed,
      duplicate: r.audience.excluded.duplicateEmail,
    },
    excludedRows: mapRows(r.audience.excludedRows),
  };
}

/**
 * lead id -> the sequence they are currently running (active / paused) ON THIS CHANNEL, for the ids that have one. A lead
 * in an email sequence is not "in a sequence" for an SMS run, and the other way round (migration 274). Chunked so the URL
 * stays short.
 */
export async function findLeadsInSequence(
  db: ScopedClient,
  leadIds: string[],
  channel: OutreachChannel = "email"
): Promise<Map<string, string>> {
  const inSequence = new Map<string, string>();
  for (let i = 0; i < leadIds.length; i += 200) {
    const { data, error } = await db
      .from("sequence_enrollments")
      .select("lead_id, sequence_id")
      .in("lead_id", leadIds.slice(i, i + 200))
      .eq("channel", channel)
      .in("status", ["active", "paused"]);
    if (error) throw new Error(`findLeadsInSequence failed: ${error.message}`);
    for (const row of (data ?? []) as unknown as { lead_id: string; sequence_id: string }[]) {
      inSequence.set(row.lead_id, row.sequence_id);
    }
  }
  return inSequence;
}

export function estimateExtraDays(willEnroll: number, remainingToday: number, dailyCap: number): number {
  if (willEnroll <= remainingToday || dailyCap <= 0) return 0;
  return Math.ceil((willEnroll - Math.max(0, remainingToday)) / dailyCap);
}

function sampleName(row: AudienceLite): string {
  const lead = row.lead as { first_name?: string | null; last_name?: string | null };
  return `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim() || "Unnamed lead";
}

// A real opt-out token is always 10 characters (sms/optout.ts); the preview has no per-lead token yet, so a placeholder
// of the same length gives the exact character count — and so the exact credits — the real text will have.
const PLACEHOLDER_OPTOUT_TOKEN = "0000000000";

/**
 * What the texts of a run would cost: for every lead that would be enrolled, each step's message as it will really go out
 * (merge values filled in, sender label + opt-out footer added — credits are always counted on that FINAL string).
 * Pure: no I/O. Exported for tests.
 */
export function estimateSmsCredits(params: {
  settings: TenantSmsSettingsRow;
  stepTemplates: string[];
  leads: Record<string, unknown>[];
  tenantName: string;
}): { creditsFirstStep: number; creditsAllSteps: number } {
  const { settings, stepTemplates, leads, tenantName } = params;
  let creditsFirstStep = 0;
  let creditsAllSteps = 0;
  for (const lead of leads) {
    stepTemplates.forEach((template, index) => {
      const text = renderTemplate(template, { lead: lead as unknown as Lead, tenant: { name: tenantName } });
      const credits = composeRecipientMessage(settings, text, { lead }, PLACEHOLDER_OPTOUT_TOKEN).segments.credits;
      creditsAllSteps += credits;
      if (index === 0) creditsFirstStep += credits;
    });
  }
  return { creditsFirstStep, creditsAllSteps };
}

async function buildSmsPreview(
  db: ScopedClient,
  tenantId: string,
  sequenceId: string | undefined,
  enrollable: AudienceLite[]
): Promise<SmsEnrollPreview> {
  const [{ data: stepRows }, settings, { data: account }, { data: tenant }] = await Promise.all([
    sequenceId
      ? db.from("email_sequence_steps").select("step_order, body_template").eq("sequence_id", sequenceId).order("step_order", { ascending: true })
      : Promise.resolve({ data: [] as unknown[] }),
    loadTenantSmsSettings(db),
    db.from("sms_credit_accounts").select("balance").maybeSingle(),
    db.fromGlobal("tenants").select("name").eq("id", tenantId).maybeSingle(),
  ]);
  const stepTemplates = ((stepRows ?? []) as unknown as { body_template: string }[]).map((r) => r.body_template ?? "");
  const { creditsFirstStep, creditsAllSteps } = estimateSmsCredits({
    settings,
    stepTemplates,
    leads: enrollable.map((row) => row.lead),
    tenantName: (tenant as { name?: string } | null)?.name ?? "",
  });
  const balance = (account as { balance?: number } | null)?.balance ?? 0;
  return {
    creditsFirstStep,
    creditsAllSteps,
    stepCount: stepTemplates.length,
    balance,
    sufficientFirstStep: balance >= creditsFirstStep,
    sufficientAllSteps: balance >= creditsAllSteps,
  };
}

/**
 * Resolves the audience and works out, per lead, whether it would be enrolled or skipped (and why). Writes
 * nothing — the preview shows `plan.preview`, and Start saves `plan.items`.
 */
export async function planBulkEnroll(
  auth: AuthContext,
  source: BulkSource,
  clients: ResolveAudienceClients,
  opts: { sequenceId?: string; conflictPolicy?: ConflictPolicy; channel?: OutreachChannel } = {}
): Promise<{ ok: true; plan: BulkPlan } | { ok: false; errors: Record<string, string[]> }> {
  const channel: OutreachChannel = opts.channel ?? "email";
  const resolved = await resolveSource(auth, source, clients, channel);
  if ("ok" in resolved && resolved.ok === false) return { ok: false, errors: resolved.errors };
  const r = resolved as ResolvedSource;

  const policy: ConflictPolicy = opts.conflictPolicy ?? "skip";
  // Only the SAME channel's running enrollments make a lead "already in a sequence" (migration 274).
  const inSequence = await findLeadsInSequence(clients.db, r.sendable.map((row) => row.leadId), channel);

  const items: PlannedItem[] = [];
  const enrollable: AudienceLite[] = [];
  let inOtherSequence = 0;
  let inThisSequence = 0;
  for (const row of r.sendable) {
    const current = inSequence.get(row.leadId);
    if (current === undefined) {
      items.push({ leadId: row.leadId, outcome: "pending", reason: null });
      enrollable.push(row);
    } else if (opts.sequenceId && current === opts.sequenceId) {
      // already running THIS sequence: switching / queueing would only restart them — leave them alone
      inThisSequence++;
      items.push({ leadId: row.leadId, outcome: "skipped", reason: "already_in_this_sequence" });
    } else {
      inOtherSequence++;
      if (policy === "skip") {
        items.push({ leadId: row.leadId, outcome: "skipped", reason: "already_in_sequence" });
      } else {
        // switch / queue: the worker handles the conflict when it reaches this lead
        items.push({ leadId: row.leadId, outcome: "pending", reason: null });
        enrollable.push(row);
      }
    }
  }
  for (const row of r.suppressed) items.push({ leadId: row.leadId, outcome: "skipped", reason: "suppressed" });
  for (const row of r.excludedRows) items.push({ leadId: row.leadId, outcome: "skipped", reason: row.reason });

  const willEnroll = enrollable.length;
  const isSms = channel === "sms";

  // EMAIL is paced by the daily send cap; SMS has no daily cap (credits are the limit, see `sms`).
  const cap = isSms ? { dailyCap: 0, sentToday: 0, remaining: 0 } : await getDailyCapStatus(clients.db);

  return {
    ok: true,
    plan: {
      items,
      preview: {
        channel,
        matched: r.matched,
        notVisible: r.notVisible,
        willEnroll,
        skipped: {
          noEmail: isSms ? 0 : r.excluded.noContact,
          malformedEmail: isSms ? 0 : r.excluded.malformed,
          duplicateEmail: isSms ? 0 : r.excluded.duplicate,
          noPhone: isSms ? r.excluded.noContact : 0,
          foreignNumber: isSms ? r.excluded.foreign : 0,
          malformedPhone: isSms ? r.excluded.malformed : 0,
          duplicatePhone: isSms ? r.excluded.duplicate : 0,
          suppressed: r.excluded.suppressed,
          alreadyInSequence: inThisSequence + (policy === "skip" ? inOtherSequence : 0),
        },
        conflictPolicy: policy,
        inOtherSequence,
        willSwitch: policy === "switch" ? inOtherSequence : 0,
        willQueue: policy === "queue" ? inOtherSequence : 0,
        overLimit: willEnroll > BULK_ENROLL_MAX_LEADS,
        limit: BULK_ENROLL_MAX_LEADS,
        confirmFrom: BULK_ENROLL_CONFIRM_FROM,
        cap: { dailyCap: cap.dailyCap, sentToday: cap.sentToday, remaining: cap.remaining },
        estimatedExtraDays: isSms ? 0 : estimateExtraDays(willEnroll, cap.remaining, cap.dailyCap),
        sandbox: isSms ? isSmsSandbox() : isEmailOutboundSandbox(),
        sendingEnabled: isSms ? await isSmsEnabledForTenant(auth.tenantId) : await isBulkEmailEnabledForTenant(auth.tenantId),
        sms: isSms ? await buildSmsPreview(clients.db, auth.tenantId, opts.sequenceId, enrollable) : null,
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
