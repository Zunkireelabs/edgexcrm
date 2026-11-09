import { z } from "zod";
import type { DoNextItem } from "./types";
import type { WeekMetric } from "./week-stats";
import type { NeedsYouRow } from "./needs-you";
import type { NeedsALook } from "./needs-a-look";
import type { ImpactRow } from "./impact";
import { clock12 } from "./time";

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
  /** Where "Open →" goes for this fact, if anywhere. Built by us from our own data. */
  href: string | null;
  linkLabel: string | null;
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
  link: { href: string; label: string } | null;
}

const numbersIn = (s: string) => (s.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(",", "."));

/**
 * Turns the model's points into what Home shows. Drops, never repairs:
 *   - a point that cites no known fact id,
 *   - a point whose claim or reason holds a number that is in none of the facts it was given,
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
    const linked = cited.filter((f) => f.href);
    const first = linked[0];
    const link = first?.href ? { href: first.href, label: linked.length > 1 && first.id.startsWith("item:") ? `Open first of ${linked.length} →` : first.linkLabel ?? "Open →" } : null;
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

/**
 * Counsellor facts: ONLY from the person's own Home data (their Do next items and their week numbers), so a read can never
 * contain another person's lead. The grouped missed-call-backs row is one fact; its children are not listed again.
 */
export function counsellorFacts(items: DoNextItem[], week: WeekMetric[]): Fact[] {
  const facts: Fact[] = [];
  const byKind = new Map<DoNextItem["kind"], number>();
  for (const i of items) byKind.set(i.kind, (byKind.get(i.kind) ?? 0) + 1);
  for (const [kind, n] of byKind) facts.push({ id: `kind:${kind}`, text: `${KIND_WORD[kind]}: ${n} on your Do next list`, href: null, linkLabel: null });
  for (const i of items.slice(0, READ_FACT_LIMIT - byKind.size - week.length)) {
    facts.push({ id: `item:${i.key}`, text: `${i.title} (${KIND_WORD[i.kind]}): ${i.chip.text}${i.why ? `. ${i.why}` : ""}`, href: i.evidenceHref, linkLabel: "Open →" });
  }
  for (const w of week) facts.push({ id: `week:${w.key}`, text: `This week, ${w.label}: ${w.value}${w.note ? ` (${w.note})` : ""}`, href: null, linkLabel: null });
  return facts;
}

/**
 * Owner / branch-manager facts: Needs you, Needs a look and Pulse's numbers, as Home already shows them, in the viewer's
 * scope. A person on leave carries Pulse's own "On leave · expected" so the read says a drop is expected, not a problem.
 */
export function managerFacts(needsYou: NeedsYouRow[], look: NeedsALook, impactRows: ImpactRow[], canOpenPulse: boolean): Fact[] {
  const facts: Fact[] = [];
  for (const r of needsYou) {
    const link = r.actions.find((a): a is Extract<typeof a, { type: "link" }> => a.type === "link");
    facts.push({ id: `need:${r.key}`, text: `${r.title}${r.chip ? ` (${r.chip.text})` : ""}. ${r.why}`, href: link?.href ?? null, linkLabel: "Open →" });
  }
  for (const p of look.rows) {
    facts.push({
      id: `look:${p.userId}`,
      text: `${p.name}: ${p.value} ${p.unit}${p.sub ? ` (${p.sub})` : ""}`,
      href: canOpenPulse ? "/pulse" : null,
      linkLabel: "Open in Pulse →",
    });
  }
  if (look.others > 0) facts.push({ id: "look:others", text: `${look.others} other people are on track`, href: null, linkLabel: null });
  for (const r of impactRows) facts.push({ id: `impact:${r.key}`, text: `${r.label}: ${r.value}${r.was ? `, ${r.was}` : ""}`, href: null, linkLabel: null });
  return facts.slice(0, READ_FACT_LIMIT);
}

export const ASK_CHIPS: Record<ReadScope, string[]> = {
  me: ["Who should I call first?", "What did I miss this week?"],
  business: ["Who needs help this week?", "Where are we losing leads?"],
};
