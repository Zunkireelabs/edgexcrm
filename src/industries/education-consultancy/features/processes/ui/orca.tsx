"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { CaretDownIcon, SparkleIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import type { Evidence } from "../lib/changes";
import { bannerText, needsText, skippedLines, turnsOnInfo, whySegments, type SkippedLine } from "../lib/improver/screens";
import type { Skipped } from "../lib/improver/propose";
import { sendJson } from "./api";

/**
 * Orca on the Processes screens (EDGEX-109 P4b, mockup scenes P1-P4). EVERY AI-toned surface of the Processes pages lives in this one file
 * (the AI-token guard allowlists it), so the rest of the pages stay plain. Tokens: --ds-ai-* only; the only icon is the sparkle.
 */

/** The gradient square with the sparkle: the mockup's `.spk`. */
export function OrcaSpark({ size = 22 }: { size?: 22 | 28 }) {
  return (
    <span aria-hidden className={`grid shrink-0 place-items-center rounded-[7px] bg-[image:var(--ds-ai-grad)] text-white ${size === 28 ? "size-7" : "size-[22px]"}`}>
      <SparkleIcon size={size === 28 ? 15 : 13} />
    </span>
  );
}

/** The mockup's `.vchip.draft`: "Draft v2 from Orca", "Proposed by Orca". */
export function OrcaChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex h-[22px] items-center gap-[5px] whitespace-nowrap rounded-[6px] border border-ds-ai-line bg-ds-ai-soft px-2 text-[12px] font-medium text-ds-ai">
      <SparkleIcon size={14} aria-hidden />
      {children}
    </span>
  );
}

/** The mockup's `.d.ai` tile in the improvements log. */
export function OrcaLogIcon({ size = 22 }: { size?: 22 | 28 }) {
  return (
    <span aria-hidden className={`grid shrink-0 place-items-center border border-ds-ai-line bg-ds-ai-soft text-ds-ai ${size === 28 ? "size-7 rounded-lg" : "size-[22px] rounded-[7px]"}`}>
      <SparkleIcon size={size === 28 ? 14 : 13} />
    </span>
  );
}

/** P1, EdgeX improvements: "2 drafts waiting for you · Orca, from 30 days of data". */
export function DraftsWaitingRow({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="grid grid-cols-[22px_minmax(0,1fr)] gap-2 border-b border-ds-divider pb-[9px]" data-testid="orca-drafts-waiting">
      <OrcaLogIcon />
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-ds-ink">{title}</div>
        <div className="mt-px text-[12px] text-ds-muted">{sub}</div>
      </div>
    </div>
  );
}

/** P1, right column: the "Orca follows these" card, with the drawn text. */
export function OrcaFollowsCard() {
  return (
    <section className="rounded-ds-lg border border-ds-border bg-ds-surface p-4" data-testid="orca-follows">
      <div className="flex items-center gap-2">
        <SparkleIcon size={16} aria-hidden className="text-ds-ai" />
        <h2 className="text-[13.5px] font-semibold text-ds-ink">Orca follows these</h2>
      </div>
      <p className="mt-2 text-[12.5px] leading-[1.5] text-ds-muted">
        When Orca works on a lead it reads the live version of that lead&apos;s process, and nothing else. It never changes a process; it can only suggest a draft.
      </p>
    </section>
  );
}

/** P2: the banner above the map. Built from `change_summary`, the window and `evidence.arrived`. Rendered ONLY for an open Orca draft. */
export function OrcaBanner({
  version,
  changeCount,
  arrived,
  windowLabel,
  summary,
  skipped,
  stepTitle,
  reviewHref,
}: {
  version: number;
  changeCount: number;
  arrived: number | null;
  windowLabel?: string | null;
  summary: string | null;
  skipped: readonly Skipped[];
  stepTitle: (key: string) => string | null;
  reviewHref: string;
}) {
  const t = bannerText({ version, changeCount, arrived, windowLabel });
  const lines = skippedLines(skipped, stepTitle);
  return (
    <section className="mt-4 rounded-[12px] border border-ds-ai-line bg-[image:var(--ds-ai-wash)] p-3.5" data-testid="orca-banner">
      <div className="flex flex-wrap items-center gap-2 text-[13.5px] font-semibold text-ds-ink">
        <OrcaSpark />
        {t.title}
        {t.from ? <span className="text-[12.5px] font-normal text-ds-muted">{t.from}</span> : null}
        <span className="ml-auto">
          <Button look="v2" variant="primary" asChild>
            <Link href={reviewHref}>Review draft v{version}</Link>
          </Button>
        </span>
      </div>
      {summary ? <p className="mt-2 text-[13px] text-ds-text">{summary}</p> : null}
      <NotChanged lines={lines} />
    </section>
  );
}

function NotChangedLine({ l }: { l: SkippedLine }) {
  return (
    <li>
      Not changed: <span className="font-medium text-ds-text">{l.step}</span>: {l.reason}
    </li>
  );
}

