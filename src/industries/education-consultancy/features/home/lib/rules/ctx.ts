import type { OfficeHours } from "../../../processes/lib/working-hours";
import type { ProcessPolicy } from "../../../processes/lib/policy";

/**
 * The slice of the live process the Home rules run on (EDGEX-109 P3). Built from `ProcessPolicy` (the one reader). Absent, or `live`
 * false (no process is live yet), means today's behaviour: a plain "New · 15 min" chip and 3 unanswered calls.
 */
export interface HomePolicy {
  /** A live New-lead process is driving these numbers. False = today's defaults. */
  live: boolean;
  firstContact: { minutes: number; clock: "clock" | "working" };
  officeHours: OfficeHours;
  unreachableAfterCalls: number;
}

export const toHomePolicy = (p: ProcessPolicy): HomePolicy => ({ live: p.source !== null, firstContact: p.firstContact, officeHours: p.officeHours, unreachableAfterCalls: p.unreachableAfterCalls });

export interface RuleCtx {
  now: Date;
  /** Tenant timezone (tenants.timezone). Every day boundary is cut here, never in the server's zone. */
  tz: string;
  /** The live process's numbers. Optional so every rule still runs (and tests stay) on today's defaults. */
  policy?: HomePolicy;
}
