"use client";

import { useState, useRef, useEffect } from "react";
import { Check, UserCircle2 } from "lucide-react";

export interface RosterMember {
  user_id: string;
  name: string;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

interface MemberPickerProps {
  members: RosterMember[];
  value: string | null;
  onChange: (userId: string | null) => void;
  currentUserId?: string;
  /** Fired the first time the dropdown opens — use to lazy-fetch the roster. */
  onOpen?: () => void;
  disabled?: boolean;
  loading?: boolean;
}

export function MemberPicker({
  members,
  value,
  onChange,
  currentUserId,
  onOpen,
  disabled,
  loading,
}: MemberPickerProps) {
  const [open, setOpen] = useState(false);
  const openedRef = useRef(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = value ? members.find((m) => m.user_id === value) : null;
  const label = value === currentUserId ? "You" : selected?.name ?? "Unassigned";

  useEffect(() => {
    if (!open) return;
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  function handleToggle() {
    if (disabled) return;
    if (!open && !openedRef.current) {
      openedRef.current = true;
      onOpen?.();
    }
    setOpen((o) => !o);
  }

  function handleSelect(userId: string) {
    onChange(userId);
    setOpen(false);
  }

  const sorted = currentUserId
    ? [...members].sort((a, b) =>
        a.user_id === currentUserId ? -1 : b.user_id === currentUserId ? 1 : 0
      )
    : members;

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={handleToggle}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
      >
        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-violet-100 text-violet-700 text-[10px] font-semibold shrink-0">
          {selected ? initials(selected.name) : <UserCircle2 className="h-3.5 w-3.5" />}
        </span>
        <span className="truncate max-w-[8rem]">{label}</span>
      </button>

      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg py-1">
          <div className="max-h-56 overflow-y-auto">
            {loading ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">Loading members…</div>
            ) : sorted.length === 0 ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">No members found</div>
            ) : (
              sorted.map((m) => (
                <button
                  key={m.user_id}
                  type="button"
                  onClick={() => handleSelect(m.user_id)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-gray-50 text-left"
                >
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-violet-100 text-violet-700 text-[10px] font-semibold shrink-0">
                    {initials(m.name)}
                  </span>
                  <span className="truncate text-gray-700">
                    {m.user_id === currentUserId ? "You" : m.name}
                  </span>
                  {m.user_id === value && <Check className="h-3 w-3 text-violet-600 ml-auto shrink-0" />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
