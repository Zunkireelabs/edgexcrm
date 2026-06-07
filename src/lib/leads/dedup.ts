import type { createServiceClient } from "@/lib/supabase/server";
import type { Lead } from "@/types/database";
import { createAuditLog, emitEvent } from "@/lib/api/audit";

type SupabaseServiceClient = Awaited<ReturnType<typeof createServiceClient>>;

// ── Normalisation ──────────────────────────────────────────────────────────

export function normalizeEmail(raw: string | null | undefined): string | null {
  return raw?.trim().toLowerCase() || null;
}

// Produces "+<digits>" for suggestions-only phone matching.
// Never used for auto-merge — only to find candidates for lead_duplicate_suggestions.
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 7) return null;
  return `+${digits}`;
}

// ── Identity resolution ────────────────────────────────────────────────────

export interface ResolveIdentityParams {
  tenantId: string;
  normalizedEmail: string | null;
  normalizedPhone: string | null;
}

export interface ResolvedIdentity {
  match: "none" | "email";
  existingLead: Lead | null;
  // Lead IDs whose stored phone shares the same trailing digits as the incoming
  // phone. Caller writes lead_duplicate_suggestions for these — never auto-merged.
  phoneMatchLeadIds: string[];
}

export async function resolveLeadIdentity(
  supabase: SupabaseServiceClient,
  params: ResolveIdentityParams
): Promise<ResolvedIdentity> {
  const { tenantId, normalizedEmail, normalizedPhone } = params;

  // Email match — uses the generated normalized_email column; oldest = canonical
  if (normalizedEmail) {
    const { data: emailMatch } = await supabase
      .from("leads")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("normalized_email", normalizedEmail)
      .is("deleted_at", null)
      .eq("is_final", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (emailMatch) {
      return { match: "email", existingLead: emailMatch as Lead, phoneMatchLeadIds: [] };
    }
  }

  // Phone match (suggestion candidates only — NOT auto-merge).
  // leads lacks a normalized_phone column in Phase A, so we do a trailing-digits
  // LIKE against the stored "+CC-LOCALNUM" format (e.g. "+977-9876543210").
  // Using the last 10 digits catches local numbers across all country-code lengths.
  let phoneMatchLeadIds: string[] = [];
  if (normalizedPhone) {
    const allDigits = normalizedPhone.replace(/\D/g, "");
    const suffix = allDigits.length >= 10 ? allDigits.slice(-10) : allDigits;
    if (suffix.length >= 7) {
      const { data: phoneMatches } = await supabase
        .from("leads")
        .select("id")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .eq("is_final", true)
        .like("phone", `%${suffix}`);

      if (phoneMatches) {
        phoneMatchLeadIds = (phoneMatches as { id: string }[]).map((r) => r.id);
      }
    }
  }

  return { match: "none", existingLead: null, phoneMatchLeadIds };
}

// ── Canonical update patch ─────────────────────────────────────────────────

// Fields that are never overwritten on the canonical lead.
// First-touch attribution wins for stage, owner, pipeline, and intake.
const PROTECTED = new Set([
  "stage_id",
  "status",
  "assigned_to",
  "pipeline_id",
  "display_id",
  "converted_at",
  "intake_source",
  "intake_medium",
  "intake_campaign",
]);

export interface IncomingLeadFields {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  city?: string | null;
  country?: string | null;
  preferred_contact_method?: string | null;
  entity_id?: string | null;
  custom_fields?: Record<string, unknown>;
  file_urls?: Record<string, unknown>;
  tags?: string[];
}

// Returns only the keys that would actually change — empty object = no update needed.
// Fill-empty: scalars only written to canonical if the canonical value is null/empty.
// JSONB fields (custom_fields, file_urls): existing keys win — never drops data.
// tags: union — new tags added, existing never removed.
export function applyCanonicalUpdate(
  existing: Lead,
  incoming: IncomingLeadFields
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};

  const SCALAR_FIELDS = [
    "first_name",
    "last_name",
    "email",
    "phone",
    "city",
    "country",
    "preferred_contact_method",
    "entity_id",
  ] as const;

  for (const field of SCALAR_FIELDS) {
    if (PROTECTED.has(field)) continue;
    const incoming_val = incoming[field];
    const existing_val = existing[field as keyof Lead];
    if (incoming_val && !existing_val) {
      patch[field] = incoming_val;
    }
  }

  // custom_fields: incoming keys fill gaps; existing keys are authoritative
  if (incoming.custom_fields && Object.keys(incoming.custom_fields).length > 0) {
    const merged = { ...incoming.custom_fields, ...existing.custom_fields };
    if (JSON.stringify(merged) !== JSON.stringify(existing.custom_fields)) {
      patch.custom_fields = merged;
    }
  }

  // file_urls: same merge — never drop an uploaded file
  if (incoming.file_urls && Object.keys(incoming.file_urls).length > 0) {
    const merged = { ...incoming.file_urls, ...existing.file_urls };
    if (JSON.stringify(merged) !== JSON.stringify(existing.file_urls)) {
      patch.file_urls = merged;
    }
  }

  // tags: union
  if (incoming.tags && incoming.tags.length > 0) {
    const merged = Array.from(new Set([...(existing.tags ?? []), ...incoming.tags]));
    if (merged.length !== (existing.tags ?? []).length) {
      patch.tags = merged;
    }
  }

  return patch;
}

// ── Record submission ──────────────────────────────────────────────────────

