"use client";

import { forwardRef, useImperativeHandle, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toLocalDateString } from "@/lib/date";
import { MemberPicker, type RosterMember } from "./member-picker";
import type { TaskPriority } from "@/types/database";

const PRIORITY_OPTIONS: { value: TaskPriority; label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "low", label: "Low" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

export interface TaskComposerContext {
  leadId?: string;
  dealId?: string;
}

interface TaskComposerProps {
  currentUserId: string;
  context?: TaskComposerContext;
  /** Called with the created task's JSON body after a successful POST. */
  onCreated: (task: Record<string, unknown>) => void;
  triggerLabel?: string;
  /** Round 2 slice E §3.6 — prefill for the email→task flow. Backward-compatible: all optional, unused by Home/TaskList callers. */
  initialTitle?: string;
  initialDescription?: string;
  /** Render already expanded (skip the "+ Task" trigger button). */
  defaultExpanded?: boolean;
  /** Called when the user cancels an already-expanded composer (only meaningful with defaultExpanded). */
  onCancel?: () => void;
}

export interface TaskComposerRef {
  /** Expands the composer (title input autofocuses itself, see below). */
  expand: () => void;
}

export const TaskComposer = forwardRef<TaskComposerRef, TaskComposerProps>(function TaskComposer({
  currentUserId,
  context,
  onCreated,
  triggerLabel = "New Task",
  initialTitle = "",
  initialDescription = "",
  defaultExpanded = false,
  onCancel,
}: TaskComposerProps, ref) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  useImperativeHandle(ref, () => ({
    expand: () => setExpanded(true),
  }));
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("normal");
  const [assigneeId, setAssigneeId] = useState<string>(currentUserId);
  const [members, setMembers] = useState<RosterMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  async function loadMembers() {
    setMembersLoading(true);
    try {
      const res = await fetch("/api/v1/team?minimal=1");
      if (res.ok) {
        const { data } = await res.json();
        setMembers(data as RosterMember[]);
      }
    } finally {
      setMembersLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/v1/my-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          due_date: dueDate || null,
          priority,
          assignee_id: assigneeId,
          lead_id: context?.leadId ?? null,
          deal_id: context?.dealId ?? null,
        }),
      });
      if (res.ok) {
        const { data } = await res.json();
        onCreated(data);
        // defaultExpanded callers (the email→task composer) reset to their
        // initial prefill, not empty — matches Round 2 slice E §3.6.
        setTitle(defaultExpanded ? initialTitle : "");
        setDescription(defaultExpanded ? initialDescription : "");
        setDueDate("");
        setPriority("normal");
        setAssigneeId(currentUserId);
        if (!defaultExpanded) setExpanded(false);
      }
    } finally {
      setSaving(false);
    }
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 py-1 transition-colors"
      >
        <Plus className="h-4 w-4" />
        {triggerLabel}
      </button>
    );
  }

  const todayStr = toLocalDateString(new Date());

  return (
    <form onSubmit={handleSubmit} className="mt-2 space-y-2 p-3 bg-gray-50 rounded-lg border border-gray-200">
      <input
        autoFocus
        type="text"
        placeholder="Task title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={255}
        className="w-full text-sm border border-gray-200 rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
      />
      {defaultExpanded && (
        <textarea
          placeholder="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={2000}
          rows={4}
          className="w-full text-sm border border-gray-200 rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white resize-none"
        />
      )}
      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="date"
          value={dueDate}
          min={todayStr}
          onChange={(e) => setDueDate(e.target.value)}
          className="text-xs border border-gray-200 rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
        />
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as TaskPriority)}
          className="text-xs border border-gray-200 rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
        >
          {PRIORITY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <MemberPicker
          members={members}
          value={assigneeId}
          onChange={(id) => setAssigneeId(id ?? currentUserId)}
          currentUserId={currentUserId}
          onOpen={loadMembers}
          loading={membersLoading}
        />
        <div className="ml-auto flex gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => (defaultExpanded ? onCancel?.() : setExpanded(false))}
            className="h-7 text-xs"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            size="sm"
            disabled={!title.trim() || saving}
            className="h-7 text-xs bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg"
          >
            {saving ? "Adding…" : "Add"}
          </Button>
        </div>
      </div>
    </form>
  );
});
