"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  XIcon, CaretUpIcon, CaretDownIcon, ArrowsOutIcon, CopyIcon, EnvelopeSimpleIcon, PhoneIcon,
  CheckSquareIcon, NotePencilIcon, CircleDashedIcon, ArrowRightIcon, ClockIcon, UserIcon, GraduationCapIcon,
  ShieldCheckIcon, CheckIcon, SquaresFourIcon, PulseIcon, NoteIcon, DotsThreeIcon, WhatsappLogoIcon,
} from "@/components/icons";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { formatPhoneForTel, formatPhoneForWhatsApp } from "@/lib/phone-utils";
import { followUpBadgeLabel } from "@/components/dashboard/leads/columns-registry";
import { TaskList, type TaskListRef } from "@/components/dashboard/tasks/task-list";
import { NotesTab, type NotesTabRef } from "@/components/dashboard/lead/notes-tab";
import { notifyTaskChanged } from "@/lib/tasks/task-events";
import type { Lead, LeadList, LeadNote, PipelineStage } from "@/types/database";
import { Avatar, CountChip, Dot, HighlightCard, ListBox, ListRow, Section, ValueText, ViewAll, initialsOf } from "./parts";
import { Timeline, TimelineSkeleton } from "./timeline";
import { TasksSection } from "./tasks-section";
import { StagePicker, type StageChoice } from "./stage-picker";
import { usePreviewData, useTaskChangedRefresh } from "./use-preview-data";
import { daysInStage, dueLabel, lastTouchCard, pickNextTask, relativeDays } from "./lib/labels";
import { navState, shouldHandleNavKey } from "./lib/nav";
import { readyCard, shortDate } from "./lib/readiness";
import { pickIntake, pickTestScore, studyPlanCard } from "./lib/study-plan";

type Tab = "overview" | "activity" | "tasks" | "notes";

export interface RecordPreviewProps {
  lead: Lead;
  /** Position of this lead in the loaded page and the page's place in the whole view. */
  rowIndex: number;
  rowCount: number;
  page: number;
  pageSize: number;
  total: number;
  viewName: string;
  /** Id of the next row on this page (prefetched), if any. */
  nextLeadId: string | null;
  onNavigate: (dir: "next" | "prev") => void;
  onClose: () => void;
  currentUserId: string;
  memberNames: Record<string, string>;
  memberEmails: Record<string, string>;
  branchMap: Record<string, string>;
  formMap: Record<string, string>;
  /** Pipeline lists this user may move a lead into (no staging / archived / admin-only). */
  stageLists: LeadList[];
  stages: PipelineStage[];
  canEditRows: boolean;
  /** Same people who see the bulk Assign action. */
  canAssign: boolean;
  followUpStaleDays: number;
  onStageChange: (lead: Lead, choice: StageChoice) => Promise<void>;
  onAssign: (lead: Lead) => void;
  /** Bumped by the table after a reassignment so the preview refetches. */
  refreshToken?: number;
}

const BTN = "inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-[8px] px-2 text-[14px] font-medium leading-5 text-[#101112] shadow-[inset_0_0_0_1px_#e8e9eb] hover:bg-[#f6f7f9] disabled:cursor-not-allowed disabled:opacity-40";

