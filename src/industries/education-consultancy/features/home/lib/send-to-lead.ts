import { waLink, type DraftChannel, type SendResult } from "./draft";

export interface SendPayload {
  leadId: string;
  text: string;
  /** Email only. */
  subject?: string;
  /** WhatsApp hand-off only. */
  phone?: string | null;
  /** Email only: the person's connected Gmail account and the lead's address. */
  email?: { fromAccountId: string; to: string };
}

/** Plain-text body as the simple HTML the email route sends. */
export function textToHtml(text: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return text.trim().split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
}

/**
 * THE seam (D2). Home calls this and nothing else to send to a lead, so the real WhatsApp / Messenger send can replace the
 * "whatsapp" branch later without touching Home: it will POST to a send endpoint and return { kind: "sent" } instead of a hand-off.
 *   email:    the existing /api/v1/email/send (gated by EMAIL_TRANSPORT); it logs the email on the timeline itself.
 *   whatsapp: today, a wa.me hand-off. We cannot confirm delivery, so the caller must ask "Did you send it?" before logging anything.
 */
export async function sendToLead(channel: DraftChannel, p: SendPayload, fetcher: typeof fetch = fetch): Promise<SendResult> {
  if (channel === "whatsapp") {
    const url = waLink(p.phone, p.text);
    return url ? { kind: "handoff", url } : { kind: "failed", message: "This lead has no WhatsApp number." };
  }
  if (!p.email) return { kind: "failed", message: "Connect your Gmail to send email." };
  try {
    const res = await fetcher("/api/v1/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from_account_id: p.email.fromAccountId, to: [p.email.to], subject: p.subject || "Following up", body_html: textToHtml(p.text), lead_id: p.leadId }),
    });
    if (res.ok) return { kind: "sent" };
    const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    return { kind: "failed", message: j?.error?.message ?? `Couldn't send (${res.status})` };
  } catch {
    return { kind: "failed", message: "Network error" };
  }
}
