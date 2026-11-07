import { UNREACHABLE_CALLS } from "../../home/lib/rules/unreachable";
import type { ProcessKey } from "./keys";
import { parseProcessSpec, type ProcessSpec } from "./spec";

/**
 * The as-is v1 of each process, written from the tenant's REAL setup (not invented): the positions that really take new leads, the
 * tenant's own stage names, and the Home rule values that run today. The wording follows the P2 SOP template in temp_ss/processes-v1.html.
 * Targets are today's rules (assign 5 min, first contact 1 h, call-back on the day, decide in 14 days) and the percentages from the mockup.
 */

/** The values the Home rules use today. First contact: education_home_impact()'s 60 minutes (migration 284). */
export const HOME_RULES = {
  firstContactMinutes: 60,
  assignWithinMinutes: 5,
  unreachableAfterCalls: UNREACHABLE_CALLS,
  decideWithinDays: 14,
} as const;

export interface BaselineSetup {
  tenantName: string;
  /** Positions that really take first contact on new leads (A3d learned set, or the saved one), in order. */
  firstTouchPositions: Array<{ slug: string; name: string }>;
  /** The tenant's own names for the stages the text mentions. */
  stageNames: { qualified: string; enrolled: string };
}

export const DEFAULT_STAGE_NAMES = { qualified: "Qualified", enrolled: "Enrolled" } as const;

const joinOr = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "a counsellor") : `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`);

