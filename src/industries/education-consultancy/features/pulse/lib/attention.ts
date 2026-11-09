import { leadsOfPersonHref, untouchedHeldOfPersonHref, untouchedLeadsHref } from "./leads-links";
import { planReassign, type ReassignPlan } from "./suggest";
import { noTakerSentence, suggestionNames, type NewLeadSuggestion } from "../../home/lib/assignment/suggest";
import { pluralLabel } from "./positions";
import { compareToUsual } from "./compare";
import { activityDownPct, activityWhat, leadCount } from "./activity-text";
export { activityWhat };
import { activityOf, type AttentionItem, type LeakReason, type PersonRow, type Signal, type StageFlow } from "./types";

/**
 * The ONE "Needs your attention" list (replaces Key changes + Needs you). Built from the rule signals; every item is
 * computed from real numbers and links to its records. Suggestions carry the concrete value (a name, a count).
 */
export interface AttentionInput {
  people: PersonRow[];
  signals: Signal[];
  stageFlows: StageFlow[];
  leakReasons: Record<string, LeakReason[]>;
  /** Untouched-new-leads set: count + where they are held, and the intake lists it was counted on (the Review link names them). */
  untouched: { count: number; listIds: string[]; byBranch: Array<{ name: string; count: number }>; byRole: Array<{ key: string; label: string; count: number }> };
  /**
   * What smart assignment would do with the UNASSIGNED leads in that set (the same function Home's "Assign N new leads" row
   * uses, so the two pages agree). Absent / nothing placeable = a plain Review.
   */
  newLeadSuggestion?: NewLeadSuggestion | null;
  /** Leads each person still holds that nobody touched this window (for the "Reassign N" value). */
  staleHeld: Record<string, number>;
  /** Open leads each person holds RIGHT NOW (active lists, not deleted) — the load a reassign target is chosen by. */
  heldLoad?: Record<string, number>;
  /** Row flags from the WEEKLY view, whatever window is shown: anyone red/amber there is never a target. */
  flags7d?: Record<string, "red" | "amber" | "green">;
  /** How the current window is named in sentences: "this week" | "today" | "this period". */
  periodNoun?: string;
  baselineCovered?: boolean;
}

const personOf = (people: PersonRow[], id: string) => people.find((p) => p.userId === id);
/** "split across 2 TeleCallers" etc. — the label, meta and (when one person) the name for a plan. */
function planText(plan: ReassignPlan, n: number, roleLabel: string, verb: "Reassign" | "Assign"): { label: string; meta: string; why: string; suggested: boolean } {
  if (plan.kind === "one") return { label: `${verb} ${n} to ${plan.target.name}`, meta: `${plan.target.name} holds ${plan.held} open ${plan.held === 1 ? "lead" : "leads"} now`, why: ` ${plan.target.name} holds ${plan.held} open ${plan.held === 1 ? "lead" : "leads"} now, so ${n} more is within +50%.`, suggested: true };
  if (plan.kind === "split") {
    const k = plan.targets.length;
    return { label: `${verb} ${n} · split across ${k} ${pluralLabel(roleLabel)}`, meta: plan.targets.map((t) => `${t.person.name} +${t.take}`).join(", "), why: ` No one ${roleLabel} can take all ${n} without their load rising over 50%, so it is split: ${plan.targets.map((t) => `${t.person.name} +${t.take}`).join(", ")}.`, suggested: true };
  }
  return { label: `Review ${leadCount(n)}`, meta: `no ${roleLabel} has spare capacity`, why: ` No ${roleLabel} has room to take them without their load rising over 50%.`, suggested: false };
}
/** The intake-alarm row's label / meta / why from the smart-assignment suggestion for its unassigned leads. */
function untouchedPlanText(sug: NewLeadSuggestion | null, n: number): { label: string; meta: string; why: string; suggested: boolean } {
  if (sug && sug.placed > 0) {
    const names = suggestionNames(sug.assignments);
    const label = sug.assignments.length === 1 ? `Assign ${sug.placed} to ${sug.assignments[0].name}` : `Assign ${sug.placed} \u00B7 split across ${sug.assignments.length} people`;
    const left = sug.unplaced > 0 ? ` ${noTakerSentence(sug, sug.unplaced)}` : "";
    return { label, meta: names, why: ` Smart assignment would give the ${sug.placed} unassigned ones to: ${names}.${left}`, suggested: true };
  }
  const why = sug && sug.unplaced > 0 ? ` ${noTakerSentence(sug, sug.unplaced)}` : "";
  return { label: `Review ${leadCount(n)}`, meta: "", why, suggested: false };
}

