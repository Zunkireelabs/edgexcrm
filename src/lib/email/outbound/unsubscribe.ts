import { randomBytes } from "crypto";
import type { ScopedClient } from "@/lib/supabase/scoped";
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

export function unsubscribeUrl(token: string): string {
  return `${APP_URL.replace(/\/$/, "")}/e/u/${token}`;
}

// Every message sent through the spine gets this, regardless of headers.ts's
// List-Unsubscribe header — headers alone are not compliance; some clients
// never render them (§4.4, brief).
export function injectUnsubscribe(bodyHtml: string, url: string): string {
  const footer =
    '<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb;' +
    'font-size:12px;color:#6b7280;">' +
    `<a href="${url}" style="color:#6b7280;text-decoration:underline;">Unsubscribe</a>` +
    " from these emails.</div>";
  return `${bodyHtml}${footer}`;
}
