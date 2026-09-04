import { toLocalDateString } from "@/lib/date";
import type { ScheduleActivity, PersonalTask } from "@/lib/supabase/queries";
import type { Lead } from "@/types/database";

export interface HomeTip {
  id: string;
  text: string;
}

const STALE_LEAD_DAYS = 5;
const CLOSED_LEAD_STATUSES = new Set(["enrolled", "rejected", "closed", "converted", "lost"]);

const FALLBACK_TIPS: HomeTip[] = [
  { id: "fallback-follow-up", text: "Leads followed up within 24 hours are far more likely to convert — keep response time tight." },
  { id: "fallback-notes", text: "A quick note after every call keeps the next follow-up sharp, even if someone else picks it up." },
  { id: "fallback-pipeline", text: "Review your pipeline stages weekly — leads quietly stuck in one stage are easy to miss otherwise." },
  { id: "fallback-tags", text: "Use tags to segment leads by intent or source — it makes bulk follow-ups much faster." },
];

/**
 * Rule-based "tip of the day": surfaces the single most useful, actionable
 * insight from the user's own Home data (overdue tasks/follow-ups first,
 * then stale leads, then unread inbox), falling back to a rotating generic
 * tip only when nothing urgent applies. No AI call — same derive-from-data
 * approach as the insights KPI auto-derivation.
 */
export function deriveHomeTip(input: {
  openTasks: PersonalTask[];
  schedule: ScheduleActivity[];
  leads: Lead[];
  unreadCount: number;
}): HomeTip {
  const { openTasks, schedule, leads, unreadCount } = input;
  const today = toLocalDateString(new Date());
  const nowIso = new Date().toISOString();

  const overdueTasks = openTasks.filter((t) => t.due_date !== null && t.due_date < today).length;
  if (overdueTasks > 0) {
    return {
      id: "overdue-tasks",
      text: `You have ${overdueTasks} overdue ${overdueTasks === 1 ? "task" : "tasks"}. Clearing them now keeps the rest of your day on schedule.`,
    };
  }

  const overdueFollowUps = schedule.filter((a) => a.scheduled_at < nowIso).length;
  if (overdueFollowUps > 0) {
    return {
      id: "overdue-follow-ups",
      text: `${overdueFollowUps} follow-up${overdueFollowUps === 1 ? " is" : "s are"} overdue. Reconnecting today keeps those leads warm.`,
    };
  }

  const staleCutoff = Date.now() - STALE_LEAD_DAYS * 24 * 60 * 60 * 1000;
  const staleLeads = leads.filter(
    (l) => !CLOSED_LEAD_STATUSES.has(l.status ?? "") && new Date(l.updated_at).getTime() < staleCutoff,
  ).length;
  if (staleLeads > 0) {
    return {
      id: "stale-leads",
      text: `${staleLeads} of your leads ${staleLeads === 1 ? "hasn't" : "haven't"} been touched in ${STALE_LEAD_DAYS}+ days. A quick check-in could revive ${staleLeads === 1 ? "it" : "them"}.`,
    };
  }

  if (unreadCount > 0) {
    return {
      id: "unread-inbox",
      text: `You have ${unreadCount} unread ${unreadCount === 1 ? "message" : "messages"} waiting in your inbox.`,
    };
  }

  const dayIndex = Math.floor(Date.now() / (24 * 60 * 60 * 1000));
  return FALLBACK_TIPS[dayIndex % FALLBACK_TIPS.length];
}
