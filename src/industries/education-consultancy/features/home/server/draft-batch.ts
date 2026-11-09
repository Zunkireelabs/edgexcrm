import type { AuthContext } from "@/lib/api/auth";
import type { ScopedClient } from "@/lib/supabase/scoped";
import { draftFacts, produceDraft } from "../ai/draft";
import { recordHomeUsage } from "../ai/usage";
import { availableChannels, defaultChannel, DRAFT_REASONS, type DraftChannel } from "../lib/draft";
import { addDaysStr, localDate } from "../lib/time";
import { loadDraftContext } from "./draft-context";
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
  error?: "not_visible" | "no_channel";
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

    const factLines = draftFacts(ctx, { counsellorFirstName: p.counsellorFirstName, company: p.company, now, tz });
    const today = localDate(now, tz);
    const produced = await produceDraft({ channel, tone: "new", kind: DRAFT_REASONS[entry.kind], facts: factLines, previous: null, todayLabel: `${WEEKDAY[new Date(`${today}T00:00:00Z`).getUTCDay()]} ${today}` });
    for (const usage of produced.usages) await recordHomeUsage(db, { surface: "home_batch", kind: "fast", userId: auth.userId, runId: crypto.randomUUID(), usage }).catch(() => {});
    const raw = produced.raw;
    if (!raw) return { ...card, draft: null };
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
