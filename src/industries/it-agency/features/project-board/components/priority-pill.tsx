"use client";

import { useState, useRef, useEffect } from "react";
import { Check } from "lucide-react";
import type { TaskPriority } from "@/types/database";

export const PRIORITY_CONFIG: Record<TaskPriority, { label: string; cls: string }> = {
  low:    { label: "Low",    cls: "bg-gray-100 text-gray-500 border-gray-200" },
  normal: { label: "Normal", cls: "bg-blue-50 text-blue-600 border-blue-200" },
  high:   { label: "High",   cls: "bg-amber-50 text-amber-700 border-amber-200" },
  urgent: { label: "Urgent", cls: "bg-red-50 text-red-600 border-red-200" },
};

const PRIORITIES: TaskPriority[] = ["low", "normal", "high", "urgent"];

interface PriorityPillProps {
  priority: TaskPriority;
  onChange?: (p: TaskPriority) => void;
  readOnly?: boolean;
}

export function PriorityPill({ priority, onChange, readOnly }: PriorityPillProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { label, cls } = PRIORITY_CONFIG[priority] ?? PRIORITY_CONFIG.normal;

  useEffect(() => {
    if (!open) return;
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  function handleSelect(p: TaskPriority) {
    onChange?.(p);
    setOpen(false);
  }

  const pill = (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${cls}`}
    >
      {label}
    </span>
  );

  if (readOnly || !onChange) return pill;

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded-full hover:opacity-80 transition-opacity focus:outline-none focus:ring-1 focus:ring-offset-1 focus:ring-blue-400"
        title="Change priority"
      >
        {pill}
      </button>

      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 w-36 bg-white border border-gray-200 rounded-lg shadow-lg py-1">
          {PRIORITIES.map((p) => {
            const { label: lbl, cls: c } = PRIORITY_CONFIG[p];
            return (
              <button
                key={p}
                type="button"
                onClick={() => handleSelect(p)}
                className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50"
              >
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${c}`}>
                  {lbl}
                </span>
                {p === priority && <Check className="h-3 w-3 text-blue-600 ml-auto shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
