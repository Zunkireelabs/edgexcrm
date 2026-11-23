import { describeOfficeHours } from "../../processes/lib/working-hours";
import { describeWindow, type ProcessPolicy } from "../../processes/lib/policy";
import type { AssignmentMode } from "./assignment/outcome";

/** "Rules from your processes" (T2): what Home is running and where it comes from. Pure. */
export interface RulesCard {
  rows: Array<{ label: string; value: string }>;
  /** "From New lead → first call v2, approved by Manish on 7 Nov." or the no-process sentence. */
  footer: string;
  /** The process behind it (owner/admin see "Open"); null when none is live. */
  href: string | null;
}

export const PROCESS_TITLE = "New lead → first call";
const MODE_WORDS: Record<AssignmentMode, string> = { off: "by hand", shadow: "shadow", auto: "auto" };

const day = (iso: string, tz: string): string => new Date(iso).toLocaleDateString("en-GB", { timeZone: tz, day: "numeric", month: "short" });

export function buildRulesCard(policy: ProcessPolicy, mode: AssignmentMode, tz: string): RulesCard {
  const s = policy.source;
  return {
    rows: [
      { label: "Assign within", value: `${policy.assignWithinMin} min · ${MODE_WORDS[mode]}` },
      { label: "First contact", value: describeWindow(policy.firstContact.minutes, policy.firstContact.clock) },
      { label: "Office hours", value: describeOfficeHours(policy.officeHours) },
    ],
    footer: s
      ? `From ${PROCESS_TITLE} v${s.version}${s.approvedByName || s.approvedAt ? ", approved" : ""}${s.approvedByName ? ` by ${s.approvedByName}` : ""}${s.approvedAt ? ` on ${day(s.approvedAt, tz)}` : ""}.`
      : "Today's defaults: no process is live yet.",
    href: s ? `/processes/${s.processKey}` : null,
  };
}
