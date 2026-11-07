import { callbackRules } from "./rules/callbacks";
import type { RuleCtx } from "./rules/ctx";
import { deadlineDocsRule } from "./rules/deadline-docs";
import { goingQuietRule } from "./rules/going-quiet";
import { newUncalledRule } from "./rules/new-uncalled";
import { replyWaitingRule } from "./rules/reply-waiting";
import { stuckInStageRule } from "./rules/stuck-in-stage";
import { taskDueRule } from "./rules/task-due";
import { rankItems } from "./rank";
import { dayBounds } from "./time";
import {
  KIND_FILTER,
  type DoNextFilter,
  type DoNextItem,
  type HomeApplication,
  type HomeConversation,
  type HomeLead,
  type HomeTask,
} from "./types";

export interface HomeInputs {
  userId: string;
  /** Leads assigned to this user, the ONLY lead source: a person never gets another person's item. */
  leads: HomeLead[];
  conversations: HomeConversation[];
  tasks: HomeTask[];
  applications: HomeApplication[];
  submitStageByPipeline: ReadonlyMap<string | null, number>;
  medianDwellDays: ReadonlyMap<string, number>;
  /** Item keys the user snoozed whose `until` is still in the future. */
  snoozedKeys: ReadonlySet<string>;
}

export interface DoNextResult {
  items: DoNextItem[];
  counts: Record<DoNextFilter, number>;
  /** Call-backs booked for the tenant-local day (any time today, including ones already due). */
  bookedToday: number;
}

export function buildDoNext(input: HomeInputs, ctx: RuleCtx): DoNextResult {
  const loud: DoNextItem[] = [
    ...newUncalledRule(input.leads, ctx),
    ...replyWaitingRule(input.conversations, ctx),
    ...callbackRules(input.leads, ctx),
    ...deadlineDocsRule(input.applications, input.submitStageByPipeline, ctx),
    ...taskDueRule(input.tasks, ctx),
    ...stuckInStageRule(input.applications, input.medianDwellDays, ctx),
  ];
  // A lead already on the list for a louder reason is not also "going quiet".
  const covered = new Set(loud.flatMap((i) => (i.leadId ? [i.leadId] : [])));
  const all = [...loud, ...goingQuietRule(input.leads, ctx, input.userId, covered)];
  const items = rankItems(all.filter((i) => !input.snoozedKeys.has(i.key)));

  const counts: Record<DoNextFilter, number> = { all: items.length, calls: 0, messages: 0, documents: 0, tasks: 0 };
  for (const i of items) counts[KIND_FILTER[i.kind]] += 1;

  const { start, end } = dayBounds(ctx.now, ctx.tz);
  const bookedToday = input.leads.filter((l) => {
    if (!l.isActive || !l.callbackDueAt) return false;
    const t = Date.parse(l.callbackDueAt);
    return t >= start.getTime() && t < end.getTime();
  }).length;

  return { items, counts, bookedToday };
}

export function filterItems(items: DoNextItem[], filter: DoNextFilter): DoNextItem[] {
  return filter === "all" ? items : items.filter((i) => KIND_FILTER[i.kind] === filter);
}
