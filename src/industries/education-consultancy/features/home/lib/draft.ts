import type { DoNextItem } from "./types";

/**
 * B3: Draft on a row (H3). Orca drafts; a human edits and sends; nothing goes out on its own.
 * SMS is not offered until per-lead SMS exists (EDGEX-104). WhatsApp cannot be sent from EdgeX for Admizz yet (D2), so it is an
 * "Open in WhatsApp" hand-off followed by "Did you send it?".
 */
export type DraftChannel = "whatsapp" | "email";

export type DraftTone = "new" | "shorter" | "formal" | "nepali" | "retry";

/** Which Do-next rows get a "Draft" button, and what it says. Grouped rows (going quiet) are B5's "Prepare all". */
export function draftLabel(item: Pick<DoNextItem, "kind" | "leadId" | "children">): string | null {
  if (!item.leadId || (item.children?.length ?? 0) > 0) return null;
  switch (item.kind) {
    case "reply_waiting": return "Draft reply";
    case "deadline_docs": return "Draft";
    case "callback_overdue": return "Draft";
    default: return null;
  }
}

export interface ChannelFacts {
  hasPhone: boolean;
  /** The person has a connected Gmail AND the lead has an email address. */
  hasGmail: boolean;
  /** Channel of the lead's most recent inbound message, if any. */
  lastReplyChannel: DraftChannel | "sms" | null;
}

/** The tabs shown, in order. SMS never appears. Empty = the panel offers "Copy" only. */
export function availableChannels(f: Pick<ChannelFacts, "hasPhone" | "hasGmail">): DraftChannel[] {
  return [...(f.hasPhone ? (["whatsapp"] as const) : []), ...(f.hasGmail ? (["email"] as const) : [])];
}

/** The channel the lead last replied on (if it is available), else WhatsApp when there is a phone, else email, else none. */
export function defaultChannel(f: ChannelFacts): DraftChannel | null {
  const tabs = availableChannels(f);
  if (f.lastReplyChannel && f.lastReplyChannel !== "sms" && tabs.includes(f.lastReplyChannel)) return f.lastReplyChannel;
  if (tabs.includes("whatsapp")) return "whatsapp";
  return tabs[0] ?? null;
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** Whitespace-insensitive: re-flowing lines or a trailing newline is not an edit. */
export function sameText(a: string, b: string): boolean {
  return squash(a) === squash(b);
}

export function outcomeOf(draftText: string, finalText: string): "sent_as_is" | "edited" {
  return sameText(draftText, finalText) ? "sent_as_is" : "edited";
}

/** wa.me wants digits only, with the country code. Null when there is no usable number. */
export function waLink(phone: string | null | undefined, text: string): string | null {
  const digits = (phone ?? "").replace(/\D/g, "").replace(/^00/, "");
  if (digits.length < 8) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/** The note that goes on the lead's timeline after "Yes, I sent it". Says plainly that EdgeX could not confirm delivery. */
export function whatsappTimelineNote(text: string): string {
  return `WhatsApp message (sent from your phone):\n${text.trim()}`;
}

/** What a send attempt hands back. WhatsApp is a hand-off today; a real send later returns "sent" and the panel needs no change. */
export type SendResult = { kind: "sent" } | { kind: "handoff"; url: string } | { kind: "failed"; message: string };
