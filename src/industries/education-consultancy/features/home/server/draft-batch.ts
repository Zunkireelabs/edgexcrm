import type { AuthContext } from "@/lib/api/auth";
import { logger } from "@/lib/logger";
import type { ScopedClient } from "@/lib/supabase/scoped";
import { draftFacts, produceDraft } from "../ai/draft";
import { recordHomeUsage } from "../ai/usage";
import { availableChannels, defaultChannel, DRAFT_REASONS, originalWords, type DraftChannel } from "../lib/draft";
import { addDaysStr, localDate } from "../lib/time";
import { loadDraftContext, type DraftContext } from "./draft-context";
import { loadVisibleLead } from "./visible-lead";

export interface BatchCard {
  leadId: string;
  leadName: string;
  kind: string;
  channels: DraftChannel[];
  channel: DraftChannel | null;
  phone: string | null;
  email: { accountId: string; to: string | null } | null;
  /** Null: "Couldn't draft, write your own" (a failed check on both tries, a provider error, or no way to send). */
  draft: { id: string | null; text: string; subject: string | null; why: string } | null;
  /** Orca suggests NOT sending: the counsellor's own words that say why ("already in Korea"), where they were written, and a short reason. Never a draft. */
  skip?: { reason: string; quote: string; source: string };
  error?: "not_visible" | "no_channel";
}

/** A note that says this number is not on WhatsApp ("Number is not registered on WhatsApp"). */
const NOT_ON_WHATSAPP = /\b(?:not|isn'?t)\s+(?:registered|available|active|found|working|using|on|in)(?:\s+(?:on|in))?\s+whats\s?app\b|\bno\s+whats\s?app\b|\bwhats\s?app\s+(?:is\s+)?(?:not|unavailable)\b/i;

const flat = (s: string) => s.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/\s+/g, " ").trim();
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "7 Sep" in the tenant's zone. Spelled out here, not by Intl, because "short" gives "Sept" in some locales' data. */
const shortDate = (at: string, tz: string) => {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "numeric" }).formatToParts(new Date(at));
  const day = Number(parts.find((x) => x.type === "day")?.value ?? "0");
  const month = Number(parts.find((x) => x.type === "month")?.value ?? "1");
  return `${day} ${MONTHS[month - 1] ?? ""}`.trim();
};

/** "note, 7 Sep": where the quoted words were written. Falls back to "note" when the words are in neither list (never invented). */
export function skipSource(quote: string, ctx: { notes: Array<{ text: string; at: string }>; messages: Array<{ text: string; at: string }> }, tz: string): string {
  const q = flat(quote).replace(/[.!?]+$/, "");
  const note = ctx.notes.find((n) => flat(n.text).includes(q));
  if (note) return `note, ${shortDate(note.at, tz)}`;
  const msg = ctx.messages.find((m) => flat(m.text).includes(q));
  if (msg) return `message, ${shortDate(msg.at, tz)}`;
  return "note";
}

/** The note that says the number is not on WhatsApp, when the channel is WhatsApp and the lead has not written to us there. */
export function notOnWhatsApp(ctx: Pick<DraftContext, "notes" | "lastReplyChannel">, channel: DraftChannel): { quote: string; at: string } | null {
  if (channel !== "whatsapp" || ctx.lastReplyChannel === "whatsapp") return null;
  for (const n of ctx.notes) {
    const m = NOT_ON_WHATSAPP.exec(n.text);
    if (m) {
      const start = Math.max(0, n.text.lastIndexOf(".", m.index) + 1);
      const end = n.text.indexOf(".", m.index + m[0].length);
      return { quote: n.text.slice(start, end === -1 ? undefined : end).trim() || m[0], at: n.at };
    }
  }
  return null;
}

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * One card of the batch: the same pipeline as the single Draft panel (visibility check, the lead's own record / notes / messages,
 * the facts, the S/C checks with their one retry), recorded on `ai_drafts` as surface `home_batch`. A failure here is THIS card only:
 * it comes back with `draft: null` and the others are unaffected.
 */
