"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface InfoSectionProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
  /** Optional control rendered next to the toggle, e.g. an "Edit" button — a sibling of the toggle button, never nested inside it. */
  headerAction?: React.ReactNode;
  /** Override for the title's default small-caps sidebar styling. */
  titleClassName?: string;
  /** Keeps the section open regardless of the toggle (e.g. while editing) so a form is never hidden. */
  forceOpen?: boolean;
  /** Set false for a section that is always shown: no toggle button and no chevron, just the title. */
  collapsible?: boolean;
}

export function InfoSection({ title, children, defaultOpen = true, className, headerAction, titleClassName, forceOpen = false, collapsible = true }: InfoSectionProps) {
  const [isOpenState, setIsOpen] = useState(defaultOpen);
  const isOpen = !collapsible || forceOpen || isOpenState;
  const titleClasses = cn("text-[11px] font-medium text-muted-foreground uppercase tracking-wide", titleClassName);

  return (
    <div className={cn("border border-border rounded-lg bg-card shadow-none", className)}>
      <div className="flex items-center justify-between w-full p-3 gap-2">
        {collapsible ? (
          <button
            type="button"
            className="flex items-center justify-between flex-1 text-left min-w-0"
            onClick={() => setIsOpen(!isOpenState)}
          >
            <h3 className={titleClasses}>{title}</h3>
            <ChevronDown
              className={cn(
                "h-4 w-4 text-muted-foreground transition-transform duration-200 ml-2 shrink-0",
                isOpen && "rotate-180"
              )}
            />
          </button>
        ) : (
          <h3 className={cn(titleClasses, "flex-1 min-w-0")}>{title}</h3>
        )}
        {headerAction}
      </div>
      {isOpen && (
        <div className="px-3 pb-3 pt-0">
          {children}
        </div>
      )}
    </div>
  );
}

interface InfoRowProps {
  label: string;
  value: string | null | undefined;
  className?: string;
}

export function InfoRow({ label, value, className }: InfoRowProps) {
  if (!value) return null;

  return (
    <div className={cn("py-1.5", className)}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}