export function RecordPreview(props: RecordPreviewProps) {
  const { lead, currentUserId, memberNames, canEditRows, canAssign } = props;
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("overview");
  const [stageOpen, setStageOpen] = useState(false);
  const { data, full, invalidate } = usePreviewData(lead.id, props.nextLeadId, tab === "activity" ? "all" : "top");
  const taskListRef = useRef<TaskListRef>(null);
  const notesRef = useRef<NotesTabRef>(null);
  const pendingFocus = useRef<"task" | "note" | null>(null);
  const [notes, setNotes] = useState<LeadNote[]>([]);
  const [localTasks, setLocalTasks] = useState<Set<string>>(new Set());

  // New record (J/K or another row): back to Overview, clear in-place state.
  useEffect(() => {
    setTab("overview");
    setStageOpen(false);
    setLocalTasks(new Set());
  }, [lead.id]);

  useEffect(() => {
    if (props.refreshToken) invalidate(lead.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.refreshToken]);

  // Notes tab data.
  useEffect(() => {
    if (tab !== "notes") return;
    let cancelled = false;
    fetch(`/api/v1/leads/${lead.id}/notes`).then((r) => (r.ok ? r.json() : { data: [] })).then((j) => { if (!cancelled) setNotes(j.data ?? []); }).catch(() => {});
    return () => { cancelled = true; };
  }, [tab, lead.id]);

  // Task / Note quick actions: switch tab, then focus once the composer has mounted.
  useEffect(() => {
    if (tab === "tasks" && pendingFocus.current === "task") { pendingFocus.current = null; setTimeout(() => taskListRef.current?.focusComposer(), 50); }
    if (tab === "notes" && pendingFocus.current === "note") { pendingFocus.current = null; setTimeout(() => notesRef.current?.focusComposer(), 50); }
  }, [tab]);
  const goTask = () => { pendingFocus.current = "task"; setTab("tasks"); if (tab === "tasks") setTimeout(() => taskListRef.current?.focusComposer(), 0); };
  const goNote = () => { pendingFocus.current = "note"; setTab("notes"); if (tab === "notes") setTimeout(() => notesRef.current?.focusComposer(), 0); };

  const nav = navState({ rowIndex: props.rowIndex, rowCount: props.rowCount, page: props.page, pageSize: props.pageSize, total: props.total });

  // Esc closes (a dropdown/menu/dialog takes the first Esc); J/K step through the view.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (e.defaultPrevented || document.querySelector('[role="dialog"][data-state="open"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]')) return;
        props.onClose();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.key === "j" || e.key === "J") && nav.hasNext && shouldHandleNavKey(e.target)) { e.preventDefault(); props.onNavigate("next"); }
      if ((e.key === "k" || e.key === "K") && nav.hasPrev && shouldHandleNavKey(e.target)) { e.preventDefault(); props.onNavigate("prev"); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [props, nav.hasNext, nav.hasPrev]);

  const name = `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim() || "Unnamed lead";
  const nameOf = useCallback((id: string | null | undefined, fallback?: string | null) => (!id ? fallback ?? null : id === currentUserId ? "You" : memberNames[id] ?? fallback ?? null), [currentUserId, memberNames]);
  const row = lead as Lead & { intake_term?: string | null };

  // ── Highlights ────────────────────────────────────────────────────────────
  const list = props.stageLists.find((l) => l.id === lead.list_id) ?? null;
  const stage = props.stages.find((s) => s.id === lead.stage_id) ?? null;
  const stageLabel = [list?.name, stage?.name].filter(Boolean).join(" · ") || "No stage";
  const stageEditable = canEditRows;

  useTaskChangedRefresh(lead.id, invalidate);

  const pickStage = async (c: StageChoice) => {
    setStageOpen(false);
    await props.onStageChange(lead, c);
    invalidate(lead.id);
  };

  const openTasks = (data?.tasks.items ?? []).filter((t) => !localTasks.has(t.id));
  const openCount = data ? Math.max(0, data.tasks.open_count - localTasks.size) : null;
  const next = pickNextTask(openTasks);
  const nextDue = dueLabel(next?.due_date);

  const followLabel = followUpBadgeLabel(lead, props.followUpStaleDays);
  const touch = lastTouchCard({
    lastTouchedAt: lead.last_touched_at,
    createdAt: lead.created_at,
    kind: data?.last_touch?.kind ?? null,
    who: data?.last_touch ? nameOf(data.last_touch.who_id, data.last_touch.who_name) : null,
    onHold: lead.on_hold,
    followUpLabel: followLabel,
    staleDays: props.followUpStaleDays,
  });

  const assigneeName = lead.assigned_to ? nameOf(lead.assigned_to, memberNames[lead.assigned_to]) : null;
  const assigneeReal = lead.assigned_to ? memberNames[lead.assigned_to] ?? data?.assignee_name ?? null : null;
  const branchName = (lead.branch_id ? props.branchMap[lead.branch_id] : null) ?? data?.branch_name ?? null;

  const plan = studyPlanCard({
    destinations: lead.destinations ?? [],
    intake: data?.intake ?? pickIntake({ intakeTerm: row.intake_term ?? null, preferredIntake: (lead.custom_fields ?? {}).preferred_intake }),
    degreeLevel: lead.degree_level,
    fieldOfStudy: lead.field_of_study,
    test: pickTestScore({ ielts: lead.ielts_score, pte: lead.pte_score, toefl: lead.toefl_score }),
  });

  const ready = data ? readyCard({
    ready: data.readiness.ready, items: data.readiness.items, consentSignedAt: data.readiness.consent_signed_at,
    hasActiveConsentTemplate: data.readiness.has_active_consent_template, feeStatus: data.readiness.fee_status,
  }) : null;

  const completeTask = async (id: string) => {
    setLocalTasks((s) => new Set(s).add(id));
    try {
      const res = await fetch(`/api/v1/my-tasks/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "done" }) });
      if (!res.ok) throw new Error();
      notifyTaskChanged(); // our TASK_CHANGED_EVENT listener below does the invalidate
    } catch {
      setLocalTasks((s) => { const n = new Set(s); n.delete(id); return n; });
      toast.error("Couldn't complete the task");
    }
  };

  const copyPhone = () => {
    if (!lead.phone) return;
    void navigator.clipboard.writeText(lead.phone);
    toast.success("Phone copied");
  };

  const sourceName = data?.source_name ?? (lead.form_config_id ? props.formMap[lead.form_config_id] : null) ?? (lead.intake_source ? lead.intake_source.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : null);
  const footer = [sourceName, `Added ${shortDate(lead.created_at)} ${new Date(lead.created_at).getFullYear()}`, lead.city].filter(Boolean) as string[];

  const metaParts: Array<"id" | "phone" | "email"> = [];
  if (lead.display_id) metaParts.push("id");
  if (lead.phone) metaParts.push("phone");
  if (lead.email) metaParts.push("email");

  const openFull = () => router.push(`/leads/${lead.id}`);

  const TAB = "relative flex h-7 shrink-0 items-center gap-1.5 rounded-[8px] px-2 py-1 text-[14px] font-medium leading-5 shadow-[inset_0_0_0_1px_transparent] transition-[box-shadow,background-color] duration-[140ms] [&_svg]:size-4";
  const TAB_IDLE = "text-black/[.63] hover:text-[#101112] hover:shadow-[inset_0_0_0_1px_#eeeff1]";
  const TAB_ON = "bg-[#fbfbfb] text-[#101112] shadow-[inset_0_0_0_1px_#eeeff1] after:absolute after:inset-x-0 after:-bottom-[8px] max-[430px]:after:-bottom-[7px] after:h-px after:bg-[#101112]";
  const tabBtn = (t: Tab, label: string, icon: React.ReactNode, count?: React.ReactNode) => (
    <button type="button" key={t} onClick={() => setTab(t)} className={cn(TAB, tab === t ? TAB_ON : TAB_IDLE)}>
      {icon}
      {label}
      {count !== undefined && <CountChip>{count}</CountChip>}
    </button>
  );

  return (
    <aside
      aria-label="Record preview"
      className="absolute bottom-2 right-2 top-2 z-40 flex w-[497px] flex-col overflow-hidden rounded-[12px] bg-white font-medium shadow-[0_0_0_1px_rgba(28,40,64,.04),0_4px_8px_-4px_rgba(28,40,64,.12),0_4px_12px_-2px_rgba(24,41,75,.16)] max-[430px]:fixed max-[430px]:inset-0 max-[430px]:w-auto max-[430px]:rounded-none max-[430px]:shadow-none"
    >
      {/* Header (48px) */}
      <div className="flex h-12 flex-none items-center gap-1 border-b border-[#f0f1f2] pl-3 pr-2.5">
        <button type="button" aria-label="Close (Esc)" title="Close (Esc)" onClick={props.onClose} className="inline-flex size-7 items-center justify-center rounded-[8px] text-[#6b6f76] hover:bg-[#f6f7f9] hover:text-[#101112]">
          <XIcon className="size-4" />
        </button>
        <NavButton label="Previous lead" kbd="K" disabled={!nav.hasPrev} onClick={() => props.onNavigate("prev")}><CaretUpIcon className="size-[14px]" /></NavButton>
        <NavButton label="Next lead" kbd="J" disabled={!nav.hasNext} onClick={() => props.onNavigate("next")}><CaretDownIcon className="size-[14px]" /></NavButton>
        <span className="ml-2 text-[12px] font-medium leading-4 text-black/[.63]">{nav.position.toLocaleString()} of {nav.total.toLocaleString()} in {props.viewName}</span>
        <span className="flex-1" />
        <button type="button" aria-label="Open full record" title="Open full record" onClick={openFull} className="inline-flex size-7 items-center justify-center rounded-[8px] text-[#6b6f76] hover:bg-[#f6f7f9] hover:text-[#101112]">
          <ArrowsOutIcon className="size-[14px]" />
        </button>
      </div>

      {/* Identity */}
      <div className="flex-none px-4 pt-3.5">
        <div className="flex items-center gap-2.5">
          <Avatar initials={initialsOf(name)} size={28} />
          <h2 className="m-0 truncate text-[18px] font-semibold leading-6 tracking-[-.01em]">{name}</h2>
        </div>
        <div className="ml-[38px] mt-1.5 flex flex-wrap items-center gap-1.5 text-[13px] text-[#6b6f76]">
          {metaParts.map((p, i) => (
            <span key={p} className="contents">
              {i > 0 && <span className={cn("text-[#d0d3d7]", p === "email" && "max-[430px]:hidden")}>·</span>}
              {p === "id" && <span>{lead.display_id}</span>}
              {p === "phone" && (
                <>
                  <span>{lead.phone}</span>
                  <button type="button" aria-label="Copy phone" onClick={copyPhone} className="inline-flex text-[#9a9ea5] hover:text-[#101112]"><CopyIcon className="size-[14px]" /></button>
                </>
              )}
              {p === "email" && <span>{lead.email}</span>}
            </span>
          ))}
        </div>
        <div className="mt-3 flex gap-1.5 pb-3">
          {lead.email ? <a className={BTN} href={`mailto:${lead.email}`}><EnvelopeSimpleIcon className="size-[14px]" />Email</a> : <button type="button" className={BTN} disabled><EnvelopeSimpleIcon className="size-[14px]" />Email</button>}
          {lead.phone ? <a className={BTN} href={`tel:${formatPhoneForTel(lead.phone)}`}><PhoneIcon className="size-[14px]" />Call</a> : <button type="button" className={BTN} disabled><PhoneIcon className="size-[14px]" />Call</button>}
          <button type="button" className={BTN} disabled={!lead.phone} onClick={() => window.open(`https://wa.me/${formatPhoneForWhatsApp(lead.phone as string)}`, "_blank")}><WhatsappLogoIcon className="size-[14px]" />WhatsApp</button>
          <button type="button" title="Add task" aria-label="Add task" className={cn(BTN, "max-[430px]:w-7 max-[430px]:justify-center max-[430px]:px-0")} onClick={goTask}><CheckSquareIcon className="size-[14px]" /><span className="max-[430px]:hidden">Task</span></button>
          <button type="button" title="Add note" aria-label="Add note" className={cn(BTN, "max-[430px]:w-7 max-[430px]:justify-center max-[430px]:px-0")} onClick={goNote}><NotePencilIcon className="size-[14px]" /><span className="max-[430px]:hidden">Note</span></button>
        </div>
      </div>

      {/* Tabs (40px) */}
      <nav className="flex h-11 flex-none items-start gap-1 border-b border-[#e8e9eb] px-3 pt-2 max-[430px]:overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabBtn("overview", "Overview", <SquaresFourIcon />)}
        <span aria-hidden className="mx-2 mt-1.5 h-4 w-px shrink-0 bg-[#eeeff1]" />
        {tabBtn("activity", "Activity", <PulseIcon />)}
        {tabBtn("tasks", "Tasks", <CheckSquareIcon />, openCount ?? "–")}
        {tabBtn("notes", "Notes", <NoteIcon />, data ? data.notes.count : "–")}
        <DropdownMenu>
          <DropdownMenuTrigger title="More" aria-label="More" className={cn(TAB, TAB_IDLE, "w-7 justify-center px-0 outline-none data-[state=open]:bg-[#fbfbfb] data-[state=open]:text-[#101112] data-[state=open]:shadow-[inset_0_0_0_1px_#eeeff1]")}>
            <DotsThreeIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="rounded-[12px]">
            <DropdownMenuItem className="rounded-[8px]" onClick={openFull}>Applications{data ? ` (${data.applications.count})` : ""}</DropdownMenuItem>
            <DropdownMenuItem className="rounded-[8px]" onClick={openFull}>Documents</DropdownMenuItem>
            <DropdownMenuItem className="rounded-[8px]" onClick={openFull}>Check-ins</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </nav>

      {/* Body */}
      <div className="flex-1 overflow-auto px-3 pb-4 pt-1">
        {tab === "overview" && (
          <>
            <Section title="Highlights" />
            <div className="relative grid grid-cols-2 gap-2 max-[430px]:grid-cols-1">
              <StagePicker open={stageOpen} onOpenChange={setStageOpen} lists={props.stageLists} stages={props.stages} currentListId={lead.list_id} currentStageId={lead.stage_id} onPick={pickStage}>
                <div>
                  <HighlightCard
                    label="Stage" icon={<CircleDashedIcon />} editable={stageEditable} open={stageOpen} onClick={() => setStageOpen((o) => !o)}
                    valueTitle={stageLabel}
                    value={<>{stage && <Dot color={stage.color} />}<ValueText>{stageLabel}</ValueText></>}
                    sub={daysInStage(lead.stage_changed_at)}
                  />
                </div>
              </StagePicker>

              {data ? (
                next ? (
                  <HighlightCard
                    label="Next step" icon={<ArrowRightIcon />} editable onClick={() => router.push(`/tasks/${next.id}`)}
                    tone={nextDue?.overdue ? "warn" : "ink"} subTone={nextDue?.overdue ? "warn" : "muted"}
                    valueTitle={next.title}
                    value={<ValueText>{next.title}</ValueText>}
                    sub={[nextDue?.text, next.assignee_name ? (next.assignee_name === memberNames[currentUserId] ? "You" : next.assignee_name) : null].filter(Boolean).join(" · ")}
                  />
                ) : (
                  <HighlightCard label="Next step" icon={<ArrowRightIcon />} editable onClick={goTask} tone="warn" value={<ValueText>No next step</ValueText>} sub="+ Add a task" subTone="add" />
                )
              ) : (
                <HighlightCard label="Next step" icon={<ArrowRightIcon />} loadingValue={140} loadingSub={90} />
              )}

              <HighlightCard
                label="Last touch" icon={<ClockIcon />} tone={touch.amber ? "warn" : "ink"}
                valueTitle={touch.value}
                value={<ValueText>{touch.value}</ValueText>}
                {...(data ? { sub: touch.sub } : { loadingSub: 110 })}
              />

              <HighlightCard
                label="Counsellor" icon={<UserIcon />} editable={canAssign} onClick={() => props.onAssign(lead)}
                lockedTitle={canAssign ? undefined : "Only managers can reassign"}
                valueTitle={assigneeName ?? "Unassigned"}
                tone={assigneeName ? "ink" : "empty"}
                value={assigneeName ? <><Avatar initials={initialsOf(assigneeReal ?? assigneeName)} /><ValueText>{assigneeName}</ValueText></> : <ValueText>Unassigned</ValueText>}
                sub={branchName ?? ""}
              />

              <HighlightCard label="Study plan" icon={<GraduationCapIcon />} tone={plan.empty ? "empty" : "ink"} valueTitle={plan.value} value={<ValueText>{plan.value}</ValueText>} sub={plan.sub} />

              {ready ? (
                <HighlightCard
                  label="Ready to apply" icon={<ShieldCheckIcon />} tone={ready.tone === "good" ? "good" : "warn"}
                  value={ready.tone === "good" ? <><CheckIcon className="size-[14px]" /><ValueText>{ready.value}</ValueText></> : <ValueText>{ready.value}</ValueText>}
                  sub={ready.sub}
                  subTitle={ready.subTitle}
                />
              ) : (
                <HighlightCard label="Ready to apply" icon={<ShieldCheckIcon />} loadingValue={70} loadingSub={130} />
              )}
            </div>

            {data && data.applications.count > 0 && (
              <>
                <Section title="Applications" count={data.applications.count} right={<ViewAll onClick={openFull} />} />
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

            <Section title="Activity" right={<ViewAll onClick={() => setTab("activity")} />} />
            {data ? <Timeline rows={data.activity} currentUserId={currentUserId} /> : <TimelineSkeleton widths={["60%", "45%", "52%"]} />}

            {data && openCount !== null && (
              <TasksSection
                count={openCount}
                items={openTasks}
                onAdd={goTask}
                onComplete={(id) => void completeTask(id)}
                onOpen={(id) => router.push(`/tasks/${id}`)}
              />
            )}

            {data?.notes.latest && (
              <>
                <Section title="Latest note" right={<ViewAll onClick={() => setTab("notes")} />} />
                <ListBox className="px-3 py-2.5">
                  <p className="m-0 line-clamp-3 text-[14px] font-medium leading-5 text-[#2b2d2f]">{data.notes.latest.content}</p>
                  <div className="mt-1.5 text-[12px] text-black/50">{nameOf(data.notes.latest.author_id, data.notes.latest.author_name) ?? "Someone"} · {relativeDays(data.notes.latest.created_at)}</div>
                </ListBox>
              </>
            )}

            {footer.length > 0 && (
              <div className="mx-1 mt-4 flex flex-wrap gap-1.5 text-[12px] text-black/50">
                {footer.map((f, i) => (
                  <span key={i} className="contents">{i > 0 && <span className="text-[#d0d3d7]">·</span>}<span>{f}</span></span>
                ))}
              </div>
            )}
          </>
        )}

        {tab === "activity" && (
          <>
            <Section title="Activity" />
            {full ? (full.activity.length ? <Timeline rows={full.activity} currentUserId={currentUserId} /> : <p className="px-1 text-[13px] text-[#6b6f76]">No activity yet</p>) : <TimelineSkeleton widths={["60%", "45%", "52%", "40%"]} />}
          </>
        )}

        {tab === "tasks" && (
          <div className="pt-3">
            <TaskList
              ref={taskListRef}
              fetchUrl={`/api/v1/leads/${lead.id}/tasks`}
              currentUserId={currentUserId}
              context={{ leadId: lead.id }}
              emptyLabel="No tasks yet."
              onChange={() => invalidate(lead.id)}
            />
          </div>
        )}

        {tab === "notes" && (
          <div className="pt-3">
            <NotesTab
              ref={notesRef}
              leadId={lead.id}
              notes={notes}
              onNotesChange={(n) => { setNotes(n); invalidate(lead.id); }}
              teamMemberNames={memberNames}
              teamMemberEmails={props.memberEmails}
              currentUserId={currentUserId}
              canManageNotes={canEditRows}
            />
          </div>
        )}
      </div>
    </aside>
  );
}

function NavButton({ label, kbd, disabled, onClick, children }: { label: string; kbd: string; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button" aria-label={label} disabled={disabled} onClick={onClick}
      className={cn("group/nav relative inline-flex size-7 items-center justify-center rounded-[8px] text-[#6b6f76] shadow-[inset_0_0_0_1px_#e8e9eb] hover:bg-[#f6f7f9] hover:text-[#101112]", disabled && "opacity-40 hover:bg-transparent")}
    >
      {children}
      <span className="pointer-events-none absolute left-1/2 top-[34px] z-10 hidden -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-[6px] bg-[#101112] py-1 pl-2 pr-1.5 text-[12px] font-medium leading-4 text-white group-hover/nav:flex">
        {label}<kbd className="rounded-[4px] border border-[#3a3d41] px-1 font-[inherit] text-[11px] font-medium text-[#cfd2d6]">{kbd}</kbd>
      </span>
    </button>
  );
}

/** Application status chip: won/offer = green, lost = grey, everything in flight = blue. */
function StatusChip({ status, terminal }: { status: string; terminal: string | null }) {
  const won = terminal === "won" || /offer/i.test(status);
  const lost = terminal === "lost";
  const cls = won ? "bg-[#e7f6ef] text-[#12805c]" : lost ? "bg-[#f6f7f9] text-[#6b6f76]" : "bg-[#eaf1ff] text-[#266df0]";
  return <span className={cn("flex-none rounded-[6px] px-1.5 text-[12px] font-medium leading-[18px]", cls)}>{status}</span>;
}
