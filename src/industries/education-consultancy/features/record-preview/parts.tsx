"use client";

import type { ReactNode } from "react";
import { LockIcon, CaretDownIcon } from "@/components/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Shared pieces of the record preview. Values are the approved mockup's (record-preview-v1.html) literally. */

export function initialsOf(name: string | null | undefined): string {
  return (name ?? "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";
}

export function Avatar({ initials, size = 20 }: { initials: string; size?: 18 | 20 | 28 }) {
  const font = size === 28 ? 11 : size === 18 ? 8 : 9;
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-[#eef0f3] font-semibold text-[#2b2d2f]"
      style={{ width: size, height: size, fontSize: font }}
    >
      {initials}
    </span>
  );
}

export function Dot({ color }: { color: string }) {
  return <i aria-hidden className="inline-block size-2 shrink-0 rounded-full" style={{ background: color }} />;
}

export function CountChip({ children }: { children: ReactNode }) {
  return <span className="rounded-[4px] bg-[#f6f7f9] px-[5px] text-[11px] font-medium leading-4 text-[#6b6f76]">{children}</span>;
}

export function Section({ title, count, right }: { title: string; count?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mt-3 flex h-9 items-center px-1">
      <h3 className="m-0 flex items-center gap-1.5 text-[14px] font-medium leading-5 text-black/[.63]">
        {title}
        {count !== undefined && <CountChip>{count}</CountChip>}
      </h3>
      <span className="ml-auto text-[13px] text-[#6b6f76]">{right}</span>
    </div>
  );
}

export function ViewAll({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="text-[13px] text-[#6b6f76] hover:text-[#101112]">
      View all
    </button>
  );
}

export function ListBox({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-[12px] p-1 shadow-[inset_0_0_0_1px_#eeeff1]", className)}>{children}</div>;
}

export function ListRow({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  const cls = "flex h-8 items-center gap-2 whitespace-nowrap rounded-[8px] px-2 text-[14px] font-medium leading-5 hover:bg-[#f6f7f9]";
  return onClick ? (
    <button type="button" onClick={onClick} className={cn(cls, "w-full text-left")}>{children}</button>
  ) : (
    <div className={cls}>{children}</div>
  );
}

export function SkeletonRows({ widths }: { widths: string[] }) {
  return (
    <ListBox>
      {widths.map((w, i) => (
        <div key={i} className="flex h-8 items-center px-2">
          <Skeleton className="h-2.5 rounded-[5px]" style={{ width: w }} />
        </div>
      ))}
    </ListBox>
  );
}

export type Tone = "ink" | "warn" | "good" | "empty";
const TONE: Record<Tone, string> = { ink: "text-[#101112]", warn: "text-[#b25e09]", good: "text-[#12805c]", empty: "text-black/50" };

interface CardProps {
  label: string;
  icon: ReactNode;
  value?: ReactNode;
  /** Full text for a hover title (values/subs can ellipsize). */
  valueTitle?: string;
  subTitle?: string;
  tone?: Tone;
  sub?: ReactNode;
  subTone?: "muted" | "warn" | "add";
  /** Skeleton placeholders for the value / sub while the preview payload loads. */
  loadingValue?: number;
  loadingSub?: number;
  editable?: boolean;
  /** Read-only card that explains why on hover (lock icon + title). */
  lockedTitle?: string;
  open?: boolean;
  onClick?: () => void;
  onSubClick?: () => void;
}

/** Highlight card (86px; 74px at 390px). Editable ones get the hover tint + chevron; locked ones the lock. */
export function HighlightCard(p: CardProps) {
  const interactive = p.editable && !!p.onClick;
  return (
    <div
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      title={p.lockedTitle}
      onClick={interactive ? p.onClick : undefined}
      onKeyDown={interactive ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); p.onClick?.(); } } : undefined}
      className={cn(
        "group/card relative flex h-[86px] flex-col rounded-[12px] px-3 py-2.5 shadow-[inset_0_0_0_1px_#eeeff1] max-[430px]:h-[74px]",
        interactive ? "cursor-pointer hover:bg-[#faf9f7]" : "cursor-default",
        p.open && "bg-[#faf9f7]",
      )}
    >
      <div className="flex items-center gap-2 text-[12px] font-medium leading-4 text-black/[.63]">
        {p.label}
        <span className="ml-auto flex text-[#9a9ea5] [&>svg]:size-[14px]">{p.icon}</span>
      </div>
      <div title={p.valueTitle} className={cn("mt-auto flex items-center gap-1.5 overflow-hidden whitespace-nowrap text-[14px] font-medium leading-5", TONE[p.tone ?? "ink"])}>
        {p.loadingValue ? <Skeleton className="h-2.5 rounded-[5px]" style={{ width: p.loadingValue }} /> : p.value}
      </div>
      <div
        title={p.subTitle ?? (typeof p.sub === "string" ? p.sub : undefined)}
        className={cn(
          "min-h-4 overflow-hidden text-ellipsis whitespace-nowrap text-[12px] font-medium leading-4",
          p.subTone === "warn" ? "text-[#b25e09]" : p.subTone === "add" ? "text-[#266df0]" : "text-black/50",
        )}
        onClick={p.onSubClick ? (e) => { e.stopPropagation(); p.onSubClick?.(); } : undefined}
      >
        {p.loadingSub ? <Skeleton className="h-2 rounded-[4px]" style={{ width: p.loadingSub }} /> : p.sub}
      </div>
      {interactive && (
        <CaretDownIcon className={cn("absolute bottom-3 right-2.5 size-[14px] text-[#9a9ea5]", p.open ? "block" : "hidden group-hover/card:block")} />
      )}
      {p.lockedTitle && <LockIcon className="absolute bottom-3 right-2.5 hidden size-[14px] text-[#d0d3d7] group-hover/card:block" />}
    </div>
  );
}

export function ValueText({ children }: { children: ReactNode }) {
  return <span className="overflow-hidden text-ellipsis">{children}</span>;
}
