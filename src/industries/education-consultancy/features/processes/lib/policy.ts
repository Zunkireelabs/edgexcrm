import { HOME_RULES } from "./baseline";
import { METRIC_REGISTRY } from "./metrics";
import type { ProcessSpec } from "./spec";
import { DEFAULT_OFFICE_HOURS, type OfficeHours } from "./working-hours";

/**
 * The live New-lead process, as numbers the product can run on (EDGEX-109 P3, decision 1). Pure: no DB. `server/policy.ts` loads the
 * live version and the office hours and calls `derivePolicy`. Home, smart assignment, the owner's numbers and the Rules card all read
 * THIS, never the spec directly.
 */
export interface ProcessPolicy {
  /** The first-contact window and which clock it runs on ("working" = inside office hours). */
  firstContact: { minutes: number; clock: "clock" | "working" };
  /** The owner-assignment window, in clock minutes (the target of the Assign step's metric). */
  assignWithinMin: number;
  unreachableAfterCalls: number;
  decideWithinDays: number;
  /** Position slugs from the First contact step's `who`. Null = no live process: the saved/learned positions apply (today's path). */
  firstTouchPositions: string[] | null;
  officeHours: OfficeHours;
  /** Where this came from. Null = no live version / unreadable: today's defaults are running. */
  source: { processKey: "new_lead_first_call"; version: number; approvedAt: string | null; ownerName: string | null; approvedByName: string | null } | null;
}

/** "1 hour", "1 working hour", "90 minutes", "90 working minutes". */
export function describeWindow(minutes: number, clock: "clock" | "working"): string {
  const w = clock === "working" ? "working " : "";
  if (minutes % 60 === 0) {
    const h = minutes / 60;
    return `${h} ${w}${h === 1 ? "hour" : "hours"}`;
  }
  return `${minutes} ${w}${minutes === 1 ? "minute" : "minutes"}`;
}

export const POLICY_PROCESS_KEY = "new_lead_first_call" as const;

/** Today's values (the emergency path, doc 07 §4.6): used when no process is live, or when anything fails. */
export function defaultPolicy(officeHours: OfficeHours = DEFAULT_OFFICE_HOURS): ProcessPolicy {
  return {
    firstContact: { minutes: HOME_RULES.firstContactMinutes, clock: "clock" },
    assignWithinMin: HOME_RULES.assignWithinMinutes,
    unreachableAfterCalls: HOME_RULES.unreachableAfterCalls,
    decideWithinDays: HOME_RULES.decideWithinDays,
    firstTouchPositions: null,
    officeHours,
    source: null,
  };
}

export interface LiveVersionInfo {
  version: number;
  approvedAt: string | null;
  ownerName: string | null;
  approvedByName?: string | null;
  spec: ProcessSpec;
}

/** Read the live spec. A step or metric that is missing keeps today's value for that one field. */
export function derivePolicy(live: LiveVersionInfo, officeHours: OfficeHours): ProcessPolicy {
  const base = defaultPolicy(officeHours);
  const reg = METRIC_REGISTRY[POLICY_PROCESS_KEY];
  const first = live.spec.steps.find((s) => s.key === "first_contact");
  const assign = live.spec.steps.find((s) => s.key === "assign");
  const fcDef = first ? reg[first.target.metric] : undefined;
  const asDef = assign ? reg[assign.target.metric] : undefined;
  return {
    firstContact: { minutes: fcDef?.windowMin ?? base.firstContact.minutes, clock: fcDef?.clock ?? base.firstContact.clock },
    assignWithinMin: asDef?.windowMin ?? base.assignWithinMin,
    unreachableAfterCalls: live.spec.rules?.unreachableAfterCalls ?? base.unreachableAfterCalls,
    decideWithinDays: live.spec.rules?.decideWithinDays ?? base.decideWithinDays,
    firstTouchPositions: first && first.who.length > 0 ? [...first.who] : null,
    officeHours,
    source: { processKey: POLICY_PROCESS_KEY, version: live.version, approvedAt: live.approvedAt, ownerName: live.ownerName, approvedByName: live.approvedByName ?? null },
  };
}
