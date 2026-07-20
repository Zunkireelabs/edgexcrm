"use client";

import { useState, useRef, useEffect } from "react";
import { Check, UserCircle2, X } from "lucide-react";
import { MemberAvatar } from "@/components/ui/member-avatar";
import type { TeamMember } from "../hooks/use-projects";

function memberLabel(m: TeamMember): string {
  return m.name || m.email.split("@")[0];
}

interface OwnerPickerProps {
  ownerId: string | null;
  team: TeamMember[];
  onChange: (userId: string | null) => void;
  disabled?: boolean;
}

export function OwnerPicker({ ownerId, team, onChange, disabled }: OwnerPickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const owner = ownerId ? team.find((m) => m.user_id === ownerId) : null;

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
    return owner ? (
      <span title={owner.email} className="inline-flex">
        <MemberAvatar userId={owner.user_id} name={memberLabel(owner)} size={28} />
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
        className="inline-flex items-center justify-center w-7 h-7 rounded-full transition-colors hover:ring-2 hover:ring-blue-300"
        title={owner?.email ?? "Set owner"}
      >
        {owner ? (
          <MemberAvatar userId={owner.user_id} name={memberLabel(owner)} size={28} />
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
                {m.user_id === ownerId && <Check className="h-3 w-3 text-blue-600 ml-auto shrink-0" />}
              </button>
            ))}
          </div>
          {ownerId && (
            <>
              <div className="border-t border-gray-100 mt-1 pt-1">
                <button
                  type="button"
                  onClick={() => handleSelect(null)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-gray-50 text-gray-500"
                >
                  <X className="h-3 w-3" />
                  Clear owner
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
