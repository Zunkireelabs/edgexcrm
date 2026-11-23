"use client";

import { useRouter } from "next/navigation";
import {
  ArrowRightIcon, CheckIcon, CircleDashedIcon, ClockIcon, GraduationCapIcon, ShieldCheckIcon, UserIcon,
} from "@/components/icons";
import { followUpBadgeLabel } from "@/components/dashboard/leads/columns-registry";
import { PossibleDuplicatesCard } from "@/components/dashboard/lead/lead-tabs";
import type { Lead, LeadList, PipelineStage } from "@/types/database";
import { StatusChip } from "../record-preview/record-preview";
import { Avatar, Dot, HighlightCard, ListBox, ListRow, Section, ValueText, ViewAll, initialsOf } from "../record-preview/parts";
import { Timeline, TimelineSkeleton } from "../record-preview/timeline";
import { TasksSection } from "../record-preview/tasks-section";
import type { PreviewPayload } from "../record-preview/use-preview-data";
import { daysInStage, dueLabel, lastTouchCard, pickNextTask, relativeDays } from "../record-preview/lib/labels";
import { readyCard } from "../record-preview/lib/readiness";
import { pickIntake, pickTestScore, studyPlanCard } from "../record-preview/lib/study-plan";
import { plainText, type FeedItem } from "./lib/activity-merge";
import type { TabId } from "./lib/tabs";
import type { UnifiedTask } from "./lib/tasks-merge";
import { OrcaBrief } from "./orca-brief";

export interface OverviewNote { content: string; user_id: string; user_email: string; created_at: string }

export interface OverviewProps {
  lead: Lead;
  /** Preview payload (last touch, readiness, applications, branch…). null while it loads. */
  data: PreviewPayload | null;
  aiEnabled: boolean;
  currentUserId: string;
  memberNames: Record<string, string>;
  stages: PipelineStage[];
  leadLists: LeadList[];
  followUpStaleDays: number;
  feed: FeedItem[] | null;
  tasks: UnifiedTask[] | null;
  noteCount: number;
  latestNote: OverviewNote | null;
  isAdmin: boolean;
  applicationsTabOpen: boolean;
  goTab: (t: TabId) => void;
  onAddTask: () => void;
  onCompleteTask: (key: string) => void;
  onMerged: () => void;
}

