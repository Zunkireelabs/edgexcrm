import { leadsOfPersonHref, untouchedLeadsHref } from "./leads-links";
import { pickLightestLoad } from "./suggest";
import { pluralLabel } from "./positions";
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
}

const personOf = (people: PersonRow[], id: string) => people.find((p) => p.userId === id);
const pctOf = (cur: number, base: number) => Math.round(Math.abs((cur - base) / base) * 100);

export function buildAttention(input: AttentionInput): AttentionItem[] {
  const out: AttentionItem[] = [];
  for (const s of input.signals) {
    if (s.kind === "activity_drop") {
      const p = personOf(input.people, s.subject.id);
      if (!p) continue;
      const cur = activityOf(p.current), usual = activityOf(p.usual);
      const target = pickLightestLoad(input.people, p);
      const stale = input.staleHeld[p.userId] ?? 0;
      out.push({
        id: s.id, category: "needs_action", tone: "bad", icon: "down", subject: p.name,
        what: `activity down ${pctOf(cur, usual)}% against usual`,
        figure: stale > 0 ? { strong: String(stale), text: " leads untouched" } : { strong: String(cur), text: ` vs usual ${Math.round(usual)}` },
        suggested: !!target && stale > 0,
        action: target && stale > 0 ? { label: `Reassign ${stale} to ${target.name}`, href: leadsOfPersonHref(p.userId), primary: true } : { label: "Review leads", href: leadsOfPersonHref(p.userId), primary: true },
        why: `Calls, notes and stage moves dropped together: ${cur} against a usual ${Math.round(usual)}.` +
          (stale > 0 ? ` ${stale} of the leads ${p.name} holds have had no call or note this period.` : "") +
          (target ? ` ${target.name} has the lightest ${p.positionLabel} load this period (${target.current.received} new leads).` : ""),
        meta: [`${p.current.calls} calls vs usual ${Math.round(p.usual.calls)}`, `${p.notesNew + p.notesEdited} notes vs usual ${Math.round(p.usual.notes)}`, [p.positionLabel, p.branchName].filter(Boolean).join(", "), ...(target ? [`${target.name} has the lightest load this period`] : [])].join(" · "),
        links: [{ label: stale > 0 ? `See the ${stale} leads →` : "See their leads →", href: leadsOfPersonHref(p.userId) }, { label: `${p.name}'s week →`, personId: p.userId }],
        drill: s.drill,
      });
    } else if (s.kind === "untouched_leads") {
      const n = input.untouched.count;
      const topB = input.untouched.byBranch[0];
      const topR = input.untouched.byRole[0];
      out.push({
        id: s.id, category: "needs_action", tone: "warn", icon: "clock", subject: `${n} new lead${n === 1 ? "" : "s"}`,
        what: `untouched for over 48 hours${topB && topB.count < n ? `, ${topB.count} of them with ${topB.name}` : ""}`,
        figure: null, suggested: !!topR,
        action: { label: topR ? `Spread across ${pluralLabel(topR.label)}` : "Review leads", href: untouchedLeadsHref(), primary: false },
        why: `No call, email, meeting or note since they arrived.` + (topR ? ` ${topR.count} of them are held by ${pluralLabel(topR.label)}.` : ""),
        meta: input.untouched.byBranch.slice(0, 3).map((b) => `${b.name} ${b.count}`).join(" · ") || null,
        links: [{ label: `See the ${n} leads →`, href: untouchedLeadsHref() }],
        drill: s.drill,
      });
    } else if (s.kind === "over_capacity") {
      const p = personOf(input.people, s.subject.id);
      if (!p || p.usual.received <= 0) continue;
      const target = pickLightestLoad(input.people, p);
      out.push({
        id: s.id, category: "needs_action", tone: "warn", icon: "alert", subject: p.name,
        what: `received ${p.current.received} new leads, usual is ${Math.round(p.usual.received)}`,
        figure: { text: `${(Math.round((p.current.received / p.usual.received) * 10) / 10).toString()}× usual` },
        suggested: false,
        action: { label: target ? `Rebalance with ${target.name}` : "Rebalance", href: leadsOfPersonHref(p.userId), primary: false },
        why: `${p.name} received ${p.current.received} new leads against a usual ${Math.round(p.usual.received)}.` + (target ? ` ${target.name} received ${target.current.received}.` : ""),
        meta: [p.positionLabel, p.branchName].filter(Boolean).join(", ") || null,
        links: [{ label: "See the leads →", href: leadsOfPersonHref(p.userId) }, { label: `${p.name}'s week →`, personId: p.userId }],
        drill: s.drill,
      });
    } else if (s.kind === "stage_leak") {
      const f = input.stageFlows.find((x) => x.listId === s.subject.id);
      if (!f) continue;
      const reasons = input.leakReasons[f.listId] ?? [];
      out.push({
        id: s.id, category: "heads_up", tone: "info", icon: "archive", subject: f.name,
        what: `${f.out} leads moved back or archived, up from ${f.previousOut}`,
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
      const above = s.evidence.baseline > 0 ? `, ${pctOf(s.evidence.value, s.evidence.baseline)}% above usual` : "";
      out.push({
        id: s.id, category: "wins", tone: "good", icon: "up", subject: p.name,
        what: `delivered ${s.evidence.value} ${s.evidence.metric === "reached_applications" ? "students to Applications" : "leads to Prospects"}${above}`,
        figure: { text: `Top ${p.positionLabel.toLowerCase()} this period` },
        suggested: false, action: null, why: s.detail, meta: null,
        links: [{ label: "See the records →", drill: s.drill }, { label: `${p.name}'s week →`, personId: p.userId }], drill: s.drill,
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
