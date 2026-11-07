import { clock12, dayBounds } from "./time";
import type { HomeLead, HomeTask } from "./types";
import { localDate } from "./time";
import type { RuleCtx } from "./rules/ctx";

export interface AgendaEntry {
  /** "11:30" or null for an untimed entry. */
  time: string | null;
  title: string;
  sub: string | null;
  at: number;
  /** Timed entry whose time is within the next hour (blue time). */
  soon: boolean;
}

export interface ScheduledActivity {
  id: string;
  activityType: "call" | "meeting" | "email";
  subject: string | null;
  location: string | null;
  scheduledAt: string;
  leadName: string | null;
}

/**
 * The "Today" card: timed call-backs (leads.callback_due_at today), pending scheduled activities that
 * getMySchedule already returns (unchanged), then untimed tasks due today. Timed first by time, untimed last.
 */
export function buildAgenda(
  leads: HomeLead[],
  schedule: ScheduledActivity[],
  tasks: HomeTask[],
  ctx: RuleCtx,
): AgendaEntry[] {
  const { start, end } = dayBounds(ctx.now, ctx.tz);
  const today = localDate(ctx.now, ctx.tz);
  const timed: AgendaEntry[] = [];
  const inDay = (iso: string) => {
    const t = Date.parse(iso);
    return t >= start.getTime() && t < end.getTime() ? t : null;
  };
  for (const l of leads) {
    if (!l.isActive || !l.callbackDueAt) continue;
    const t = inDay(l.callbackDueAt);
    if (t === null) continue;
    timed.push({ time: clock12(new Date(t), ctx.tz), title: `Call back · ${l.name}`, sub: l.context || null, at: t, soon: t >= ctx.now.getTime() && t - ctx.now.getTime() <= 3_600_000 });
  }
  for (const s of schedule) {
    const t = inDay(s.scheduledAt);
    if (t === null) continue;
    const verb = s.activityType === "call" ? "Call" : s.activityType === "meeting" ? "Meeting" : "Email";
    timed.push({
      time: clock12(new Date(t), ctx.tz),
      title: `${verb}${s.leadName ? ` · ${s.leadName}` : ""}`,
      sub: [s.subject, s.location].filter(Boolean).join(" · ") || null,
      at: t,
      soon: t >= ctx.now.getTime() && t - ctx.now.getTime() <= 3_600_000,
    });
  }
  timed.sort((a, b) => a.at - b.at || a.title.localeCompare(b.title));
  const untimed: AgendaEntry[] = tasks
    .filter((t) => t.status !== "done" && t.dueDate === today)
    .map((t) => ({ time: null, title: t.title, sub: t.assignedByName ? `task from ${t.assignedByName}` : "task", at: Number.MAX_SAFE_INTEGER, soon: false }))
    .sort((a, b) => a.title.localeCompare(b.title));
  return [...timed, ...untimed];
}
