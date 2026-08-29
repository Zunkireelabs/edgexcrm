import { renderTemplate } from "../render-template";
import type { Lead } from "@/types/database";

// Renders a blast's raw subject/body templates against one recipient's lead
// row. Unlike SMS's compose.ts, no footer/opt-out link is injected here —
// send.ts's injectUnsubscribe() adds that per-row at actual send time
// (OUTREACH-PHASE1-BRIEF.md §3), so /preview and /send both render the SAME
// raw string; only send.ts appends the footer. Mirrors form-autoresponder.ts's
// escape convention: subject unescaped, HTML body escaped (lead field values
// can contain characters that would otherwise break the markup).

export interface ComposedEmail {
  subject: string;
  bodyHtml: string;
}

export function composeRecipientEmail(
  subjectTemplate: string,
  bodyTemplate: string,
  lead: Record<string, unknown>,
  tenantName?: string
): ComposedEmail {
  const ctx = { lead: lead as unknown as Lead, tenant: { name: tenantName } };
  return {
    subject: renderTemplate(subjectTemplate, ctx, { escape: false }),
    bodyHtml: renderTemplate(bodyTemplate, ctx, { escape: true }),
  };
}
