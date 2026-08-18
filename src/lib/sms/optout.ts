import { randomBytes } from "crypto";
import type { ScopedClient } from "@/lib/supabase/scoped";

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

export function optOutUrl(token: string): string {
  const base = process.env.SMS_OPTOUT_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/u/${token}`;
}
