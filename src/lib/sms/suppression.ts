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

// One query per batch, never one per recipient — a 4,000-person blast must
// not issue 4,000 suppression lookups.
export async function loadSuppressedPhones(
  db: ScopedClient,
  tenantId: string,
  phonesE164: string[]
): Promise<Set<string>> {
  if (phonesE164.length === 0) return new Set();

  const { data, error } = await db
    .from("sms_suppressions")
    .select("phone_e164")
    .in("phone_e164", phonesE164);

  if (error) {
    throw new Error(`loadSuppressedPhones: failed to load suppressions for tenant ${tenantId}: ${error.message}`);
  }

  return new Set((data ?? []).map((row) => (row as unknown as SuppressionRow).phone_e164));
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
