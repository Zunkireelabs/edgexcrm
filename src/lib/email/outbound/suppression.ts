import type { ScopedClient } from "@/lib/supabase/scoped";

// The do-not-contact list. Direct analogue of src/lib/sms/suppression.ts.

// 500 (SMS's chunk size for phone numbers) is too large for email addresses —
// verified empirically against local PostgREST: 400 emails in one `in` filter
// already 414s ("URI too long"), 300 is fine. 250 leaves headroom for
// longer-than-average real addresses.
const CHUNK_SIZE = 250;

// Stored lowercased and trimmed — the single normalization point (mig 211's
// COMMENT ON COLUMN says the same). Callers must not normalize ad hoc.
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface SuppressEmailParams {
  email: string;
  reason: "unsubscribe" | "hard_bounce" | "complaint" | "manual" | "invalid";
  source: string;
  leadId?: string | null;
  createdBy?: string | null;
  note?: string | null;
}

interface SuppressionRow {
  email: string;
}

// One query PER CHUNK, never one per recipient. A 16,684-recipient blast in a
// single PostgREST `in` filter would blow the URL length limit (the same bug
// that hit assigned-lead filtering — see project_counselor_empty_leads_
// undici_overflow), so this chunks at 500 and unions the sets.
export async function loadSuppressedEmails(
  db: ScopedClient,
  tenantId: string,
  emails: string[]
): Promise<Set<string>> {
  const normalized = [...new Set(emails.map(normalizeEmail))].filter(Boolean);
  if (normalized.length === 0) return new Set();

  const suppressed = new Set<string>();
  for (let i = 0; i < normalized.length; i += CHUNK_SIZE) {
    const chunk = normalized.slice(i, i + CHUNK_SIZE);
    const { data, error } = await db.from("email_suppressions").select("email").in("email", chunk);

    if (error) {
      throw new Error(`loadSuppressedEmails: failed to load suppressions for tenant ${tenantId}: ${error.message}`);
    }

    for (const row of (data ?? []) as unknown as SuppressionRow[]) suppressed.add(row.email);
  }

  return suppressed;
}

// Idempotent — a repeated suppress for the same (tenant, email) is a no-op,
// so callers (the unsubscribe route, the webhook handler, the send.ts safety
// net) never need to pre-check.
export async function suppressEmail(db: ScopedClient, tenantId: string, params: SuppressEmailParams): Promise<void> {
  const { error } = await db.from("email_suppressions").upsert(
    {
      email: normalizeEmail(params.email),
      reason: params.reason,
      source: params.source,
      lead_id: params.leadId ?? null,
      created_by: params.createdBy ?? null,
      note: params.note ?? null,
    },
    { onConflict: "tenant_id,email", ignoreDuplicates: true }
  );

  if (error) {
    throw new Error(`suppressEmail: failed to suppress ${params.email} for tenant ${tenantId}: ${error.message}`);
  }
}
