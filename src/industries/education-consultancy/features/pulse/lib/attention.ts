import { leadsOfPersonHref, untouchedLeadsHref } from "./leads-links";
import { planReassign, type ReassignPlan } from "./suggest";
import { pluralLabel } from "./positions";
import { weekdayShort } from "./quiet";
import { compareToUsual, usualShare } from "./compare";
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
  /** Untouched-new-leads set: count + where they are held. */
  untouched: { count: number; byBranch: Array<{ name: string; count: number }>; byRole: Array<{ key: string; label: string; count: number }> };
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
  if (plan.kind === "one") return { label: `${verb} ${n} to ${plan.target.name}`, meta: `${plan.target.name} holds ${plan.held} open leads now`, why: ` ${plan.target.name} holds ${plan.held} open leads now, so ${n} more is within +50%.`, suggested: true };
  if (plan.kind === "split") {
    const k = plan.targets.length;
    return { label: `${verb} ${n} · split across ${k} ${pluralLabel(roleLabel)}`, meta: plan.targets.map((t) => `${t.person.name} +${t.take}`).join(", "), why: ` No one ${roleLabel} can take all ${n} without their load rising over 50%, so it is split: ${plan.targets.map((t) => `${t.person.name} +${t.take}`).join(", ")}.`, suggested: true };
  }
  return { label: `Review ${n} leads`, meta: `no ${roleLabel} has spare capacity`, why: ` No ${roleLabel} can take them without their load rising over 50%, or they are already flagged this week.`, suggested: false };
}
const pctOf = (cur: number, base: number) => { const shown = Math.max(1, Math.round(base)); return Math.round(Math.abs((cur - shown) / shown) * 100); };

export function buildAttention(input: AttentionInput): AttentionItem[] {
  const out: AttentionItem[] = [];
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
        what: p.quietSinceDay ? `activity down ${usualShare(cur, usual)?.down ?? pctOf(cur, usual)}% since ${weekdayShort(p.quietSinceDay)}` : `activity down ${usualShare(cur, usual)?.down ?? pctOf(cur, usual)}% against usual`,
        figure: stale > 0 ? { strong: String(stale), text: " leads untouched" } : { strong: String(cur), text: ` vs usual ${Math.round(usual)}` },
        suggested: stale > 0 && pt.suggested,
        action: { label: stale > 0 ? pt.label : "Review leads", href: leadsOfPersonHref(p.userId), primary: true },
        why: `Calls, notes and stage moves dropped together: ${cur} against a usual ${Math.round(usual)}.` +
          (stale > 0 ? ` ${stale} of the leads ${p.name} holds have had no touch or move in 3+ days.${pt.why}` : ""),
        meta: [`${p.current.calls} calls vs usual ${Math.round(p.usual.calls)}`, `${p.notesNew + p.notesEdited} notes vs usual ${Math.round(p.usual.notes)}`, [p.positionLabel, p.branchName].filter(Boolean).join(", "), stale > 0 ? pt.meta : `no ${p.positionLabel} has spare capacity`].join(" · "),
        links: [{ label: stale > 0 ? `See the ${stale} leads →` : "See their leads →", href: leadsOfPersonHref(p.userId) }, { label: `${p.name}'s activity →`, personId: p.userId }],
        drill: s.drill,
      });
    } else if (s.kind === "untouched_leads") {
      const n = input.untouched.count;
      const topB = input.untouched.byBranch[0];
      const topR = input.untouched.byRole[0];
      const plan = topR ? planReassign(input.people, { userId: null, positionKey: topR.key }, n, input.heldLoad ?? {}, input.flags7d ?? {}) : ({ kind: "none" } as ReassignPlan);
      const pt = planText(plan, n, topR?.label ?? "team member", "Assign");
      out.push({
        id: s.id, category: "needs_action", tone: "warn", icon: "clock", subject: `${n} new lead${n === 1 ? "" : "s"}`,
        what: `untouched for over 48 hours${topB && topB.count < n ? `, ${topB.count} of them with ${topB.name}` : ""}`,
        figure: null, suggested: pt.suggested,
        action: { label: pt.label, href: untouchedLeadsHref(), primary: false },
        why: `No call, email, meeting or note since they arrived.` + (topR ? ` ${topR.count} of them are held by ${pluralLabel(topR.label)}.` : "") + (topR ? pt.why : ""),
        meta: [input.untouched.byBranch.slice(0, 3).map((b) => `${b.name} ${b.count}`).join(" · "), topR ? pt.meta : ""].filter(Boolean).join(" · ") || null,
        links: [{ label: `See the ${n} leads →`, href: untouchedLeadsHref() }],
        drill: s.drill,
      });
    } else if (s.kind === "over_capacity") {
      const p = personOf(input.people, s.subject.id);
      if (!p || !compareToUsual(p.current.received, p.usual.received, p.hasUsual)) continue;
      const excess = Math.max(0, p.current.received - Math.round(p.usual.received));
      const plan = planReassign(input.people, p, excess, input.heldLoad ?? {}, input.flags7d ?? {});
      const pt = planText(plan, excess, p.positionLabel, "Reassign");
      out.push({
        id: s.id, category: "needs_action", tone: "warn", icon: "alert", subject: p.name,
        what: `received ${p.current.received} new leads, usual is ${Math.round(p.usual.received)}`,
        figure: { text: `${(Math.round((p.current.received / Math.round(p.usual.received)) * 10) / 10).toString()}× usual` },
        suggested: false,
        action: { label: pt.label, href: leadsOfPersonHref(p.userId), primary: false },
        why: `${p.name} received ${p.current.received} new leads against a usual ${Math.round(p.usual.received)}.` + (plan.kind !== "none" ? pt.why : ""),
        meta: [[p.positionLabel, p.branchName].filter(Boolean).join(", "), pt.meta].filter(Boolean).join(" · ") || null,
        links: [{ label: "See the leads →", href: leadsOfPersonHref(p.userId) }, { label: `${p.name}'s activity →`, personId: p.userId }],
        drill: s.drill,
      });
    } else if (s.kind === "stage_leak") {
      const f = input.stageFlows.find((x) => x.listId === s.subject.id);
      if (!f) continue;
      const reasons = input.leakReasons[f.listId] ?? [];
      out.push({
        id: s.id, category: "heads_up", tone: "info", icon: "archive", subject: f.name,
        what: input.baselineCovered === false ? `${f.out} leads moved back or archived` : `${f.out} leads moved back or archived, up from ${f.previousOut}`,
        figure: reasons[0] ? { text: "Top reason", strong: reasons[0].reason, textFirst: true } : null,
        suggested: false, action: null,
        why: `${f.out} of the ${f.base} leads that were in ${f.name} left it backwards or to Archive.`,
        meta: reasons.slice(0, 3).map((r) => `${r.reason} ${r.leads}`).join(" · ") || null,
        links: [{ label: `See the ${f.out} leads →`, drill: s.drill }],
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
        what: `delivered ${s.evidence.value} ${s.evidence.metric === "reached_applications" ? "students to Applications" : "leads to Prospects"}${above}`,
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
