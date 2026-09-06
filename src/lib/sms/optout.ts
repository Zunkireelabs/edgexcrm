import { randomBytes } from "crypto";
import type { ScopedClient } from "@/lib/supabase/scoped";
import { fetchAllRows, type PageResult } from "@/lib/supabase/paginate";

// Public, unauthenticated opt-out links. One STABLE token per (tenant, phone) —
// see sms_optout_tokens' migration comment (204) for why: it keeps the SMS
// footer short (every character is billed) and lets someone opt out from a
// message sent months ago. The link must keep working after it's used once.

const TOKEN_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const TOKEN_LENGTH = 10;

export function generateOptOutToken(): string {
  const bytes = randomBytes(TOKEN_LENGTH);
  let token = "";
  for (let i = 0; i < TOKEN_LENGTH; i++) {
    token += TOKEN_ALPHABET[bytes[i] % TOKEN_ALPHABET.length];
  }
  return token;
}

interface OptOutTokenRow {
  token: string;
}

// Race-safe: concurrent blast rendering may call this for the same number at
// the same time. INSERT ... ON CONFLICT DO NOTHING then SELECT the winning
// row — never pre-check-then-insert, which races.
export async function getOrCreateOptOutToken(
  db: ScopedClient,
  tenantId: string,
  phoneE164: string,
  leadId: string | null
): Promise<string> {
  const candidate = generateOptOutToken();

  const { error: insertError } = await db
    .from("sms_optout_tokens")
    .upsert(
      { token: candidate, phone_e164: phoneE164, lead_id: leadId },
      { onConflict: "tenant_id,phone_e164", ignoreDuplicates: true }
    );

  if (insertError) {
    throw new Error(`getOrCreateOptOutToken: failed to upsert token: ${insertError.message}`);
  }

  const { data, error: selectError } = await db
    .from("sms_optout_tokens")
    .select("token")
    .eq("phone_e164", phoneE164)
    .single();

  if (selectError || !data) {
    throw new Error(
      `getOrCreateOptOutToken: failed to read back token for tenant ${tenantId}: ${selectError?.message ?? "no row"}`
    );
  }

  return (data as unknown as OptOutTokenRow).token;
}

// Mint chunk: the upsert is a POST body, so ~1,000 is fine — no URL-length
// concern there.
const MINT_CHUNK_SIZE = 1000;

// Read-back chunk: the select-back's `.in("phone_e164", chunk)` filter is
// serialized into the request URL, and phone numbers are long strings, not
// short IDs — this is the exact bug loadSuppressedPhones (suppression.ts)
// already hit and fixed: empirically, a bare +E.164 phone list 414s ("URI
// too long") against local PostgREST between 400-450 entries. Reuse its
// proven-safe 300, not the mint chunk's 1,000 — do not unify these two
// sizes even though it's tempting.
const SELECT_CHUNK_SIZE = 300;

interface OptOutTokenLookupRow {
  phone_e164: string;
  token: string;
}

// Bulk counterpart to getOrCreateOptOutToken — BLAST-F1-F2-FIX-BRIEF.md §F2.
// A blast send used to call getOrCreateOptOutToken once per recipient (an
// insert+select round trip each): 16,000 recipients = 32,000 sequential
// PostgREST calls, which timed out the connection pool locally and, on
// Supabase hosted, starves the app-wide PostgREST pool for every tenant.
// This mints in ~1,000-phone chunks and reads back in ~300-phone chunks
// instead (see the two chunk-size comments above for why they differ) — a
// small, bounded number of round trips instead of one per recipient.
export async function ensureOptOutTokens(
  db: ScopedClient,
  recipients: { phoneE164: string; leadId: string | null }[]
): Promise<Map<string, string>> {
  // Dedupe by phone first — the same phone can appear twice in one audience
  // (e.g. two leads sharing a number), and each dupe would otherwise mint/
  // read the same row redundantly.
  const leadIdByPhone = new Map<string, string | null>();
  for (const r of recipients) {
    if (!leadIdByPhone.has(r.phoneE164)) leadIdByPhone.set(r.phoneE164, r.leadId);
  }
  const phones = Array.from(leadIdByPhone.keys());
  if (phones.length === 0) return new Map();

  // Mint: one upsert per ~1,000-phone chunk. ignoreDuplicates:true is
  // load-bearing — an existing token must NEVER be rewritten. Token
  // stability is the documented contract (see the module comment above /
  // migration 204): a rewritten token breaks opt-out links in messages
  // already delivered. Do not switch this to ignoreDuplicates:false to get
  // a RETURNING — that issues `DO UPDATE SET` on every column on every
  // conflict.
  for (let i = 0; i < phones.length; i += MINT_CHUNK_SIZE) {
    const chunk = phones.slice(i, i + MINT_CHUNK_SIZE);
    const mintRows = chunk.map((phone) => ({
      token: generateOptOutToken(),
      phone_e164: phone,
      lead_id: leadIdByPhone.get(phone) ?? null,
    }));
    const { error: upsertError } = await db
      .from("sms_optout_tokens")
      .upsert(mintRows, { onConflict: "tenant_id,phone_e164", ignoreDuplicates: true });
    if (upsertError) {
      throw new Error(`ensureOptOutTokens: failed to bulk-upsert tokens: ${upsertError.message}`);
    }
  }

  // Read back — insert-then-select, never check-then-insert (same
  // race-safety property as getOrCreateOptOutToken above). Chunked at the
  // smaller SELECT_CHUNK_SIZE for the URL-length reason documented there;
  // fetchAllRows still paginates WITHIN each chunk because a full 300-phone
  // chunk returning exactly 300 rows would otherwise be indistinguishable
  // from PostgREST's own silent 1,000-row cap on an unpaged select — see
  // paginate.ts's header. `token` (not `id`) is this table's primary key —
  // sms_optout_tokens has no surrogate id column (migration 204) — so it's
  // the deterministic ORDER BY the pagination contract requires.
  const tokenByPhone = new Map<string, string>();
  for (let i = 0; i < phones.length; i += SELECT_CHUNK_SIZE) {
    const chunk = phones.slice(i, i + SELECT_CHUNK_SIZE);
    const rows = await fetchAllRows<OptOutTokenLookupRow>(
      (offset, limit) =>
        db
          .from("sms_optout_tokens")
          .select("phone_e164, token")
          .in("phone_e164", chunk)
          .order("token", { ascending: true })
          .range(offset, offset + limit - 1) as unknown as Promise<PageResult<OptOutTokenLookupRow>>,
      SELECT_CHUNK_SIZE
    );
    for (const row of rows) tokenByPhone.set(row.phone_e164, row.token);
  }

  const missing = phones.filter((p) => !tokenByPhone.has(p));
  if (missing.length > 0) {
    throw new Error(`ensureOptOutTokens: failed to read back token(s) for ${missing.length} phone(s) after upsert`);
  }

  return tokenByPhone;
}

export function optOutUrl(token: string): string {
  const base = process.env.SMS_OPTOUT_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/u/${token}`;
}
