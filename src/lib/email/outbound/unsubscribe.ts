import { randomBytes } from "crypto";
import type { ScopedClient } from "@/lib/supabase/scoped";
import { fetchAllRows, type PageResult } from "@/lib/supabase/paginate";
import { APP_URL } from "../index";
import { normalizeEmail } from "./suppression";

// Public, unauthenticated unsubscribe links. One STABLE token per (tenant,
// email) — direct analogue of sms_optout_tokens / src/lib/sms/optout.ts, for
// the same reason: someone must be able to unsubscribe from an email sent six
// months ago. The link must keep working after it's used once.

const TOKEN_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const TOKEN_LENGTH = 10;

export function generateUnsubscribeToken(): string {
  const bytes = randomBytes(TOKEN_LENGTH);
  let token = "";
  for (let i = 0; i < TOKEN_LENGTH; i++) {
    token += TOKEN_ALPHABET[bytes[i] % TOKEN_ALPHABET.length];
  }
  return token;
}

interface UnsubscribeTokenRow {
  token: string;
}

// Race-safe: concurrent blast rendering may call this for the same address at
// the same time. INSERT ... ON CONFLICT DO NOTHING then SELECT the winning
// row — never pre-check-then-insert, which races (a blast renders thousands
// of rows concurrently).
export async function getOrCreateUnsubscribeToken(
  db: ScopedClient,
  tenantId: string,
  email: string,
  leadId: string | null
): Promise<string> {
  const normalized = normalizeEmail(email);
  const candidate = generateUnsubscribeToken();

  const { error: insertError } = await db
    .from("email_unsubscribe_tokens")
    .upsert(
      { token: candidate, email: normalized, lead_id: leadId },
      { onConflict: "tenant_id,email", ignoreDuplicates: true }
    );

  if (insertError) {
    throw new Error(`getOrCreateUnsubscribeToken: failed to upsert token: ${insertError.message}`);
  }

  const { data, error: selectError } = await db
    .from("email_unsubscribe_tokens")
    .select("token")
    .eq("email", normalized)
    .single();

  if (selectError || !data) {
    throw new Error(
      `getOrCreateUnsubscribeToken: failed to read back token for tenant ${tenantId}: ${selectError?.message ?? "no row"}`
    );
  }

  return (data as unknown as UnsubscribeTokenRow).token;
}

// Mint chunk: the upsert is a POST body, so ~1,000 is fine — no URL-length
// concern there. Mirrors sms/optout.ts's ensureOptOutTokens exactly.
const MINT_CHUNK_SIZE = 1000;

// Read-back chunk: the select-back's `.in("email", chunk)` filter is
// serialized into the request URL. NOT the SMS precedent's 300 — that's
// sized for short E.164 phone numbers, not emails. Emails need
// loadSuppressedEmails' (suppression.ts) chunk size instead: verified
// empirically there against real Admizz-length addresses (36.6 char
// average) that 250/300/400 all 414 ("URI too long") and 200 is the first
// size that passes — 150 keeps real headroom under that boundary. Caught by
// this file's own ">1,000 distinct emails" CI test 414-ing with the wrong
// (SMS-sized) chunk before this was fixed — do not raise this without
// re-verifying against that same limit.
const SELECT_CHUNK_SIZE = 150;

interface UnsubscribeTokenLookupRow {
  email: string;
  token: string;
}