export async function draftOneForBatch(p: {
  auth: AuthContext;
  db: ScopedClient;
  entry: { leadId: string; kind: string };
  counsellorFirstName: string | null;
  company: string | null;
  tz: string;
  now: Date;
}): Promise<BatchCard> {
  const { auth, db, entry, tz, now } = p;
  const empty = { leadId: entry.leadId, leadName: "", kind: entry.kind, channels: [] as DraftChannel[], channel: null, phone: null, email: null, draft: null };
  try {
    if (!(await loadVisibleLead(auth, entry.leadId))) return { ...empty, error: "not_visible" };
    const ctx = await loadDraftContext(auth, entry.leadId, tz, now);
    if (!ctx) return { ...empty, error: "not_visible" };
    const facts = { hasPhone: !!ctx.lead.phone, hasGmail: !!ctx.gmail, lastReplyChannel: ctx.lastReplyChannel };
    const channels = availableChannels(facts);
    const channel = defaultChannel(facts);
    const card: BatchCard = {
      leadId: entry.leadId,
      leadName: ctx.lead.fullName,
      kind: entry.kind,
      channels,
      channel,
      phone: ctx.lead.phone,
      email: ctx.gmail ? { accountId: ctx.gmail.accountId, to: ctx.lead.email } : null,
      draft: null,
    };
    if (!channel) return { ...card, error: "no_channel" };

    // A note that says the number is not on WhatsApp is read by code, not left to the model: no draft is written for a number that cannot get it.
    const noWa = notOnWhatsApp(ctx, channel);
    if (noWa) return { ...card, skip: { reason: "Call or email instead.", quote: noWa.quote, source: `note, ${shortDate(noWa.at, tz)}` } };

    const factLines = draftFacts(ctx, { counsellorFirstName: p.counsellorFirstName, company: p.company, now, tz });
    const today = localDate(now, tz);
    const produced = await produceDraft({ channel, tone: "new", kind: DRAFT_REASONS[entry.kind], rowKind: entry.kind, allowSkip: true, facts: factLines, previous: null, todayLabel: `${WEEKDAY[new Date(`${today}T00:00:00Z`).getUTCDay()]} ${today}` });
    for (const usage of produced.usages) await recordHomeUsage(db, { surface: "home_batch", kind: "fast", userId: auth.userId, runId: crypto.randomUUID(), usage }).catch(() => {});
    // P2: which check tripped, by name only (no text), at warn so dev shows it; a first-try pass logs nothing.
    if (produced.failed.some((f) => f.length)) logger.warn({ rowKind: entry.kind, attempts: produced.failed, shown: !!produced.raw, styleFlags: produced.styleFlags }, produced.styleFlags ? "home batch draft shown_with_style_flags" : "home batch draft checks failed");
    const raw = produced.raw;
    if (!raw) return { ...card, draft: null };
    if (raw.skip) {
      // The model read the notes with he / she swapped for the name; the counsellor is shown their OWN words, found in the original note.
      const quote = originalWords(raw.skip.quote, ctx.lead.firstName, ctx.notes.map((n) => n.text)) ?? raw.skip.quote;
      return { ...card, skip: { reason: raw.skip.reason, quote, source: skipSource(quote, ctx, tz) } };
    }
    const subject = channel === "email" ? raw.subject ?? "Following up" : null;
    const { data } = await db
      .from("ai_drafts")
      .insert({ user_id: auth.userId, lead_id: entry.leadId, surface: "home_batch", channel, draft_text: raw.text, records_read: ctx.recordsRead, proposed: { why: raw.why, subject, followUp: { title: raw.followUp.title, dueDate: addDaysStr(today, raw.followUp.inDays) } } })
      .select("id")
      .single();
    return { ...card, draft: { id: (data as unknown as { id: string } | null)?.id ?? null, text: raw.text, subject, why: raw.why } };
  } catch {
    return empty;
  }
}

/** Runs `fn` over `xs` with at most `n` in flight, keeping order. */
export async function mapLimit<T, R>(xs: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, xs.length) }, async () => {
      while (next < xs.length) {
        const i = next++;
        out[i] = await fn(xs[i]);
      }
    }),
  );
  return out;
}
