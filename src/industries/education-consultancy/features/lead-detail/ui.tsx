"use client";

import { useState, type ReactNode } from "react";
import { CheckIcon, CopyIcon, XIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

/** Small shared pieces of the left column. Sizes are the approved mockup's (lead-detail-v1.html) literally. */

export function IconButton({
  label, onClick, href, disabled, bordered, children, className,
}: { label: string; onClick?: () => void; href?: string; disabled?: boolean; bordered?: boolean; children: ReactNode; className?: string }) {
  const cls = cn(
    "inline-flex size-7 shrink-0 items-center justify-center rounded-[8px] text-[#6b6f76] outline-none hover:bg-[#f6f7f9] hover:text-[#101112] focus-visible:ring-2 focus-visible:ring-[#266df0]/50 disabled:cursor-not-allowed disabled:opacity-40 aria-disabled:cursor-not-allowed aria-disabled:opacity-40 [&_svg]:size-[14px]",
    bordered && "bg-white text-[#2b2d2f] shadow-[inset_0_0_0_1px_#e8e9eb]",
    className,
  );
  if (href && !disabled) return <a href={href} aria-label={label} title={label} className={cls}>{children}</a>;
  return <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className={cls}>{children}</button>;
}

/** 24px copy button: the icon turns into a tick for 1.5s with a "Copied" tooltip. */
export function CopyIconButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      /* clipboard blocked: nothing to confirm */
    }
  };
  return (
    <button
      type="button" aria-label={label} title={done ? "Copied" : label} onClick={copy}
      className="relative ml-auto inline-flex size-6 shrink-0 items-center justify-center rounded-[6px] text-[#9a9ea5] outline-none hover:bg-[#f6f7f9] hover:text-[#101112] focus-visible:ring-2 focus-visible:ring-[#266df0]/50"
    >
      {done ? <CheckIcon className="size-[14px] text-[#12805c]" /> : <CopyIcon className="size-[14px]" />}
      {done && (
        <span role="status" className="pointer-events-none absolute -top-7 right-0 whitespace-nowrap rounded-[6px] bg-[#101112] px-2 py-1 text-[12px] font-medium leading-4 text-white">Copied</span>
      )}
    </button>
  );
}

export function BigAvatar({ initials }: { initials: string }) {
  return (
    <span aria-hidden className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-[#e8eefc] text-[12px] font-semibold text-[#1f3f8f]">{initials}</span>
  );
}

/** Tag / collaborator pill: 22px, radius 6, optional ×. */
export function Pill({ children, onRemove, removeLabel, avatar }: { children: ReactNode; onRemove?: () => void; removeLabel?: string; avatar?: ReactNode }) {
  return (
    <span className={cn("inline-flex h-[22px] items-center gap-1 rounded-[6px] bg-[#f6f7f9] text-[12px] font-medium text-[#2b2d2f]", onRemove ? "pl-1.5 pr-1" : "px-1.5")}>
      {avatar}
      <span className="max-w-[140px] truncate">{children}</span>
      {onRemove && (
        <button type="button" aria-label={removeLabel} title={removeLabel} onClick={onRemove} className="inline-flex size-4 items-center justify-center rounded-[4px] text-[#9a9ea5] hover:bg-[#eef0f3] hover:text-[#101112]">
          <XIcon className="size-3" />
        </button>
      )}
    </span>
  );
}
