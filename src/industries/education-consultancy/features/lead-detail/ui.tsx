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

/** Attio-style empty state: icon, title, one line, one primary button. */
export function EmptyState({ icon, title, line, cta, onCta }: { icon: ReactNode; title: string; line: string; cta?: string; onCta?: () => void }) {
  return (
    <div className="mt-3 flex flex-col items-center rounded-[12px] px-6 py-10 text-center shadow-[inset_0_0_0_1px_#eeeff1]">
      <span aria-hidden className="mb-3 inline-flex size-10 items-center justify-center rounded-full bg-[#f6f7f9] text-[#6b6f76] [&_svg]:size-5">{icon}</span>
      <h3 className="m-0 text-[14px] font-medium leading-5 text-[#101112]">{title}</h3>
      <p className="m-0 mt-1 max-w-[320px] text-[13px] font-normal leading-[18px] text-black/50">{line}</p>
      {cta && onCta && (
        <button type="button" onClick={onCta} className="mt-4 inline-flex h-7 items-center rounded-[8px] bg-[#101112] px-3 text-[14px] font-medium leading-5 text-white outline-none hover:bg-[#2b2d2f] focus-visible:ring-2 focus-visible:ring-[#266df0]/50">{cta}</button>
      )}
    </div>
  );
}

/** Section / box language for the tabs that reuse today's card bodies: a 14/20/500 .63 header over a radius-12 box. */
export function TabSection({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-3">
      <div className="flex h-9 items-center px-1">
        <h3 className="m-0 text-[14px] font-medium leading-5 text-black/[.63]">{title}</h3>
        <span className="ml-auto">{right}</span>
      </div>
      <div className="rounded-[12px] p-3 shadow-[inset_0_0_0_1px_#eeeff1]">{children}</div>
    </section>
  );
}

/** Wrap today's card bodies (Consent, Applications, Classes, Check-ins, Documents) so they read in the box language: radius 12, 1px #eeeff1 ring. Logic untouched. */
export const CARD_FRAME = "[&_[data-slot=card]]:!rounded-[12px] [&_[data-slot=card]]:!border-0 [&_[data-slot=card]]:!shadow-[inset_0_0_0_1px_#eeeff1]";
