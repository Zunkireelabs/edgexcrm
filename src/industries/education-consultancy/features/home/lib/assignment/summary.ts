import { agreement } from "./outcome";
import type { NeedsYouRow } from "../needs-you";

export interface AutoDecision {
  id: string;
  leadId: string;
  pickedUserId: string;
}

/** "Asha +3, Chirag +3": who received how many, biggest first, ties by name. */
export function whoGotWhat(decisions: AutoDecision[], names: ReadonlyMap<string, string>): string {
  const counts = new Map<string, number>();
  for (const d of decisions) counts.set(d.pickedUserId, (counts.get(d.pickedUserId) ?? 0) + 1);
  return [...counts.entries()]
    .map(([id, n]) => ({ name: (names.get(id) ?? "Someone").split(/\s+/)[0], n }))
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))
    .map((x) => `${x.name} +${x.n}`)
    .join(", ");
}

/**
 * The owner's FYI row for leads smart assignment assigned on its own (auto mode): what happened, who got them, how many
 * already had contact, and Undo (all of them) / the rule. Never urgent (neutral tone): the owner is informed, not asked.
 */
export function autoAssignedRow(decisions: AutoDecision[], names: ReadonlyMap<string, string>, contacted: number): NeedsYouRow | null {
  if (decisions.length === 0) return null;
  const n = decisions.length;
  return {
    key: "auto_assigned",
    tone: "new",
    icon: "user-switch",
    title: `${n} new ${n === 1 ? "lead was" : "leads were"} assigned automatically`,
    chip: { text: "By your rule · FYI", tone: "neutral" },
    why: `${whoGotWhat(decisions, names)} · ${contacted} of ${n} already contacted`,
    actions: [
      { type: "undo_assignment", label: "Undo", decisionIds: decisions.map((d) => d.id) },
      { type: "link", label: "Rule", href: "/settings" },
    ],
  };
}

export interface ShadowCard {
  matched: number;
  total: number;
  pct: number | null;
}

/** "Smart assignment agreed with your managers 34 of 40 times (85%)": the evidence for turning it on. */
export function shadowCard(decisions: Array<{ mode: "shadow" | "auto"; outcome: "matched" | "overridden" | "undone" | null }>): ShadowCard {
  return agreement(decisions);
}