/** Round 2: one muted line per red step Orca left alone. At most 2 shown; the rest behind a "+N more" toggle. */
export function NotChanged({ lines }: { lines: { shown: SkippedLine[]; more: SkippedLine[] } }) {
  const [open, setOpen] = useState(false);
  if (lines.shown.length === 0) return null;
  return (
    <div className="mt-2 text-[12px] text-ds-muted" data-testid="orca-not-changed">
      <ul className="space-y-0.5">
        {lines.shown.map((l) => (
          <NotChangedLine key={l.key} l={l} />
        ))}
        {open ? lines.more.map((l) => <NotChangedLine key={l.key} l={l} />) : null}
      </ul>
      {lines.more.length > 0 ? (
        <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="mt-1 inline-flex items-center gap-1 text-[12px] font-medium text-ds-muted hover:text-ds-ink">
          {open ? "Show less" : `+${lines.more.length} more`}
          <CaretDownIcon size={11} aria-hidden className={open ? "rotate-180" : undefined} />
        </button>
      ) : null}
    </div>
  );
}

/** P3: the Why row of an Orca change. Only numbers that match an evidence value are bold (linked when the evidence has an href); uncited evidence is one muted line below. */
export function OrcaWhy({ why, evidence }: { why: string; evidence: readonly Evidence[] }) {
  const { segments, rest } = whySegments(why, evidence);
  return (
    <div className="mt-2.5 flex items-baseline gap-2 text-[12.5px] text-ds-text" data-testid="orca-why">
      <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap font-medium text-ds-ai">
        <SparkleIcon size={14} aria-hidden /> Why
      </span>
      <span className="min-w-0">
        <span>
          {segments.map((s, i) =>
            s.bold ? (
              s.href ? (
                <Link key={i} href={s.href} className="font-semibold text-ds-ink underline decoration-ds-ai-line underline-offset-2 hover:decoration-ds-ai">
                  {s.text}
                </Link>
              ) : (
                <b key={i} className="font-semibold text-ds-ink">
                  {s.text}
                </b>
              )
            ) : (
              <span key={i}>{s.text}</span>
            ),
          )}
        </span>
        {rest.length > 0 ? (
          <span className="mt-1 block text-[12px] text-ds-muted" data-testid="orca-why-evidence">
            Evidence:{" "}
            {rest.map((r, i) => (
              <span key={`${r.label}-${i}`}>
                {i > 0 ? " · " : ""}
                {r.href ? (
                  <Link href={r.href} className="underline decoration-ds-ai-line underline-offset-2 hover:decoration-ds-ai">
                    {r.value} {r.label}
                  </Link>
                ) : (
                  <span>
                    {r.value} {r.label}
                  </span>
                )}
              </span>
            ))}
          </span>
        ) : null}
      </span>
    </div>
  );
}

/** P3: "needs per-lead SMS · EDGEX-104", the mockup's warn chip. */
export function NeedsChip({ needs }: { needs: string }) {
  return <span className="inline-flex h-[22px] items-center whitespace-nowrap rounded-[6px] border border-[#f3e0bf] bg-ds-warn-soft px-2 text-[12px] font-medium text-ds-warn">{needsText(needs)}</span>;
}

/** P3: "Turns on: Settings → Smart assignment → Shadow", a link the owner follows AFTER approving. Approving never flips it. */
export function TurnsOnLine({ turnsOn }: { turnsOn: string | null | undefined }) {
  const t = turnsOnInfo(turnsOn);
  if (!t) return null;
  return (
    <div className="mt-2 text-[12px] text-ds-muted" data-testid="turns-on">
      Turns on:{" "}
      <Link href={t.href} className="font-medium text-ds-accent hover:underline">
        {t.label}
      </Link>{" "}
      <span>(you switch it on yourself after approving)</span>
    </div>
  );
}

/** P4: "Orca's read on vN" with "Open draft vN+1" / Dismiss. */
export function OrcaReadCard({
  processKey,
  read,
  onDismissed,
}: {
  processKey: string;
  read: { versionId: string; version: number; summary: string; nextDraft: { id: string; version: number } | null };
  onDismissed: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const dismiss = async () => {
    setBusy(true);
    const out = await sendJson(`/api/v1/processes/${processKey}/versions/${read.versionId}/read/dismiss`, "POST");
    setBusy(false);
    if (!out.ok) {
      toast.error(out.message ?? "Couldn't dismiss that");
      return;
    }
    onDismissed();
  };
  return (
    <section className="rounded-ds-lg border border-ds-ai-line bg-[image:var(--ds-ai-wash)] p-3.5" data-testid="orca-read">
      <h2 className="flex items-center gap-2 text-[13.5px] font-semibold text-ds-ink">
        <OrcaSpark />
        Orca&apos;s read on v{read.version}
      </h2>
      <p className="mt-2 text-[13px] leading-[1.55] text-ds-text">{read.summary}</p>
      <div className="mt-2.5 flex gap-1.5">
        {read.nextDraft ? (
          <Button look="v2" variant="secondary" asChild>
            <Link href={`/processes/${processKey}/draft`}>
              <SparkleIcon size={14} aria-hidden className="text-ds-ai" /> Open draft v{read.nextDraft.version}
            </Link>
          </Button>
        ) : null}
        <Button look="v2" variant="ghost" disabled={busy} onClick={dismiss}>
          Dismiss
        </Button>
      </div>
    </section>
  );
}