/** Overview (EDGEX-153): Orca brief, 3×2 highlights, applications, latest activity, tasks, latest note. */
export function Overview(p: OverviewProps) {
  const { lead, data } = p;
  const router = useRouter();
  const nameOf = (id: string | null | undefined, fallback?: string | null) => (!id ? fallback ?? null : id === p.currentUserId ? "You" : p.memberNames[id] ?? fallback ?? null);
  const row = lead as Lead & { intake_term?: string | null };

  const list = p.leadLists.find((l) => l.id === lead.list_id) ?? null;
  const stage = p.stages.find((s) => s.id === lead.stage_id) ?? null;
  const stageLabel = [list?.name, stage?.name].filter(Boolean).join(" · ") || "No stage";

  const open = (p.tasks ?? []).filter((t) => !t.done);
  const next = pickNextTask(open);
  const nextDue = dueLabel(next?.due_date, new Date(), "md");

  const touch = lastTouchCard({
    lastTouchedAt: lead.last_touched_at, createdAt: lead.created_at,
    kind: data?.last_touch?.kind ?? null,
    who: data?.last_touch ? nameOf(data.last_touch.who_id, data.last_touch.who_name) : null,
    onHold: lead.on_hold, followUpLabel: followUpBadgeLabel(lead, p.followUpStaleDays), staleDays: p.followUpStaleDays, dateFormat: "md",
  });

  const assigneeName = lead.assigned_to ? nameOf(lead.assigned_to, p.memberNames[lead.assigned_to]) : null;
  const assigneeReal = lead.assigned_to ? p.memberNames[lead.assigned_to] ?? data?.assignee_name ?? null : null;

  const plan = studyPlanCard({
    destinations: lead.destinations ?? [],
    intake: data?.intake ?? pickIntake({ intakeTerm: row.intake_term ?? null, preferredIntake: (lead.custom_fields ?? {}).preferred_intake }),
    degreeLevel: lead.degree_level, fieldOfStudy: lead.field_of_study,
    test: pickTestScore({ ielts: lead.ielts_score, pte: lead.pte_score, toefl: lead.toefl_score }),
  });

  const ready = data ? readyCard({
    ready: data.readiness.ready, items: data.readiness.items, consentSignedAt: data.readiness.consent_signed_at,
    hasActiveConsentTemplate: data.readiness.has_active_consent_template, feeStatus: data.readiness.fee_status, dateFormat: "md",
  }) : null;

  return (
    <div className="px-4 pb-4 pt-1">
      <OrcaBrief leadId={lead.id} enabled={p.aiEnabled} />

      <Section title="Highlights" />
      <div className="grid grid-cols-3 gap-2 max-[560px]:grid-cols-2">
        <HighlightCard
          className="max-[430px]:order-3 max-[430px]:col-span-2" label="Stage · status" icon={<CircleDashedIcon />} valueTitle={stageLabel}
          value={<>{stage && <Dot color={stage.color} />}<ValueText>{stageLabel}</ValueText></>}
          sub={daysInStage(lead.stage_changed_at)}
        />

        {p.tasks ? (
          next ? (
            <HighlightCard
              className="max-[430px]:order-1" label="Next step" icon={<ArrowRightIcon />} editable
              onClick={() => (next.source === "task" ? router.push(`/tasks/${next.id}`) : p.goTab("tasks"))}
              tone={nextDue?.overdue ? "warn" : "ink"} subTone={nextDue?.overdue ? "warn" : "muted"}
              valueTitle={next.title} value={<ValueText>{next.title}</ValueText>}
              sub={[nextDue?.text, next.assignee_name ? (next.assignee_name === p.memberNames[p.currentUserId] ? "You" : next.assignee_name) : null].filter(Boolean).join(" · ")}
            />
          ) : (
            <HighlightCard className="max-[430px]:order-1" label="Next step" icon={<ArrowRightIcon />} editable onClick={p.onAddTask} tone="warn" value={<ValueText>None booked</ValueText>} sub="+ Add task" subTone="add" />
          )
        ) : (
          <HighlightCard className="max-[430px]:order-1" label="Next step" icon={<ArrowRightIcon />} loadingValue={140} loadingSub={90} />
        )}

        <HighlightCard
          className="max-[430px]:order-2" label="Last touch" icon={<ClockIcon />} tone={touch.amber ? "warn" : "ink"} valueTitle={touch.value}
          value={<ValueText>{touch.value}</ValueText>} {...(data ? { sub: touch.sub } : { loadingSub: 110 })}
        />

        <HighlightCard
          className="max-[430px]:order-4 max-[430px]:col-span-2" label="Counsellor" icon={<UserIcon />} valueTitle={assigneeName ?? "Unassigned"} tone={assigneeName ? "ink" : "empty"}
          value={assigneeName ? <><Avatar initials={initialsOf(assigneeReal ?? assigneeName)} /><ValueText>{assigneeName}</ValueText></> : <ValueText>Unassigned</ValueText>}
          sub={data?.branch_name ?? ""}
        />

        <HighlightCard className="max-[430px]:order-5 max-[430px]:col-span-2" label="Study plan" icon={<GraduationCapIcon />} tone={plan.empty ? "empty" : "ink"} valueTitle={plan.value} value={<ValueText>{plan.value}</ValueText>} sub={plan.sub} />

        {ready ? (
          <HighlightCard
            className="max-[430px]:order-6 max-[430px]:col-span-2" label="Ready to apply" icon={<ShieldCheckIcon />} tone={ready.tone === "good" ? "good" : "warn"}
            value={ready.tone === "good" ? <><CheckIcon className="size-[14px]" /><ValueText>{ready.value}</ValueText></> : <ValueText>{ready.value}</ValueText>}
            sub={ready.sub} subTitle={ready.subTitle}
          />
        ) : (
          <HighlightCard className="max-[430px]:order-6 max-[430px]:col-span-2" label="Ready to apply" icon={<ShieldCheckIcon />} loadingValue={70} loadingSub={130} />
        )}
      </div>

      {data && data.applications.count > 0 && (
        <>
          <Section title="Applications" count={data.applications.count} right={p.applicationsTabOpen ? <ViewAll onClick={() => p.goTab("applications")} /> : undefined} />
          <ListBox>
            {data.applications.items.map((a) => (
              <ListRow key={a.id}>
                <span className="min-w-0 flex-1 overflow-hidden text-ellipsis"><b className="font-medium">{a.university}</b> <em className="not-italic text-black/50">· {a.program}</em></span>
                <StatusChip status={a.stage_name ?? a.status} terminal={a.terminal_type} />
              </ListRow>
            ))}
          </ListBox>
        </>
      )}

      <Section title="Activity" right={<ViewAll onClick={() => p.goTab("activity")} />} />
      {p.feed ? <Timeline rows={p.feed.slice(0, 5)} currentUserId={p.currentUserId} dateFormat="md" /> : <TimelineSkeleton widths={["60%", "45%", "52%"]} />}

      {p.tasks && (
        <TasksSection
          count={open.length}
          items={open.map((t) => ({ id: t.key, title: t.title, due_date: t.due_date }))}
          onAdd={p.onAddTask} dateFormat="md"
          onComplete={p.onCompleteTask}
          onOpen={(key) => { const t = open.find((x) => x.key === key); if (t?.source === "task") router.push(`/tasks/${t.id}`); else p.goTab("tasks"); }}
        />
      )}

      {p.latestNote && (
        <>
          <Section title="Latest note" right={<ViewAll onClick={() => p.goTab("notes")} />} />
          <ListBox className="px-3 py-2.5">
            <p className="m-0 line-clamp-2 text-[14px] font-normal leading-5 text-[#2b2d2f]">{plainText(p.latestNote.content)}</p>
            <div className="mt-1.5 text-[12px] font-medium text-black/50">{nameOf(p.latestNote.user_id, p.latestNote.user_email) ?? "Someone"} · {relativeDays(p.latestNote.created_at)}</div>
          </ListBox>
          {p.noteCount > 1 && <div className="mt-1 px-1 text-right text-[13px]"><button type="button" onClick={() => p.goTab("notes")} className="text-[#6b6f76] hover:text-[#101112]">All {p.noteCount} notes</button></div>}
        </>
      )}

      {p.isAdmin && <div id="possible-duplicates" className="mt-3"><PossibleDuplicatesCard lead={lead} onMerged={p.onMerged} /></div>}
    </div>
  );
}
