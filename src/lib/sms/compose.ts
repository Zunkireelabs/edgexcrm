import type { ScopedClient } from "@/lib/supabase/scoped";
import { renderMessage } from "./render";
import { countSegments, type SegmentInfo } from "./segments";
import { getOrCreateOptOutToken, optOutUrl } from "./optout";

// Shared final-render path for BOTH /preview (samples + credit estimate) and
// /send (materialized sms_messages.body) — §5/§6 of SMS-PHASE3A-BRIEF.md are
// explicit that credits must be counted on the FINAL string (prefix + body +
// footer), so preview and send must never diverge on how that string is built.

export interface TenantSmsSettingsRow {
  sender_label: string | null;
  optout_footer: string | null;
  timezone: string | null;
  quiet_hours_start: number;
  quiet_hours_end: number;
  quiet_hours_enabled: boolean;
  max_recipients_per_blast: number;
  low_credit_threshold: number;
}

export const DEFAULT_OPTOUT_FOOTER_TEMPLATE = "Opt out: {url}";

// tenant_sms_settings.optout_footer is an admin-editable template containing a
// literal "{url}" placeholder for the per-recipient opt-out link; unset falls
// back to the Phase 2 default. Never emit "Reply STOP" — renderMessage()
// throws if this resolves to that pattern.
export function resolveFooter(template: string | null, url: string): string {
  const t = template && template.trim() ? template : DEFAULT_OPTOUT_FOOTER_TEMPLATE;
  return t.includes("{url}") ? t.replace("{url}", url) : `${t} ${url}`;
}

// A real opt-out token is always TOKEN_LENGTH (10) base62 characters — see
// optout.ts. For a preview with no real audience yet (nobody to mint a token
// for), a placeholder of the same length gives an accurate character count
// without writing a throwaway sms_optout_tokens row.
const PLACEHOLDER_OPTOUT_TOKEN = "0000000000";

export function estimateFooter(template: string | null): string {
  return resolveFooter(template, optOutUrl(PLACEHOLDER_OPTOUT_TOKEN));
}

export interface ComposedMessage {
  text: string;
  segments: SegmentInfo;
}

export async function composeRecipientMessage(
  db: ScopedClient,
  tenantId: string,
  settings: TenantSmsSettingsRow,
  body: string,
  recipient: { phoneE164: string; leadId: string | null; lead: Record<string, unknown> }
): Promise<ComposedMessage> {
  const token = await getOrCreateOptOutToken(db, tenantId, recipient.phoneE164, recipient.leadId);
  const footer = resolveFooter(settings.optout_footer, optOutUrl(token));
  const text = renderMessage({ body, lead: recipient.lead, senderLabel: settings.sender_label, optOutFooter: footer });
  return { text, segments: countSegments(text) };
}

export const DEFAULT_TENANT_SMS_SETTINGS: TenantSmsSettingsRow = {
  sender_label: null,
  optout_footer: null,
  timezone: null,
  quiet_hours_start: 8,
  quiet_hours_end: 20,
  quiet_hours_enabled: true,
  max_recipients_per_blast: 500,
  low_credit_threshold: 200,
};