// Bulk counterpart to getOrCreateUnsubscribeToken. PROD INCIDENT (2026-09-24)
// — sendQueuedEmailBatch used to call getOrCreateUnsubscribeToken once per
// recipient inside its concurrency-5 send loop (an insert+select round trip
// each): a 3,131-recipient blast meant 6,000+ extra PostgREST round trips
// competing with the batch materialize writes for the same connection pool —
// the exact same shape as BLAST-FINDINGS-2026-09-06.md's F2 (SMS opt-out
// tokens), which was fixed there but never mirrored here for email. Mints in
// ~1,000-email chunks and reads back in ~300-email chunks instead — a small,
// bounded number of round trips per batch instead of one per recipient.
export async function ensureUnsubscribeTokens(
  db: ScopedClient,
  recipients: { email: string; leadId: string | null }[]
): Promise<Map<string, string>> {
  // Dedupe by normalized email first — the same address can appear twice in
  // one batch (two leads sharing an inbox), and each dupe would otherwise
  // mint/read the same row redundantly.
  const leadIdByEmail = new Map<string, string | null>();
  for (const r of recipients) {
    const normalized = normalizeEmail(r.email);
    if (!leadIdByEmail.has(normalized)) leadIdByEmail.set(normalized, r.leadId);
  }
  const emails = Array.from(leadIdByEmail.keys());
  if (emails.length === 0) return new Map();

  // Mint: one upsert per ~1,000-email chunk. ignoreDuplicates:true is
  // load-bearing — an existing token must NEVER be rewritten. Token
  // stability is the documented contract (module comment above): a
  // rewritten token breaks unsubscribe links in emails already delivered.
  // Do not switch this to ignoreDuplicates:false to get a RETURNING — that
  // issues `DO UPDATE SET` on every column on every conflict.
  for (let i = 0; i < emails.length; i += MINT_CHUNK_SIZE) {
    const chunk = emails.slice(i, i + MINT_CHUNK_SIZE);
    const mintRows = chunk.map((email) => ({
      token: generateUnsubscribeToken(),
      email,
      lead_id: leadIdByEmail.get(email) ?? null,
    }));
    const { error: upsertError } = await db
      .from("email_unsubscribe_tokens")
      .upsert(mintRows, { onConflict: "tenant_id,email", ignoreDuplicates: true });
    if (upsertError) {
      throw new Error(`ensureUnsubscribeTokens: failed to bulk-upsert tokens: ${upsertError.message}`);
    }
  }

  // Read back — insert-then-select, never check-then-insert (same
  // race-safety property as getOrCreateUnsubscribeToken above). Chunked at
  // the smaller SELECT_CHUNK_SIZE for the URL-length reason documented
  // there; fetchAllRows still paginates WITHIN each chunk because a full
  // 300-email chunk returning exactly 300 rows would otherwise be
  // indistinguishable from PostgREST's own silent 1,000-row cap on an
  // unpaged select — see paginate.ts's header. `token` (not `id`) is this
  // table's primary key — email_unsubscribe_tokens has no surrogate id
  // column, same as sms_optout_tokens — so it's the deterministic ORDER BY
  // the pagination contract requires.
  const tokenByEmail = new Map<string, string>();
  for (let i = 0; i < emails.length; i += SELECT_CHUNK_SIZE) {
    const chunk = emails.slice(i, i + SELECT_CHUNK_SIZE);
    const rows = await fetchAllRows<UnsubscribeTokenLookupRow>(
      (offset, limit) =>
        db
          .from("email_unsubscribe_tokens")
          .select("email, token")
          .in("email", chunk)
          .order("token", { ascending: true })
          .range(offset, offset + limit - 1) as unknown as Promise<PageResult<UnsubscribeTokenLookupRow>>,
      SELECT_CHUNK_SIZE
    );
    for (const row of rows) tokenByEmail.set(row.email, row.token);
  }

  const missing = emails.filter((e) => !tokenByEmail.has(e));
  if (missing.length > 0) {
    throw new Error(`ensureUnsubscribeTokens: failed to read back token(s) for ${missing.length} email(s) after upsert`);
  }

  return tokenByEmail;
}

export function unsubscribeUrl(token: string): string {
  return `${APP_URL.replace(/\/$/, "")}/e/u/${token}`;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Every message sent through the spine gets this, regardless of headers.ts's
// List-Unsubscribe header — headers alone are not compliance; some clients
// never render them (§4.4, brief). Sender identity + mailing address protect
// sending-domain reputation (Resend/ISP spam-complaint risk), independent of
// any consent question — every tenant gets this line, not just ones under a
// specific compliance regime. `mailingAddress` is optional: omitted from the
// footer until a tenant has one set on tenant_email_settings.mailing_address.
export function injectUnsubscribe(
  bodyHtml: string,
  url: string,
  sender: { orgName: string; mailingAddress?: string | null }
): string {
  const identityLine = sender.mailingAddress
    ? `${escapeHtml(sender.orgName)} &middot; ${escapeHtml(sender.mailingAddress)}`
    : escapeHtml(sender.orgName);
  const footer =
    '<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb;' +
    'font-size:12px;color:#6b7280;">' +
    `<div>${identityLine}</div>` +
    `<div><a href="${url}" style="color:#6b7280;text-decoration:underline;">Unsubscribe</a>` +
    " from these emails.</div></div>";
  return `${bodyHtml}${footer}`;
}
