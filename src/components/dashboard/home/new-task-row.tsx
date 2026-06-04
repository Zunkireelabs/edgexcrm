"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toLocalDateString } from "@/lib/date";
import type { TaskPriority } from "@/types/database";

const PRIORITY_OPTIONS: { value: TaskPriority; label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "low", label: "Low" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

interface NewTaskRowProps {
  onAdd: (task: { title: string; due_date: string | null; priority: TaskPriority }) => Promise<void>;
}

export function NewTaskRow({ onAdd }: NewTaskRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("normal");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      await onAdd({
        title: title.trim(),
        due_date: dueDate || null,
        priority,
      });
      setTitle("");
      setDueDate("");
      setPriority("normal");
      setExpanded(false);
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
        New Task
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
      <div className="flex items-center gap-2">
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
        <div className="ml-auto flex gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(false)}
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
}
