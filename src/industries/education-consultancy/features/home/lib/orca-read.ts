import { z } from "zod";
import type { DoNextItem } from "./types";
import type { WeekMetric } from "./week-stats";
import type { NeedsYouRow } from "./needs-you";
import type { NeedsALook } from "./needs-a-look";
import type { ImpactRow } from "./impact";
import { clock12 } from "./time";
import { numbersIn } from "./numbers";

/**
 * B2: Orca's read on Home. FACTS COME FROM THE RULES; ORCA ONLY WORDS AND RANKS THEM (doc 07 §1a). The model gets a list of
 * facts the Home rules already computed, each with an id, and returns up to 3 points that name the ids they used. Our code
 * (not the model) builds every link from those ids, and drops any point that cites an unknown id or says a number that is
 * not in the facts it was given. That drop is what stops an invented "14 leads".
 */
export interface Fact {
  id: string;
  /** What the model is told. Already free of phone numbers / emails (privacy.ts runs again on the way out). */
  text: string;
  /** Where the link goes: ALWAYS the exact records behind the fact (R1/R2). Built by us from our own data. */
  href: string;
  linkLabel: string;
}

export type ReadScope = "me" | "business";

export const READ_MAX_POINTS = 3;
export const READ_MAX_REFRESHES = 3;
export const READ_FACT_LIMIT = 24;

export const readSchema = z.object({
  points: z
    .array(
      z.object({
        claim: z.string().trim().min(1).max(160).describe("One sentence: the thing to know or do."),
        reason: z.string().trim().min(1).max(220).describe("One sentence: why, using only the facts."),
        factIds: z.array(z.string()).min(1).max(6).describe("The ids of the facts this point is built from."),
      }),
    )
    .max(READ_MAX_POINTS),
});
export type RawReadPoint = z.infer<typeof readSchema>["points"][number];

export interface ReadPoint {
  claim: string;
  reason: string;
  factIds: string[];
  link: { href: string; label: string };
}



/**
 * Turns the model's points into what Home shows. Drops, never repairs:
 *   - a point that cites no known fact id,
 *   - a point whose claim or reason holds a number that is in none of the facts it was given,
 *   - a point whose cited facts have no link at all (R2),
 * then keeps the first 3. The link is the first cited fact that has one; with several cited item facts the label says so.
 * An empty result means "nothing worth saying": the card does not show.
 */
export function validatePoints(raw: RawReadPoint[], facts: Fact[]): ReadPoint[] {
  const byId = new Map(facts.map((f) => [f.id, f]));
  const known = new Set(facts.flatMap((f) => numbersIn(f.text)));
  const out: ReadPoint[] = [];
  for (const p of raw) {
    const cited = p.factIds.map((id) => byId.get(id)).filter((f): f is Fact => !!f);
    if (cited.length === 0 || cited.length !== p.factIds.length) continue;
    if (![...numbersIn(p.claim), ...numbersIn(p.reason)].every((n) => known.has(n))) continue;
    // S6: the label counts only ITEM facts (real leads/rows). A per-kind count is context, never a thing to open: it is not counted
    // and not chosen for the link while an item fact is cited.
    const linked = cited.filter((f) => f.href);
    const items = linked.filter((f) => f.id.startsWith("item:"));
    const first = items[0] ?? linked[0];
    // R2: a claim must open the records behind it. A point whose cited facts carry no link is dropped, not shown bare.
    if (!first?.href) continue;
    const link = { href: first.href, label: items.length > 1 ? `Open first of ${items.length} →` : first.linkLabel ?? "Open →" };
    out.push({ claim: p.claim.trim(), reason: p.reason.trim(), factIds: cited.map((f) => f.id), link });
    if (out.length === READ_MAX_POINTS) break;
  }
  return out;
}

/** "made at 7:00 am": the real time it was made, in the tenant's zone. */
export function madeAtLabel(madeAt: Date, tz: string): string {
  return `made at ${clock12(madeAt, tz)}`;
}

export function refreshesLeft(refreshes: number): number {
  return Math.max(0, READ_MAX_REFRESHES - refreshes);
}

const KIND_WORD: Record<DoNextItem["kind"], string> = {
  new_uncalled: "new lead not yet called",
  reply_waiting: "reply waiting",
  callback_overdue: "call-back overdue",
  callback_today: "call-back booked today",
  deadline_docs: "application deadline with documents missing",
  task_due: "task due",
  going_quiet: "lead going quiet",
  stuck_in_stage: "lead stuck in a stage",
  missed_callbacks: "missed call-backs",
  unreachable: "lead who has not picked up",
};

/** Where the Home sheet for a grouped row opens: `/home?open=<item key>` (Home opens that row's sheet once, then clears the param). */
export const sheetHref = (key: string) => `/home?open=${encodeURIComponent(key)}`;

/** A rate such as "0 of 1" says nothing when its count is under this: not a fact (R5). */
export const MIN_RATE_COUNT = 5;