const pctOf = (cur: number, base: number) => { const shown = Math.max(1, Math.round(base)); return Math.round(Math.abs((cur - shown) / shown) * 100); };

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

export function buildAttention(input: AttentionInput): AttentionItem[] {
  const out: AttentionItem[] = [];
  const period = input.periodNoun ?? "this week";
  for (const s of input.signals) {
    if (s.kind === "activity_drop") {
      const p = personOf(input.people, s.subject.id);
      if (!p) continue;
      const cur = activityOf(p.current), usual = activityOf(p.usual);
      const stale = input.staleHeld[p.userId] ?? 0;
      const plan = stale > 0 ? planReassign(input.people, p, stale, input.heldLoad ?? {}, input.flags7d ?? {}) : ({ kind: "none" } as ReassignPlan);
      const pt = planText(plan, stale, p.positionLabel, "Reassign");
      out.push({
        id: s.id, category: "needs_action", tone: "bad", icon: "down", subject: p.name,
        what: activityWhat(p, cur, usual, period),
        figure: stale > 0 ? { strong: String(stale), text: ` ${stale === 1 ? "lead" : "leads"} untouched` } : { strong: String(cur), text: ` vs usual ${Math.round(usual)}` },
        suggested: stale > 0 && pt.suggested,
        staleHeld: stale,
        activity: { current: cur, usual: Math.round(usual), downPct: activityDownPct(cur, usual) },
        // No untouched leads → no lead set to name: the button opens the person's day instead.
        action: stale > 0
          ? { label: pt.label, href: untouchedHeldOfPersonHref(p.userId), primary: true }
          : { label: `See ${firstName(p.name)}'s day`, href: "", personId: p.userId, primary: true },
        why: `Calls, notes and stage moves dropped together: ${cur} against a usual ${Math.round(usual)}.` +
          (stale > 0 ? ` ${stale} of the leads ${p.name} holds ${stale === 1 ? "has" : "have"} had no touch or move in 3+ days.${pt.why}` : ""),
        meta: [`${p.current.calls} calls vs usual ${Math.round(p.usual.calls)}`, `${p.notesNew + p.notesEdited} notes vs usual ${Math.round(p.usual.notes)}`, [p.positionLabel, p.branchName].filter(Boolean).join(", "), stale > 0 ? pt.meta : `no ${p.positionLabel} has spare capacity`].join(" · "),
        links: [{ label: stale > 0 ? `See the ${leadCount(stale)} →` : "See their leads →", href: stale > 0 ? untouchedHeldOfPersonHref(p.userId) : leadsOfPersonHref(p.userId) }, { label: `${p.name}'s activity →`, personId: p.userId }],
        drill: s.drill,
      });
    } else if (s.kind === "untouched_leads") {
      const n = input.untouched.count;
      const topB = input.untouched.byBranch[0];
      const topR = input.untouched.byRole[0];
      const pt = untouchedPlanText(input.newLeadSuggestion ?? null, n);
      const href = untouchedLeadsHref(input.untouched.listIds);
      out.push({
        id: s.id, category: "needs_action", tone: "warn", icon: "clock", subject: `${n} new lead${n === 1 ? "" : "s"}`,
        what: `untouched for over 48 hours${topB && topB.count < n ? `, ${topB.count} of them with ${topB.name}` : ""}`,
        figure: null, suggested: pt.suggested,
        action: { label: pt.label, href, primary: false },
        why: `No call, email, meeting or note since they arrived.` + (topR ? ` ${topR.count} of them are held by ${pluralLabel(topR.label)}.` : "") + pt.why,
        meta: [input.untouched.byBranch.slice(0, 3).map((b) => `${b.name} ${b.count}`).join(" · "), pt.meta].filter(Boolean).join(" · ") || null,
        links: [{ label: `See the ${leadCount(n)} →`, href }],
        drill: s.drill,
      });
    } else if (s.kind === "over_capacity") {
      const p = personOf(input.people, s.subject.id);
      if (!p || !compareToUsual(p.current.received, p.usual.received, p.hasUsual)) continue;
      const received = p.current.received;
      const excess = Math.max(0, received - Math.round(p.usual.received));
      const plan = planReassign(input.people, p, excess, input.heldLoad ?? {}, input.flags7d ?? {});
      const pt = planText(plan, excess, p.positionLabel, "Reassign");
      // The button's number is the set its link opens: every lead received this window (the evidence drawer lists exactly those).
      out.push({
        id: s.id, category: "needs_action", tone: "warn", icon: "alert", subject: p.name,
        what: `received ${received} new ${received === 1 ? "lead" : "leads"}, usual is ${Math.round(p.usual.received)}`,
        figure: { text: `${(Math.round((received / Math.round(p.usual.received)) * 10) / 10).toString()}× usual` },
        suggested: pt.suggested,
        action: { label: `Review ${leadCount(received)}`, href: leadsOfPersonHref(p.userId), primary: false, drill: s.drill },
        why: `${excess} more than usual ${period}.${pt.why}`,
        meta: [[p.positionLabel, p.branchName].filter(Boolean).join(", "), pt.meta].filter(Boolean).join(" · ") || null,
        links: [{ label: `See the ${leadCount(received)} →`, drill: s.drill }, { label: `${p.name}'s activity →`, personId: p.userId }],
        drill: s.drill,
      });
    } else if (s.kind === "stage_leak") {
      const f = input.stageFlows.find((x) => x.listId === s.subject.id);
      if (!f) continue;
      const reasons = input.leakReasons[f.listId] ?? [];
      out.push({
        id: s.id, category: "heads_up", tone: "info", icon: "archive", subject: f.name,
        what: input.baselineCovered === false ? `${leadCount(f.out)} moved back or archived` : `${leadCount(f.out)} moved back or archived, up from ${f.previousOut}`,
        figure: reasons[0] ? { text: "Top reason", strong: reasons[0].reason, textFirst: true } : null,
        suggested: false, action: null,
        why: `${f.out} of the ${f.base} leads that were in ${f.name} left it backwards or to Archive.`,
        meta: reasons.slice(0, 3).map((r) => `${r.reason} ${r.leads}`).join(" · ") || null,
        links: [{ label: `See the ${leadCount(f.out)} →`, drill: s.drill }],
        drill: s.drill,
      });
    } else if (s.kind === "biggest_drop") {
      out.push({
        id: s.id, category: "heads_up", tone: "info", icon: "down", subject: s.title.split(":")[0],
        what: s.title.split(":").slice(1).join(":").trim().replace(/ vs usual$/, " (vs usual)"),
        figure: { strong: String(s.evidence.value), text: ` vs usual ${Math.round(s.evidence.baseline)}` },
        suggested: false, action: null, why: s.detail, meta: null,
        links: [{ label: "See the leads →", drill: s.drill }], drill: s.drill,
      });
    } else if (s.kind === "top_mover") {
      const p = personOf(input.people, s.subject.id);
      if (!p) continue;
      const above = compareToUsual(s.evidence.value, s.evidence.baseline) ? `, ${pctOf(s.evidence.value, s.evidence.baseline)}% above usual` : "";
      out.push({
        id: s.id, category: "wins", tone: "good", icon: "up", subject: p.name,
        what: `delivered ${s.evidence.metric === "reached_applications" ? `${s.evidence.value} students to Applications` : `${leadCount(s.evidence.value)} to Prospects`}${above}`,
        figure: { text: `Top ${p.positionLabel.toLowerCase()} this period` },
        suggested: false, action: null, why: s.detail, meta: null,
        links: [{ label: "See the records →", drill: s.drill }, { label: `${p.name}'s activity →`, personId: p.userId }], drill: s.drill,
      });
    }
  }
  return out;
}

export function countByCategory(items: AttentionItem[]) {
  return {
    all: items.length,
    needs_action: items.filter((i) => i.category === "needs_action").length,
    heads_up: items.filter((i) => i.category === "heads_up").length,
    wins: items.filter((i) => i.category === "wins").length,
  };
}
