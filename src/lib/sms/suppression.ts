import type { ScopedClient } from "@/lib/supabase/scoped";

// The do-not-contact list. Nepal has no DND registry (unlike India's TRAI
// system) — this table is the entire suppression mechanism, not a mirror of
// an external one.

export interface SuppressPhoneParams {
  phoneE164: string;
  reason: "opt_out" | "manual" | "hard_bounce" | "complaint" | "invalid";
  source: string;
  leadId?: string | null;
  createdBy?: string | null;
  note?: string | null;
}

interface SuppressionRow {
  phone_e164: string;
}

// One query PER CHUNK, never one per recipient — a 4,000-person blast must
// not issue 4,000 suppression lookups, but a single unchunked PostgREST `in`
// filter over the whole batch blows the URL length limit at real scale — the
// same bug email's twin (src/lib/email/outbound/suppression.ts,
// loadSuppressedEmails) already fixed, that this file never got despite the
// header above calling them "direct analogues" of each other. Confirmed
// empirically against local PostgREST (2026-09-06, during the "Failed to
// materialize recipient rows" investigation): a bare +E.164 phone list 414s
// ("URI too long") between 400-450 entries. 300 keeps real headroom under
// that boundary rather than shipping a size validated only at the exact
// failure edge — same reasoning as email's CHUNK_SIZE=150 comment.
const CHUNK_SIZE = 300;

export async function loadSuppressedPhones(
  db: ScopedClient,
  tenantId: string,
  phonesE164: string[]
): Promise<Set<string>> {
  if (phonesE164.length === 0) return new Set();

  const suppressed = new Set<string>();
  for (let i = 0; i < phonesE164.length; i += CHUNK_SIZE) {
    const chunk = phonesE164.slice(i, i + CHUNK_SIZE);
    const { data, error } = await db.from("sms_suppressions").select("phone_e164").in("phone_e164", chunk);

    if (error) {
      throw new Error(`loadSuppressedPhones: failed to load suppressions for tenant ${tenantId}: ${error.message}`);
    }
    for (const row of (data ?? []) as unknown as SuppressionRow[]) suppressed.add(row.phone_e164);
  }

  return suppressed;
}

// Idempotent — a repeated suppress for the same (tenant, phone) is a no-op,
// so callers (the opt-out route, admin actions, the send.ts safety net) don't
// need to pre-check.
export async function suppressPhone(db: ScopedClient, tenantId: string, params: SuppressPhoneParams): Promise<void> {
  const { error } = await db.from("sms_suppressions").upsert(
    {
      phone_e164: params.phoneE164,
      reason: params.reason,
      source: params.source,
      lead_id: params.leadId ?? null,
      created_by: params.createdBy ?? null,
      note: params.note ?? null,
    },
    { onConflict: "tenant_id,phone_e164", ignoreDuplicates: true }
  );

  if (error) {
    throw new Error(`suppressPhone: failed to suppress ${params.phoneE164} for tenant ${tenantId}: ${error.message}`);
  }
}
