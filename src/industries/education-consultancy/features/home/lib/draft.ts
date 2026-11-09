import type { DoNextItem } from "./types";
import { localDate } from "./time";

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

/** "Admizz Education" -> "Admizz": the name a counsellor introduces themselves with (the same short name the owner Home uses). */
export function shortTenantName(name: string | null | undefined): string | null {
  return (name ?? "").trim().split(/\s+/)[0] || null;
}

/**
 * The counsellor's first name EXACTLY as Home greets them (page.tsx): the profile's name / full_name. No profile name means NO name
 * (never the email: admizzintern4@gmail.com must not sign as "admizzintern4"), and the draft is written without a sign-off name.
 */
export function counsellorFirstName(meta: Record<string, unknown> | null | undefined): string | null {
  const full = (meta?.name ?? meta?.full_name) as string | undefined;
  const first = typeof full === "string" ? full.trim().split(/\s+/)[0] : "";
  return first || null;
}

/** "today" / "yesterday" / "5 days ago", by tenant-local calendar days, so the facts carry real timing the model can repeat. */
export function relativeAge(at: string | Date, now: Date, tz: string): string {
  const then = typeof at === "string" ? new Date(at) : at;
  const days = Math.round((Date.parse(`${localDate(now, tz)}T00:00:00Z`) - Date.parse(`${localDate(then, tz)}T00:00:00Z`)) / 86_400_000);
  return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
}

/** Words that state WHEN something happened. A draft may only say them when a fact does (a student would read a wrong "yesterday"). */
const TIME_WORDS: RegExp[] = [/\byesterday\b/i, /\blast week\b/i, /\blast night\b/i, /\blast month\b/i, /\bearlier today\b/i, /हिजो/, /अस्ति/, /गत हप्ता/, /गत महिना/];

/** The time words in `texts` that no fact backs up. Empty = fine. English and Nepali; the number check can't see words. */
export function unbackedTimeWords(texts: string[], facts: string[]): string[] {
  const hay = facts.join("\n").toLowerCase();
  const out: string[] = [];
  for (const re of TIME_WORDS) {
    for (const t of texts) {
      const m = t.match(re);
      if (m && !hay.includes(m[0].toLowerCase())) out.push(m[0]);
    }
  }
  return [...new Set(out)];
}

const PRONOUN = /\b(he|she|his|her|hers|him|himself|herself)\b/i;
/** Gender is never guessed from a name: a draft (or its reason or task) using he/she/his/her is refused. Names only. */
export function hasGenderedPronoun(texts: string[]): boolean {
  return texts.some((t) => PRONOUN.test(t));
}

/** Why a message is being written, by row kind: the only reasons the model is ever given (single Draft and the batch share them). */
export const DRAFT_REASONS: Record<string, string> = {
  reply_waiting: "the lead wrote to the counsellor and is waiting for a reply",
  deadline_docs: "an application deadline is close and a required document is still missing",
  callback_overdue: "a call-back is overdue and the last call was not answered",
  going_quiet: "the lead has gone quiet since the last contact and the counsellor is checking in",
};
