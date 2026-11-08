import type { AuthContext } from "@/lib/api/auth";
import { scopedClient } from "@/lib/supabase/scoped";
import { getMySchedule } from "@/lib/supabase/queries";
import type { TenantConfig } from "@/types/database";
import { buildAgenda, type AgendaEntry, type ScheduledActivity } from "../lib/agenda";
import { buildDoNext, type DoNextResult } from "../lib/build";
import { greeting, lede, shortDate } from "../lib/greeting";
import { localDate } from "../lib/time";
import type { WeekMetric } from "../lib/week-stats";
import { loadMyApplications, loadMyConversations, loadMyLeads, loadMyTasks, loadSnoozedKeys } from "./load-home";
import { loadMyWeek } from "./load-week";
import { loadProcessPolicy } from "../../processes/server/policy";
import { toHomePolicy } from "../lib/rules/ctx";

export interface HomeData {
  /** Tenant timezone: the call log reads the picked date/time in this zone, not the browser's. */
  tz: string;
  greeting: string;
  lede: string;
  dateShort: string;
  doNext: DoNextResult;
  agenda: AgendaEntry[];
  week: WeekMetric[];
  /** Per lead: the next stage in its list (for the call log's "Move to next stage"). */
  nextStageByLead: Record<string, { id: string; name: string } | null>;
  /** "next: 11:30 call back Nabin" for the phone layout. */
  nextUp: string | null;
  /**
   * First calls are counted in office hours (the live process says so). `processHref` is the link to that process: only owner/admin
   * get it (a counsellor gets a 404 on /processes), so everyone else sees the text without the link.
   */
  firstCalls: { working: boolean; processHref: string | null };
}

/** Everything the education Home needs for one person. Reads only that person's own work. */
export async function loadHome(
  auth: AuthContext,
  tenant: { timezone: string | null; config: TenantConfig | null },
  firstName: string,
  now: Date = new Date(),
  opts: { withWeek?: boolean } = {},
): Promise<HomeData> {
  const tz = tenant.timezone ?? "Asia/Kathmandu";
  const db = await scopedClient(auth);
  const today = localDate(now, tz);

  // The live New-lead process as numbers. Never throws: any failure is today's values (source null).
  const policy = toHomePolicy(await loadProcessPolicy(db, auth.tenantId));
  const [{ leads, nextStageByLead }, tasks, apps, snoozed, schedule, week] = await Promise.all([
    loadMyLeads(db, auth.tenantId, auth.userId),
    loadMyTasks(db, auth.userId, today),
    loadMyApplications(db, auth.userId, today),
    loadSnoozedKeys(db, auth.userId, now),
    getMySchedule(auth.tenantId, auth.userId),
    opts.withWeek === false ? Promise.resolve([] as WeekMetric[]) : loadMyWeek(auth, db, tz, tenant.config, now, policy).catch(() => [] as WeekMetric[]),
  ]);
  const leadNames = new Map(leads.map((l) => [l.id, l.name]));
  const conversations = await loadMyConversations(db, auth.userId, leadNames);

  const ctx = { now, tz, policy };
  const doNext = buildDoNext(
    {
      userId: auth.userId,
      leads,
      conversations,
      tasks,
      applications: apps.applications,
      submitStageByPipeline: apps.submitStageByPipeline,
      // Median dwell needs stage history that isn't stored per person yet; the 14-day floor applies (see stuck rule).
      medianDwellDays: new Map(),
      snoozedKeys: snoozed,
    },
    ctx,
  );

  const sched: ScheduledActivity[] = (schedule ?? []).map((s) => {
    const l = (s as unknown as { leads?: { first_name: string | null; last_name: string | null } | null }).leads;
    return {
      id: s.id,
      activityType: s.activity_type as ScheduledActivity["activityType"],
      subject: s.subject ?? null,
      location: s.location ?? null,
      scheduledAt: s.scheduled_at as string,
      leadName: l ? [l.first_name, l.last_name].filter(Boolean).join(" ") || null : null,
    };
  });
  const agenda = buildAgenda(leads, sched, tasks, ctx);
  const nextTimed = agenda.find((e) => e.time && e.at >= now.getTime());
  return {
    tz,
    greeting: greeting(firstName, now, tz),
    lede: lede(now, tz, doNext.items.length, doNext.bookedToday),
    dateShort: shortDate(now, tz),
    doNext,
    agenda,
    week,
    nextStageByLead,
    nextUp: nextTimed ? nextUpLine(nextTimed) : null,
    firstCalls: { working: policy.live && policy.firstContact.clock === "working", processHref: auth.role === "owner" || auth.role === "admin" ? "/processes/new_lead_first_call" : null },
  };
}

/** "next: 11:30 call back Nabin KC": the verb is lower-cased, the person's name is not. */
function nextUpLine(e: AgendaEntry): string {
  const [verb, ...rest] = e.title.split(" \u00B7 ");
  return `next: ${e.time} ${verb.toLowerCase()}${rest.length ? ` ${rest.join(" \u00B7 ")}` : ""}`;
}
