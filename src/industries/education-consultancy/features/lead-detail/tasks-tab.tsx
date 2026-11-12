"use client";

import { useMemo, useState, type RefObject } from "react";
import { CalendarIcon, CheckIcon, ClipboardTextIcon, PlusIcon } from "@/components/icons";
import { MemberPicker, type RosterMember } from "@/components/dashboard/tasks/member-picker";
import { toLocalDateString } from "@/lib/date";
import { cn } from "@/lib/utils";
import { dueLabel } from "../record-preview/lib/labels";
import { shortDate } from "../record-preview/lib/readiness";
import { TASK_GROUP_LABEL, groupTasks, taskCounts, type UnifiedTask } from "./lib/tasks-merge";
import { EmptyState } from "./ui";

/** Tasks tab (EDGEX-153): composer on top, Open/Done chips, ONE list (tasks + old checklist items) in date groups. */
export function TasksTab({
  items, leadId, currentUserId, composerRef, onToggle, onOpen, onCreated,
}: {
  items: UnifiedTask[] | null;
  leadId: string;
  currentUserId: string;
  composerRef: RefObject<HTMLInputElement | null>;
  onToggle: (t: UnifiedTask, done: boolean) => void;
  onOpen: (t: UnifiedTask) => void;
  /** Called after a task was created, so the parent refetches the (enriched) list. */
  onCreated: () => void;
}) {
  const [view, setView] = useState<"open" | "done">("open");
  const counts = useMemo(() => taskCounts(items ?? []), [items]);
  // Mockup state 3: with "Open" active the list shows the open groups AND the Done group under them. "Done" narrows it to the Done group.
  const groups = useMemo(() => groupTasks((items ?? []).filter((t) => (view === "done" ? t.done : true))), [items, view]);

  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [assignee, setAssignee] = useState(currentUserId);
  const [members, setMembers] = useState<RosterMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  const loadMembers = async () => {
    if (members.length > 0) return;
    setMembersLoading(true);
    try {
      const res = await fetch("/api/v1/team?minimal=1");
      if (res.ok) setMembers(((await res.json()).data ?? []) as RosterMember[]);
    } finally { setMembersLoading(false); }
  };

  const submit = async () => {
    if (!title.trim() || saving) return;
    setSaving(true);
    setError(false);
    try {
      const res = await fetch("/api/v1/my-tasks", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), description: null, due_date: due || null, priority: "normal", assignee_id: assignee, lead_id: leadId, deal_id: null }),
      });
      if (!res.ok) throw new Error();
      setTitle(""); setDue(""); setAssignee(currentUserId);
      onCreated();
    } catch { setError(true); } finally { setSaving(false); }
  };

  return (
    <div className="px-4 pb-4 pt-1">
      <div className="mt-3 flex items-center gap-2">
        <h3 className="m-0 text-[14px] font-medium leading-5">Tasks</h3>
        <span className="flex-1" />
        {(["open", "done"] as const).map((v) => (
          <button
            key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}
            className={cn("inline-flex h-[26px] items-center gap-1.5 rounded-[8px] px-2 text-[13px] font-medium shadow-[inset_0_0_0_1px_#e8e9eb] outline-none focus-visible:ring-2 focus-visible:ring-[#266df0]/50", view === v ? "bg-[#f6f7f9] text-[#101112]" : "bg-white text-black/[.63] hover:text-[#101112]")}
          >
            {v === "open" ? "Open" : "Done"}<span className="text-black/50">{v === "open" ? counts.open : counts.done}</span>
          </button>
        ))}
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); void submit(); }}
        className="mt-3 flex h-9 items-center gap-2 rounded-[10px] pl-2.5 pr-1.5 shadow-[inset_0_0_0_1px_#e8e9eb] focus-within:shadow-[inset_0_0_0_1px_#266df0]"
      >
        <PlusIcon aria-hidden className="size-[14px] flex-none text-black/50" />
        <input
          ref={composerRef} value={title} onChange={(e) => setTitle(e.target.value)} onFocus={() => void loadMembers()}
          placeholder="Add a task…" aria-label="Add a task" disabled={saving}
          className="min-w-0 flex-1 bg-transparent text-[14px] font-medium leading-5 outline-none placeholder:text-black/50"
        />
        <label className="relative inline-flex h-6 flex-none cursor-pointer items-center gap-1 rounded-[8px] px-2 text-[12px] font-medium text-black/[.63] shadow-[inset_0_0_0_1px_#e8e9eb] hover:bg-[#f6f7f9]">
          <CalendarIcon aria-hidden className="size-3" />
          {due ? due : "Due"}
          <input type="date" value={due} min={toLocalDateString(new Date())} onChange={(e) => setDue(e.target.value)} aria-label="Due date" className="absolute inset-0 cursor-pointer opacity-0" />
        </label>
        <MemberPicker members={members} value={assignee} onChange={(id) => setAssignee(id ?? currentUserId)} currentUserId={currentUserId} onOpen={() => void loadMembers()} loading={membersLoading} />
      </form>
      {error && <p role="alert" className="m-0 mt-1.5 px-1 text-[12px] font-medium text-[#c4321f]">Couldn’t add the task. Try again.</p>}

      {items === null ? (
        <p className="mt-4 px-1 text-[13px] text-black/50">Loading tasks…</p>
      ) : groups.length === 0 ? (
        <EmptyState
          icon={<ClipboardTextIcon />}
          title={view === "done" ? "Nothing done yet" : "No open tasks"}
          line={view === "done" ? "Tasks you tick off show up here." : "Add the next step for this lead above."}
          cta={view === "open" ? "Add a task" : undefined}
          onCta={view === "open" ? () => composerRef.current?.focus() : undefined}
        />
      ) : (
        groups.map((g) => (
          <div key={g.id}>
            <div className="mx-1 mb-1.5 mt-4 text-[12px] font-medium leading-4 text-black/50">{TASK_GROUP_LABEL[g.id]}</div>
            <div className="rounded-[12px] p-1 shadow-[inset_0_0_0_1px_#eeeff1]">
              {g.items.map((t) => {
                const d = dueLabel(t.due_date, new Date(), "md");
                const meta = t.done
                  ? (t.done_at ? shortDate(t.done_at, "md") : null)
                  : [d ? (d.overdue ? shortDate(t.due_date as string, "md") : d.text) : null, t.assignee_name].filter(Boolean).join(" · ") || null;
                return (
                  <div key={t.key} className="flex h-8 items-center gap-2 whitespace-nowrap rounded-[8px] px-2 text-[14px] font-medium leading-5 hover:bg-[#f6f7f9]">
                    <button
                      type="button" role="checkbox" aria-checked={t.done} aria-label={`${t.done ? "Reopen" : "Complete"} ${t.title}`}
                      onClick={() => onToggle(t, !t.done)}
                      className={cn("inline-flex size-4 flex-none items-center justify-center rounded-[4px] outline-none focus-visible:ring-2 focus-visible:ring-[#266df0]/50", t.done ? "bg-[#101112] text-white" : "shadow-[inset_0_0_0_1.5px_#d0d3d7] hover:shadow-[inset_0_0_0_1.5px_#12805c]")}
                    >
                      {t.done && <CheckIcon className="size-3" />}
                    </button>
                    <button type="button" onClick={() => onOpen(t)} className={cn("min-w-0 flex-1 overflow-hidden text-ellipsis text-left outline-none", t.done && "line-through opacity-50")}>{t.title}</button>
                    {meta && <span className={cn("flex-none text-[12px]", !t.done && d?.overdue ? "text-[#b25e09]" : "text-black/50")}>{meta}</span>}
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}

      <p className="m-0 mt-2.5 px-1 text-[12px] font-normal leading-4 text-black/50">One list: old checklist items show here as tasks without a due date.</p>
    </div>
  );
}
