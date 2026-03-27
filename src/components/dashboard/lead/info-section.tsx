"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface InfoSectionProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
}

export function InfoSection({ title, children, defaultOpen = true, className }: InfoSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className={cn("border border-border rounded-lg bg-card shadow-none", className)}>
      <button
        type="button"
        className="flex items-center justify-between w-full p-3 text-left"
        onClick={() => setIsOpen(!isOpen)}
      >
        <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
          {title}
        </h3>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform duration-200",
            isOpen && "rotate-180"
          )}
        />
      </button>
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