export function buildBaselineSpec(processKey: ProcessKey, setup: BaselineSetup): ProcessSpec {
  const positions = setup.firstTouchPositions;
  const who = positions.map((p) => p.slug);
  const names = joinOr(positions.map((p) => p.name));
  const { qualified, enrolled } = setup.stageNames;
  const r = HOME_RULES;
  const hours = r.firstContactMinutes === 60 ? "1 hour" : `${r.firstContactMinutes} minutes`;

  const specs: Record<ProcessKey, ProcessSpec> = {
    new_lead_first_call: {
      summary: `How ${setup.tenantName || "your team"} turns a new enquiry into a first conversation.`,
      drivesSummary: "Home rules, smart assignment, call-back reminders",
      purpose: "Every new enquiry hears from a real person fast, while they are still choosing an agency.",
      trigger: {
        text: "A lead is created by a form, an event page, a walk-in or staff. Imports don't count.",
        event: "lead created",
        title: "A new lead arrives",
        sources: "Website forms, events, walk-ins",
        target: "every lead recorded once",
        drives: ["duplicate check"],
      },
      dataNeeded: "Name and phone; destination and intake if given. Branch, if the form knows it.",
      steps: [
        {
          key: "assign",
          targetText: `within ${r.assignWithinMinutes} minutes`,
          show: { metric: "owner_wait_median_min" },
          title: "Gets an owner",
          who: ["branch-manager"],
          target: { metric: "owner_within_5min_pct", op: ">=", value: 90, unit: "percent" },
          drives: ["Home: Assign new leads", "Smart assignment"],
          reads: ["assigned_to"],
          text: `**A manager assigns it** to ${names} in the lead's branch within ${r.assignWithinMinutes} minutes.`,
        },
        {
          key: "first_contact",
          targetText: `within ${hours}`,
          title: "First contact",
          who,
          target: { metric: "first_contact_1h_pct", op: ">=", value: 80, unit: "percent" },
          drives: ["Home: new lead not called"],
          reads: ["lead_activities", "lead_notes"],
          text: `**The owner calls** within ${hours}. A logged call or a note both count.`,
        },
        {
          key: "call_back",
          targetText: "on the day booked",
          title: "Call-back kept",
          who,
          target: { metric: "callbacks_kept_pct", op: ">=", value: 80, unit: "percent" },
          drives: ["Home: call-backs", `Unreachable after ${r.unreachableAfterCalls}`],
          reads: ["callback_due_at"],
          text: `**If there's no answer,** book a call-back and keep it on the day. After ${r.unreachableAfterCalls} unanswered calls, send one message.`,
        },
        {
          key: "decide",
          targetText: `decided within ${r.decideWithinDays} days`,
          title: `${qualified}, or dropped with a reason`,
          who,
          target: { metric: "reached_qualified_pct", op: ">=", value: 90, unit: "percent" },
          drives: [`Stage: ${qualified}`],
          kind: "done",
          reads: ["list", "status"],
          text: `**Within ${r.decideWithinDays} days,** move the lead to ${qualified} or drop it with a reason.`,
        },
      ],
      doneWhen: `The lead is ${qualified}, or dropped with a reason.`,
      exceptions: [
        "The lead asked to be called at a set time: that time is the target.",
        "The owner is on approved leave: the branch manager reassigns.",
      ],
      example: "A student fills the Australia form at 10:12. The counsellor gets it at 10:14, calls at 10:40 (no answer), books 4 pm, talks at 4:05 and moves the lead to Qualified the same day.",
    },
    visa_to_enrolled: {
      summary: `How ${setup.tenantName || "your team"} moves a student with an approved visa to ${enrolled}.`,
      drivesSummary: `the Applications and ${enrolled} stages`,
      purpose: "A student whose visa is approved is moved to the Enrolled stage, so the team can see who has actually started.",
      trigger: {
        text: "An application reaches a winning (won) status.",
        event: "application status set to won",
        title: "A student's visa is approved",
        sources: "Applications set to won",
        target: "every won student handled",
        drives: ["Applications"],
      },
      dataNeeded: "The student's application, the visa decision and the intake.",
      steps: [
        {
          key: "move_to_enrolled",
          targetText: "every won student moved",
          title: `Moved to ${enrolled}`,
          who,
          target: { metric: "moved_to_enrolled_pct", op: ">=", value: 100, unit: "percent" },
          drives: [`Stage: ${enrolled}`, "Applications"],
          reads: ["list", "status"],
          text: `**When the visa is approved,** the counsellor moves the student's lead to ${enrolled}.`,
        },
      ],
      doneWhen: `The student is in ${enrolled}.`,
      exceptions: ["The student defers the intake: the lead stays where it is until the new intake is confirmed."],
      example: `A student's visa is approved on Monday. The counsellor moves the lead to ${enrolled} the same day.`,
    },
    dropping_a_student: {
      summary: `How ${setup.tenantName || "your team"} records why a student is dropped.`,
      drivesSummary: "the lost statuses",
      purpose: "When a student is dropped, we record why, so we can see what is costing us students.",
      trigger: {
        text: "A lead or application is moved to a lost status.",
        event: "lead status set to lost",
        title: "A student is dropped",
        sources: "Leads and applications set to lost",
        target: "every drop handled",
        drives: ["The lost statuses"],
      },
      dataNeeded: "The reason the student is dropped.",
      steps: [
        {
          key: "record_reason",
          targetText: "every drop has a reason",
          title: "Drop reason recorded",
          who,
          target: { metric: "drops_with_reason_pct", op: ">=", value: 100, unit: "percent" },
          drives: ["The lost statuses"],
          reads: ["status"],
          text: "**Every dropped student has a reason recorded.** EdgeX can't record a reason yet, so today none has one.",
        },
      ],
      doneWhen: "The student is dropped and the reason is on the record.",
      exceptions: ["A duplicate lead is merged, not dropped."],
      example: "A student chooses another country. The counsellor drops the lead and records the reason.",
    },
    leaver_handover: {
      summary: `How ${setup.tenantName || "your team"} hands over a leaver's leads.`,
      drivesSummary: "Team → remove member",
      purpose: "When someone leaves the team, their open leads go to someone else the same day.",
      trigger: {
        text: "A team member is removed from the team.",
        event: "team member removed",
        title: "A team member leaves",
        sources: "Team → remove member",
        target: "handed over on their last day",
        drives: ["Team → remove member"],
      },
      dataNeeded: "The leaver's open leads and the branch they belong to.",
      steps: [
        {
          key: "no_open_leads",
          targetText: "no open leads left",
          title: "No open leads left with a leaver",
          who: ["branch-manager"],
          target: { metric: "live_leads_held", op: "<=", value: 0, unit: "count" },
          drives: ["Team → remove member"],
          reads: ["assigned_to"],
          text: "**A manager reassigns every open lead** of the leaver before or on their last day.",
        },
        {
          key: "no_leavers_holding",
          targetText: "no leaver holds a lead",
          title: "No leaver still holds leads",
          who: ["branch-manager"],
          target: { metric: "leavers_holding", op: "<=", value: 0, unit: "count" },
          drives: ["Team → remove member"],
          reads: ["assigned_to"],
          text: "**Closed and archived leads are handed over too,** so nobody who has left still appears as an owner.",
        },
      ],
      doneWhen: "No lead is held by someone who is no longer on the team.",
      exceptions: ["The leaver's leads are already closed: they are handed over when convenient."],
      example: "A counsellor resigns on Friday. The manager moves their open leads to the branch pool that morning.",
    },
  };

  // Self-check: a baseline we write must pass our own schema and registry.
  return parseProcessSpec(processKey, specs[processKey]);
}
