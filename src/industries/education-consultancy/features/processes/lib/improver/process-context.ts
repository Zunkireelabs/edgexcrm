import { describeWindow, type ProcessPolicy } from "../policy";
import type { ProcessKey } from "../keys";
import { describeOfficeHours } from "../working-hours";
import { renderStepText, type ProcessSpec } from "../spec";

/**
 * What the other agents (follow-up drafter, lead triage) read about the live process (EDGEX-109 P4b, decision 9). Pure: the tool in
 * `ai/tools/process-context.ts` does the reads. The agents are told to FOLLOW this, cite it, and report deviations; they never claim compliance.
 */

export interface LeadProcessSignals {
  /** `education_lead_terminal`: 'won' | 'lost' | 'other' | null (open). */
  terminal: string | null;
  /** The slug of the lead's stage list ('enrolled', ...). */
  listSlug: string | null;
  /** The lead has at least one activity or human note. */
  worked: boolean;
}

/**
 * The ONE process that fits a lead: a new or unworked (open) lead follows New lead → first call; a student whose visa is granted (won) and who
 * is not Enrolled yet follows Visa → Enrolled. Anything else fits none: the agent is told so and does not invent a process.
 */
export function processForLead(s: LeadProcessSignals): ProcessKey | null {
  if (s.terminal === "won") return s.listSlug === "enrolled" ? null : "visa_to_enrolled";
  if (s.terminal === null && !s.worked) return "new_lead_first_call";
  return null;
}

const plain = (t: string): string => t.replace(/\*\*/g, "");

export interface ContextStep {
  step: string;
  title: string;
  who: string[];
  target: string;
  /** The SOP wording as people read it ({target} rendered, bold markers removed). */
  text: string;
}

export function contextSteps(spec: ProcessSpec): ContextStep[] {
  return spec.steps.map((s) => ({
    step: s.key,
    title: s.title,
    who: s.who,
    target: s.targetText ?? `${s.target.op === ">=" ? "at least" : "at most"} ${s.target.value}${s.target.unit === "percent" ? "%" : s.target.unit === "min" ? " min" : ""}`,
    text: plain(renderStepText(s.text, s.targetText)),
  }));
}

/** The numbers the product runs on for the new-lead process, in words (from the policy reader, so today's defaults when nothing is live). */
export function policyLines(p: ProcessPolicy): string[] {
  return [
    `First contact within ${describeWindow(p.firstContact.minutes, p.firstContact.clock)}.`,
    `Owner assigned within ${describeWindow(p.assignWithinMin, "clock")}.`,
    `Office hours: ${describeOfficeHours(p.officeHours)}.`,
    `After ${p.unreachableAfterCalls} unanswered calls, send one message.`,
    `Decide within ${p.decideWithinDays} days.`,
  ];
}

export const FOLLOW_RULE =
  "Follow this process when you act on the lead and say which step you are following. If what you see deviates from it (a missed window, a step skipped), report the deviation plainly. Never claim the process was followed unless the lead's own data shows it.";
