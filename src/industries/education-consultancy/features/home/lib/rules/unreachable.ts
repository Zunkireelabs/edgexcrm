import { isUnanswered } from "../contact";
import type { DoNextItem, HomeLead } from "../types";
import type { RuleCtx } from "./ctx";

export const UNREACHABLE_CALLS = 3;

/** How many of the lead's newest contacts, in a row, were unanswered calls (stops at the first note / email / connected call). */
export function unansweredStreak(l: Pick<HomeLead, "recentContacts">): number {
  let n = 0;
  for (const e of l.recentContacts ?? []) {
    if (!isUnanswered(e)) break;
    n += 1;
  }
  return n;
}

/**
 * unreachable: the lead's last 3 contacts are ALL unanswered calls (no answer / busy), with no note, email or other
 * contact in between. Calling again is unlikely to work: say so instead of showing yet another call-back, and offer the
 * other channel. Such a lead is NOT also listed as a call-back row (build.ts passes its id to callbackRules).
 */
export function unreachableRule(leads: HomeLead[], _ctx: RuleCtx): DoNextItem[] {
  void _ctx;
  const out: DoNextItem[] = [];
  for (const l of leads) {
    if (!l.isActive) continue;
    const n = unansweredStreak(l);
    if (n < UNREACHABLE_CALLS) continue;
    out.push({
      key: `unreachable:${l.id}`,
      kind: "unreachable",
      tier: "today",
      leadId: l.id,
      title: l.name,
      why: l.context || "No one has picked up",
      chip: { text: `${n} calls unanswered`, tone: "warn" },
      tone: "warn",
      // No per-lead SMS composer exists yet (SMS is blasts + outreach drafts): open the lead, where staff already work.
      primaryAction: { type: "open", href: `/leads/${l.id}`, label: "Open lead" },
      sortKey: { group: 3, at: Date.parse(l.recentContacts?.[0]?.at ?? l.createdAt) },
      evidenceHref: `/leads/${l.id}`,
    });
  }
  return out;
}
