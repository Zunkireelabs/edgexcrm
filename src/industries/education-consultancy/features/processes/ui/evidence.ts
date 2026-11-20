import type { Evidence } from "../lib/changes";
import type { ProcessView } from "../server/load-processes";

/** One tickable evidence chip: the process's own live numbers, captured when the suggestion is made. */
export interface EvidenceOption {
  evidence: Evidence;
  /** Leading number(s), shown bold ("60 of 132", "17%"). */
  bold: string;
  rest: string;
  /** The step it comes from ("First contact"), for the "· First contact" tail. */
  where: string;
}

/** Splits "62 arrived outside 9–6." into bold "62" + rest. A sentence that doesn't start with a number gets no bold. */
export function splitLeadingNumber(text: string): { bold: string; rest: string } {
  const m = /^(\d[\d,.]*(?: of \d[\d,.]*)?%?)(.*)$/.exec(text);
  return m ? { bold: m[1], rest: m[2] } : { bold: "", rest: text };
}

/** Chips from the Trigger card's sentences and every step's number. Steps with no value yet offer nothing. */
export function evidenceOptions(p: Pick<ProcessView, "trigger" | "steps" | "spec">): EvidenceOption[] {
  const out: EvidenceOption[] = [];
  const triggerName = p.spec?.trigger.title ?? "Trigger";
  if (p.trigger) {
    for (const sentence of p.trigger.detail.split(/(?<=\.)\s+/).filter(Boolean)) {
      const { bold, rest } = splitLeadingNumber(sentence.replace(/\.$/, ""));
      out.push({ evidence: { metric: "trigger", label: sentence.replace(/\.$/, ""), value: p.trigger.value, stepKey: null }, bold, rest, where: triggerName });
    }
  }
  for (const s of p.steps) {
    if (s.value === null) continue;
    const label = `${s.big} ${s.metricLabel}${s.small ? ` (${s.small})` : ""}`;
    out.push({ evidence: { metric: s.target.metric, label, value: s.value, stepKey: s.key }, bold: s.big, rest: ` ${s.metricLabel}${s.small ? ` (${s.small})` : ""}`, where: s.title });
  }
  return out;
}
