import Link from "next/link";
import { CaretRightIcon, CheckIcon, ClockIcon, PencilSimpleIcon, TrendUpIcon, TreeStructureIcon, XIcon, type Icon } from "@/components/icons";
import type { LogKind } from "../lib/improvements-log";

/** The mockup's `.pg`: max-width 1160, 32px side padding. Every Processes page uses it. */
export const PAGE = "mx-auto max-w-[1160px] px-4 py-7 sm:px-8";

/** Breadcrumb: the tree icon, then each part; the last is the current page (ink, 500). */
export function Crumb({ items }: { items: Array<{ label: string; href?: string }> }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[12.5px] text-ds-muted">
      <TreeStructureIcon size={14} aria-hidden />
      {items.map((it, i) => (
        <span key={`${it.label}-${i}`} className="inline-flex items-center gap-1.5">
          {i > 0 ? <CaretRightIcon size={11} aria-hidden /> : null}
          {it.href ? (
            <Link href={it.href} className="hover:text-ds-ink">
              {it.label}
            </Link>
          ) : (
            <span className={i === items.length - 1 ? "font-medium text-ds-ink" : undefined} aria-current={i === items.length - 1 ? "page" : undefined}>
              {it.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}

// No purple "draft" tone: that is Orca's colour and arrives with P4 (the AI-token guard keeps it out of this file).
export type ChipTone = "plain" | "live" | "warn" | "bad" | "person";

const CHIP: Record<ChipTone, string> = {
  plain: "border-ds-border bg-ds-sunken text-ds-text",
  live: "border-[#cde9da] bg-ds-good-soft text-ds-good",
  warn: "border-[#f3e0bf] bg-ds-warn-soft text-ds-warn",
  bad: "border-[#f6d5d1] bg-ds-bad-soft text-ds-bad",
  person: "border-[#cfe1f2] bg-ds-accent-soft text-ds-accent",
};

/** The mockup's `.vchip`: 22px, radius 6, 12px/500. */
export function VChip({ tone = "plain", icon: Ico, children }: { tone?: ChipTone; icon?: Icon; children: React.ReactNode }) {
  return (
    <span className={`inline-flex h-[22px] items-center gap-[5px] whitespace-nowrap rounded-[6px] border px-2 text-[12px] font-medium ${CHIP[tone]}`}>
      {Ico ? <Ico size={14} aria-hidden /> : null}
      {children}
    </span>
  );
}

/** The mockup's `.chip` (20px, 11.5px): used for evidence chips and the "30 days on" results. */
export function SmallChip({ tone = "plain", children }: { tone?: "plain" | "good" | "bad"; children: React.ReactNode }) {
  const t = { plain: "border-ds-border bg-ds-sunken text-ds-text", good: "border-[#cde9da] bg-ds-good-soft text-ds-good", bad: "border-[#f6d5d1] bg-ds-bad-soft text-ds-bad" }[tone];
  return <span className={`inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-[6px] border px-[7px] text-[11.5px] font-medium ${t}`}>{children}</span>;
}

/** A section label: 10.5px uppercase, as the old/new boxes use. */
export const MiniLabel = ({ children }: { children: React.ReactNode }) => <span className="mb-0.5 block text-[10.5px] font-semibold uppercase tracking-[.05em] text-ds-muted">{children}</span>;

/** "Suggested by Manish" / "Manish and 1 other". */
export function suggestedBy(names: Array<string | null>): string {
  const n = [...new Set(names.filter((x): x is string => !!x))];
  if (n.length === 0) return "someone";
  if (n.length === 1) return n[0];
  return n.length === 2 ? `${n[0]} and 1 other` : `${n[0]} and ${n.length - 1} others`;
}

const LOG_ICON: Record<LogKind, { icon: Icon; cls: string }> = {
  baseline: { icon: PencilSimpleIcon, cls: "border-ds-border bg-ds-sunken text-ds-muted" },
  suggested: { icon: PencilSimpleIcon, cls: "border-[#cfe1f2] bg-ds-accent-soft text-ds-accent" },
  approved: { icon: CheckIcon, cls: "border-[#cde9da] bg-ds-good-soft text-ds-good" },
  rejected: { icon: XIcon, cls: "border-[#f6d5d1] bg-ds-bad-soft text-ds-bad" },
  thirty_days: { icon: TrendUpIcon, cls: "border-[#cde9da] bg-ds-good-soft text-ds-good" },
  office_hours: { icon: ClockIcon, cls: "border-[#cfe1f2] bg-ds-accent-soft text-ds-accent" },
};

/** The tone icon of an improvements event (the card's 22px, the page's 28px). */
export function LogIcon({ kind, size = 22 }: { kind: LogKind; size?: 22 | 28 }) {
  const { icon: Ico, cls } = LOG_ICON[kind];
  return (
    <span aria-hidden className={`grid shrink-0 place-items-center border ${cls} ${size === 28 ? "size-7 rounded-lg" : "size-[22px] rounded-[7px]"}`}>
      <Ico size={size === 28 ? 14 : 13} />
    </span>
  );
}