export interface RecordSubmissionParams {
  tenantId: string;
  leadId: string;
  formConfigId?: string | null;
  sessionId?: string | null;
  createdVia: "public_form" | "public_api" | "integration" | "manual" | "backfill";
  idempotencyKey?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  city?: string | null;
  country?: string | null;
  normalizedEmail?: string | null;
  normalizedPhone?: string | null;
  customFields?: Record<string, unknown>;
  fileUrls?: Record<string, unknown>;
  intakeSource?: string | null;
  intakeMedium?: string | null;
  intakeCampaign?: string | null;
  entityId?: string | null;
  rawPayload: Record<string, unknown>;
  matchedExisting: boolean;
  createdAt?: string;
}

// Writes one immutable row to lead_submissions and returns its id.
// Must be called with the raw service client (not scopedClient) because
// all three ingestion paths use createServiceClient() directly.
export async function recordSubmission(
  supabase: SupabaseServiceClient,
  params: RecordSubmissionParams
): Promise<string> {
  const { data, error } = await supabase
    .from("lead_submissions")
    .insert({
      tenant_id: params.tenantId,
      lead_id: params.leadId,
      form_config_id: params.formConfigId ?? null,
      session_id: params.sessionId ?? null,
      created_via: params.createdVia,
      idempotency_key: params.idempotencyKey ?? null,
      first_name: params.firstName ?? null,
      last_name: params.lastName ?? null,
      email: params.email ?? null,
      phone: params.phone ?? null,
      city: params.city ?? null,
      country: params.country ?? null,
      normalized_email: params.normalizedEmail ?? null,
      normalized_phone: params.normalizedPhone ?? null,
      custom_fields: params.customFields ?? {},
      file_urls: params.fileUrls ?? {},
      intake_source: params.intakeSource ?? null,
      intake_medium: params.intakeMedium ?? null,
      intake_campaign: params.intakeCampaign ?? null,
      entity_id: params.entityId ?? null,
      raw_payload: params.rawPayload,
      matched_existing: params.matchedExisting,
      ...(params.createdAt && { created_at: params.createdAt }),
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`recordSubmission failed: ${error?.message ?? "no data returned"}`);
  }

  return (data as { id: string }).id;
}

// ── Form name resolution + submission audit ────────────────────────────────

// Resolves a form's display name (null-safe) for timeline labels.
export async function resolveFormName(
  supabase: SupabaseServiceClient,
  formConfigId: string | null | undefined
): Promise<string | null> {
  if (!formConfigId) return null;
  const { data } = await supabase.from("form_configs").select("name").eq("id", formConfigId).maybeSingle();
  return (data as { name: string } | null)?.name ?? null;
}

// Emits the lead.submission AUDIT (what the timeline reads) + event, consistently.
// formName must already be resolved by the caller (so we don't double-query).
export async function emitSubmissionAudit(
  _supabase: SupabaseServiceClient,
  params: {
    tenantId: string;
    leadId: string;
    submissionId: string | null;
    isFirst: boolean;
    matchedExisting: boolean;
    formName: string | null;
    requestId?: string;
    ipAddress?: string | null;
    userAgent?: string | null;
    createdAt?: string;
  }
): Promise<void> {
  await Promise.all([
    createAuditLog({
      tenantId: params.tenantId,
      action: "lead.submission",
      entityType: "lead",
      entityId: params.leadId,
      changes: {
        submission_id: { old: null, new: params.submissionId },
        is_first: { old: null, new: params.isFirst },
        matched_existing: { old: null, new: params.matchedExisting },
        form_name: { old: null, new: params.formName },
      },
      ipAddress: params.ipAddress ?? undefined,
      userAgent: params.userAgent ?? undefined,
      requestId: params.requestId,
      createdAt: params.createdAt,
    }),
    emitEvent({
      tenantId: params.tenantId,
      type: "lead.submission",
      entityType: "lead",
      entityId: params.leadId,
      payload: {
        submission_id: params.submissionId,
        is_first: params.isFirst,
        matched_existing: params.matchedExisting,
        form_name: params.formName,
      },
      requestId: params.requestId,
    }),
  ]);
}

// ── Touch last_activity_at ─────────────────────────────────────────────────

// Forward-only bump: only updates if the stored value is older than `at` (or now()).
// Called at every form-submission site — never for edits, status changes, or logged calls.
export async function touchLastActivity(
  supabase: SupabaseServiceClient,
  { leadId, tenantId, at }: { leadId: string; tenantId: string; at?: string }
): Promise<void> {
  const ts = at ?? new Date().toISOString();
  await supabase
    .from("leads")
    .update({ last_activity_at: ts })
    .eq("id", leadId)
    .eq("tenant_id", tenantId)
    .lt("last_activity_at", ts);
}

// ── Record duplicate suggestions ───────────────────────────────────────────

// Upserts open phone-duplicate suggestions. Non-fatal; caller wraps in try/catch.
// onConflict DO NOTHING so a previously dismissed pair never resurfaces.
export async function recordDuplicateSuggestions(
  supabase: SupabaseServiceClient,
  params: { tenantId: string; leadId: string; suggestedLeadIds: string[]; reason: "phone" | "name" }
): Promise<void> {
  const rows = params.suggestedLeadIds
    .filter((sid) => sid !== params.leadId)
    .map((sid) => ({
      tenant_id: params.tenantId,
      lead_id: params.leadId,
      suggested_lead_id: sid,
      reason: params.reason,
      status: "open",
    }));
  if (rows.length === 0) return;
  await supabase
    .from("lead_duplicate_suggestions")
    .upsert(rows, { onConflict: "tenant_id,lead_id,suggested_lead_id", ignoreDuplicates: true });
}
