"use client";

import { useState, useRef, useEffect } from "react";
import { Check, UserCircle2, X } from "lucide-react";
import type { TeamMember } from "../hooks/use-projects";

function initials(email: string): string {
  const parts = email.split("@")[0].split(/[._-]/);
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

interface AssigneePickerProps {
  assigneeId: string | null;
  team: TeamMember[];
  onChange: (userId: string | null) => void;
  disabled?: boolean;
}

export function AssigneePicker({ assigneeId, team, onChange, disabled }: AssigneePickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const assignee = assigneeId ? team.find((m) => m.user_id === assigneeId) : null;

  useEffect(() => {
    if (!open) return;
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  function handleSelect(userId: string | null) {
    onChange(userId);
    setOpen(false);
  }

  if (disabled) {
    return assignee ? (
      <span
        title={assignee.email}
        className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-violet-100 text-violet-700 text-xs font-semibold"
      >
        {initials(assignee.email)}
      </span>
    ) : (
      <UserCircle2 className="h-5 w-5 text-muted-foreground/40" />
    );
  }

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-semibold transition-colors hover:ring-2 hover:ring-violet-300"
        title={assignee?.email ?? "Set assignee"}
        style={assignee ? { backgroundColor: "#ede9fe", color: "#6d28d9" } : undefined}
      >
        {assignee ? (
          initials(assignee.email)
        ) : (
          <UserCircle2 className="h-4 w-4 text-muted-foreground/50" />
        )}
      </button>

      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 w-52 bg-white border border-gray-200 rounded-lg shadow-lg py-1">
          <div className="max-h-48 overflow-y-auto">
            {team.map((m) => (
              <button
                key={m.user_id}
                type="button"
                onClick={() => handleSelect(m.user_id)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-gray-50 text-left"
              >
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-violet-100 text-violet-700 text-[10px] font-semibold shrink-0">
                  {initials(m.email)}
                </span>
                <span className="truncate text-gray-700">{m.email}</span>
                {m.user_id === assigneeId && <Check className="h-3 w-3 text-violet-600 ml-auto shrink-0" />}
              </button>
            ))}
          </div>
          {assigneeId && (
            <div className="border-t border-gray-100 mt-1 pt-1">
              <button
                type="button"
                onClick={() => handleSelect(null)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-gray-50 text-gray-500"
              >
                <X className="h-3 w-3" />
                Clear assignee
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
