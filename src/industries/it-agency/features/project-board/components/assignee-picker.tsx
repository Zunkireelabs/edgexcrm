"use client";

import { useState, useRef, useEffect } from "react";
import { Check, UserCircle2, X } from "lucide-react";
import { MemberAvatar } from "@/components/ui/member-avatar";
import type { TeamMember } from "../hooks/use-projects";

function memberLabel(m: TeamMember): string {
  return m.name || m.email.split("@")[0];
}

interface AssigneePickerProps {
  assigneeId: string | null;
  team: TeamMember[];
  onChange: (userId: string | null) => void;
  disabled?: boolean;
  showName?: boolean;
}

export function AssigneePicker({ assigneeId, team, onChange, disabled, showName = false }: AssigneePickerProps) {
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
      <span title={assignee.email} className="inline-flex">
        <MemberAvatar userId={assignee.user_id} name={memberLabel(assignee)} size={28} />
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
        className={showName
          ? "inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 -mx-1 transition-colors hover:bg-gray-100"
          : "inline-flex items-center justify-center w-7 h-7 rounded-full transition-colors hover:ring-2 hover:ring-violet-300"}
        title={assignee?.email ?? "Set assignee"}
      >
        {assignee ? (
          <>
            <MemberAvatar userId={assignee.user_id} name={memberLabel(assignee)} size={28} />
            {showName && <span className="truncate text-sm text-gray-700">{memberLabel(assignee)}</span>}
          </>
        ) : showName ? (
          <>
            <UserCircle2 className="h-5 w-5 text-muted-foreground/50" />
            <span className="text-sm text-gray-400">Unassigned</span>
          </>
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
                <MemberAvatar userId={m.user_id} name={memberLabel(m)} />
                <span className="truncate text-gray-700">{memberLabel(m)}</span>
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
