// Renders the final SMS body exactly as it will be stored in sms_messages.body
// and sent to the provider. Sender ID is account-level on Aakash, not an API
// parameter, so every message must self-identify in the text body.
//
// The footer must NEVER contain "Reply STOP" — there is no free-form inbound
// on this provider, so we can never honour that instruction. Phase 2 supplies
// real opt-out links via optOutFooter; Phase 1 defaults it to empty.

export interface RenderMessageInput {
  body: string;
  lead: Record<string, unknown>;
  senderLabel?: string | null;
  optOutFooter?: string | null;
}

const FORBIDDEN_FOOTER_PATTERN = /reply\s+stop/i;

function resolveMergeTokens(template: string, lead: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (match, token: string) => {
    const value = lead[token];
    return value === undefined || value === null ? "" : String(value);
  });
}

export function renderMessage({ body, lead, senderLabel, optOutFooter }: RenderMessageInput): string {
  if (optOutFooter && FORBIDDEN_FOOTER_PATTERN.test(optOutFooter)) {
    throw new Error('SMS footer must not contain "Reply STOP" — no inbound channel exists to honour it.');
  }

  const resolvedBody = resolveMergeTokens(body, lead).trim();
  const prefix = senderLabel ? `${senderLabel}: ` : "";
  const footer = optOutFooter ? `\n${optOutFooter}` : "";

  return `${prefix}${resolvedBody}${footer}`;
}