/**
 * Counsellor facts: ONLY from the person's own Home data (their Do next items and their week numbers), so a read can never
 * contain another person's lead. EVERY fact has a link that opens exactly its records (R1, R2):
 *   - a single lead's row -> that lead;
 *   - a grouped row (missed call-backs, going quiet) -> its own sheet on Home, never a bare /leads;
 *   - a week number -> the "Your last 7 days" card.
 * Per-kind counts are only given for kinds with 2+ separate rows (a grouped row states its own count, and a count of 1 is the
 * row itself), so the model is never handed "the 1 on your list" for a row that holds 59 leads (R5).
 */
export function counsellorFacts(items: DoNextItem[], week: WeekMetric[]): Fact[] {
  const facts: Fact[] = [];
  const grouped = (i: DoNextItem) => (i.children?.length ?? 0) > 0 || i.primaryAction.type === "sheet";
  const byKind = new Map<DoNextItem["kind"], number>();
  for (const i of items) if (!grouped(i)) byKind.set(i.kind, (byKind.get(i.kind) ?? 0) + 1);
  const weekFacts = week.filter((w) => {
    const m = /^(\d+) of (\d+)$/.exec(w.value.trim());
    return !m || Number(m[2]) >= MIN_RATE_COUNT;
  });
  for (const [kind, n] of byKind) {
    if (n < 2) continue;
    facts.push({ id: `kind:${kind}`, text: `${KIND_WORD[kind]}: ${n}`, href: "/home#do-next", linkLabel: `Open ${n} →` });
  }
  for (const i of items.slice(0, READ_FACT_LIMIT - facts.length - weekFacts.length)) {
    if (grouped(i)) {
      const n = i.children?.length ?? 0;
      facts.push({ id: `item:${i.key}`, text: `${i.title} (${KIND_WORD[i.kind]}${n ? `, ${n} leads` : ""}): ${i.chip.text}${i.why ? `. ${i.why}` : ""}`, href: sheetHref(i.key), linkLabel: n ? `Open ${n} →` : "Open →" });
    } else {
      facts.push({ id: `item:${i.key}`, text: `${i.title} (${KIND_WORD[i.kind]}): ${i.chip.text}${i.why ? `. ${i.why}` : ""}`, href: i.evidenceHref, linkLabel: "Open →" });
    }
  }
  for (const w of weekFacts) facts.push({ id: `week:${w.key}`, text: `In the last 7 days, ${w.label}: ${w.value}${w.note ? ` (${w.note})` : ""}`, href: "/home#week", linkLabel: "See why →" });
  return facts;
}

/**
 * S7: a Needs-you row's own link words, as the row says them: "Review 388" reads "Open 388 →" (its real count), "See their leads" and
 * "Open in Pulse" stay as they are. Anything unnamed is "Open".
 */
export function linkWords(label: string): string {
  const review = /^Review (\d+)$/.exec(label.trim());
  if (review) return `Open ${review[1]}`;
  if (label.trim() === "Review") return "Open";
  return label.trim() || "Open";
}

/**
 * Owner / branch-manager facts: Needs you, Needs a look and Pulse's numbers, as Home already shows them, in the viewer's
 * scope. A person on leave carries Pulse's own "On leave · expected" so the read says a drop is expected, not a problem.
 * Every fact has a link (R2): a row's own link if it has one, else the row itself on Home (`#need-<key>`); a person opens in Pulse
 * (owner/admin) or as their leads (branch manager: "See their leads →", Pulse is not theirs).
 */
export function managerFacts(
  needsYou: NeedsYouRow[],
  look: NeedsALook,
  impactRows: ImpactRow[],
  canOpenPulse: boolean,
  personLeadsHref: (userId: string) => string,
): Fact[] {
  const facts: Fact[] = [];
  for (const r of needsYou) {
    const link = r.actions.find((a): a is Extract<typeof a, { type: "link" }> => a.type === "link");
    const assign = r.actions.find((a): a is Extract<typeof a, { type: "assign" }> => a.type === "assign");
    const own = `/home#need-${r.key}`;
    facts.push({
      id: `need:${r.key}`,
      text: `${r.title}${r.chip ? ` (${r.chip.text})` : ""}. ${r.why}`,
      href: assign ? own : link?.href ?? own,
      linkLabel: assign ? `Assign ${assign.leadIds.length || assign.assignments.reduce((n, a) => n + a.take, 0)} →` : link ? `${linkWords(link.label)} →` : "See why →",
    });
  }
  for (const p of look.rows) {
    facts.push({
      id: `look:${p.userId}`,
      text: `${p.name}: ${p.value} ${p.unit}${p.sub ? ` (${p.sub})` : ""}`,
      href: canOpenPulse ? "/pulse" : personLeadsHref(p.userId),
      linkLabel: canOpenPulse ? "Open in Pulse →" : "See their leads →",
    });
  }
  if (look.others > 0) facts.push({ id: "look:others", text: `${look.others} other people are on track`, href: "/home#look", linkLabel: "See why →" });
  for (const r of impactRows) facts.push({ id: `impact:${r.key}`, text: `${r.label}: ${r.value}${r.was ? `, ${r.was}` : ""}`, href: "/home#impact", linkLabel: "See why →" });
  return facts.slice(0, READ_FACT_LIMIT);
}

export const ASK_CHIPS: Record<ReadScope, string[]> = {
  me: ["Who should I call first?", "What did I miss this week?"],
  business: ["Who needs help this week?", "Where are we losing leads?"],
};
