"use client";

import { useState } from "react";
import Link from "next/link";
import { FileXIcon, GraduationCapIcon, PencilSimpleIcon, TrendUpIcon, UserPlusIcon, UserSwitchIcon, type Icon } from "@/components/icons";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { DEFAULT_WINDOW_DAYS, type HeadlineStyle, type ProcessKey } from "../lib/keys";
import { fmtValue, STATUS_TONE } from "../lib/format";
import { fmtN } from "../lib/metrics";
import type { LogEvent } from "../lib/improvements-log";
import { needsYou, onTrack, reviewedText } from "../lib/view";
import type { ProcessView, StepView } from "../server/load-processes";
import { LogIcon, PAGE, VChip } from "./parts";
import { StepBar } from "./step-bar";
import { useProcessesFetch } from "./use-processes";

interface ListResponse {
  windowDays: number;
  baselinesCreated: string[];
  processes: ProcessView[];
  improvements: LogEvent[];
}

export const when = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const dayWord = (iso: string) => (new Date(iso).toDateString() === new Date().toDateString() ? "Today" : when(iso));

const ICONS: Record<ProcessKey, Icon> = {
  new_lead_first_call: UserPlusIcon,
  visa_to_enrolled: GraduationCapIcon,
  dropping_a_student: FileXIcon,
  leaver_handover: UserSwitchIcon,
};

const TILE_BG = { met: "bg-ds-good-soft", amber: "bg-ds-warn-soft", red: "bg-ds-bad-soft", unknown: "bg-ds-sunken" } as const;

/** The list row's headline, in the style the process uses: "17%", "0 of 47", or "7 · target 0". Labels come from the registry as written. */
function HeadlineBlock({ h, style, label }: { h: StepView; style: HeadlineStyle; label: string }) {
  const tone = STATUS_TONE[h.status];
  const isPercent = h.target.unit === "percent";
  const big = style === "fraction" && h.fraction ? `${fmtN(h.fraction.n)} of ${fmtN(h.fraction.d)}` : fmtValue(h.value, h.target.unit);
  const withTarget = style !== "fraction";
  return (
    <div className="min-w-0">
      <div className={`text-[15px] font-semibold tabular-nums ${tone.text}`}>{big}</div>
      <div className="mt-px text-[12px] text-ds-muted md:whitespace-nowrap">
        {label}
        {withTarget ? ` · target ${fmtValue(h.target.value, h.target.unit)}` : ""}
      </div>
      {isPercent ? <StepBar step={h} className="mt-[5px]" /> : null}
    </div>
  );
}

function ProcessRowCard({ p }: { p: ProcessView }) {
  const h = p.headline;
  const baselineDraft = p.shown?.status === "draft";
  const Icon = ICONS[p.key];
  const drives = p.drivesSummary;
  return (
    <div className="relative grid items-center gap-x-3.5 gap-y-3 rounded-[12px] border border-ds-border bg-ds-surface px-4 py-3.5 hover:bg-ds-hover md:grid-cols-[36px_minmax(0,1fr)_250px_128px]">
      <div className="flex min-w-0 items-start gap-3 md:contents">
        <span className={`grid size-9 shrink-0 place-items-center rounded-[10px] border border-ds-border ${TILE_BG[h?.status ?? "unknown"]} ${STATUS_TONE[h?.status ?? "unknown"].text}`}>
          <Icon size={18} aria-hidden />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {/* The name is the row's link: its ::after stretches over the whole card. The draft button below sits above it. */}
            <Link href={`/processes/${p.key}`} className="text-[14.5px] font-semibold text-ds-ink after:absolute after:inset-0 after:content-[''] focus-visible:outline-2 focus-visible:outline-ds-accent">
              {p.name}
            </Link>
            {p.shown ? (
              <VChip tone={baselineDraft ? "warn" : "live"}>
                v{p.shown.version} {baselineDraft ? "draft" : "live"}
              </VChip>
            ) : null}
            {p.draft ? (
              <VChip tone="person" icon={PencilSimpleIcon}>
                Draft v{p.draft.version} · {p.draft.changeCount} {p.draft.changeCount === 1 ? "change" : "changes"}
              </VChip>
            ) : null}
          </div>
          <div className="mt-0.5 text-[12.5px] text-ds-muted">
            Owner {p.ownerName ?? "not set"} · {reviewedText(p.shown?.status === "live" ? (p.shown.approvedAt ?? null) : null)}
            {drives ? ` · drives ${drives}` : ""}
          </div>
        </div>
      </div>
      {h ? <HeadlineBlock h={h} style={p.headlineStyle} label={p.headlineLabel} /> : <div className="text-[12.5px] text-ds-muted">{p.specError ? "This version could not be read." : "No numbers yet."}</div>}
      <span className="md:text-right">
        {p.draft ? (
          <Link
            href={`/processes/${p.key}/draft`}
            className={`relative z-10 inline-flex h-8 items-center justify-center rounded-ds-sm px-3 text-[12.5px] font-medium ${p.canApprove ? "bg-ds-ink text-white hover:bg-ds-ink/90" : "border border-ds-border bg-ds-surface text-ds-ink hover:bg-ds-hover"}`}
          >
            Review draft
          </Link>
        ) : (
          // The row is the link; this is its visible affordance, so it is a span, not a nested button.
          <span
            className={`inline-flex h-8 items-center justify-center rounded-ds-sm px-3 text-[12.5px] font-medium ${
              baselineDraft && p.canApprove ? "bg-ds-ink text-white" : "border border-ds-border bg-ds-surface text-ds-ink"
            }`}
          >
            {baselineDraft && p.canApprove ? "Review baseline" : "Open"}
          </span>
        )}
      </span>
    </div>
  );
}

type Filter = "all" | "needs" | "track";

export function ProcessesPage({ tenantName = "" }: { tenantName?: string }) {
  const [filter, setFilter] = useState<Filter>("all");
  const { data, loading, error, reload } = useProcessesFetch<ListResponse>(`/api/v1/processes?days=${DEFAULT_WINDOW_DAYS}`);
  const team = tenantName || "your team";

  const all = data?.processes ?? [];
  const counts = { all: all.length, needs: all.filter(needsYou).length, track: all.filter(onTrack).length };
  const shown = filter === "needs" ? all.filter(needsYou) : filter === "track" ? all.filter(onTrack) : all;

  return (
    <div className={PAGE}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ds-ink">Processes</h1>
          <p className="mt-1 text-[13.5px] text-ds-muted">
            How {team} works, written down, measured from your data, and improved with you. <strong className="font-semibold text-ds-ink">Only owners and admins see this page.</strong>
          </p>
        </div>
      </div>

      {error ? (
        <div className="mt-6 rounded-ds-lg border border-ds-border bg-ds-surface p-4 text-[13px] text-ds-bad">
          Couldn&apos;t load the processes. <button className="underline" onClick={reload}>Try again</button>
        </div>
      ) : loading && !data ? (
        <div className="mt-6 text-[13px] text-ds-muted">Loading…</div>
      ) : data ? (
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-7">
          <div>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-[16px] font-semibold text-ds-ink">
                Your processes <span className="rounded-ds-full bg-ds-sunken px-2 py-0.5 text-[12px] font-medium text-ds-muted">{counts.all}</span>
              </h2>
              <SegmentedControl
                aria-label="Filter processes"
                variant="pills"
                value={filter}
                onValueChange={(v) => setFilter(v as Filter)}
                items={[
                  { value: "all", label: "All", count: counts.all },
                  { value: "needs", label: "Needs you", count: counts.needs },
                  { value: "track", label: "On track", count: counts.track },
                ]}
              />
            </div>
            <div className="space-y-3">
              {shown.map((p) => (
                <ProcessRowCard key={p.key} p={p} />
              ))}
              {shown.length === 0 ? <p className="rounded-ds-lg border border-ds-border bg-ds-surface p-4 text-[13px] text-ds-muted">No process matches this filter.</p> : null}
            </div>
            <p className="mt-4 text-[12.5px] text-ds-muted">
              Every v1 is written from how {team} actually worked in the last 30 days, not from a template. Each process has one owner, and only the owner can make a new version live.
            </p>
          </div>

          <aside className="space-y-4">
            {/* Slot: "Orca follows these" card arrives in P4. Hidden in P1. */}
            <section className="rounded-ds-lg border border-ds-border bg-ds-surface p-4">
              <div className="flex items-center gap-2">
                <TrendUpIcon size={16} aria-hidden />
                <h2 className="text-[13.5px] font-semibold text-ds-ink">EdgeX improvements</h2>
                <Link href="/processes/improvements" className="ml-auto text-[12.5px] font-medium text-ds-accent hover:underline">
                  All →
                </Link>
              </div>
              {data.improvements.length === 0 ? (
                <p className="mt-3 text-[12.5px] text-ds-muted">Nothing yet. Approved versions, suggestions and new baselines show up here.</p>
              ) : (
                <ul className="mt-2 divide-y divide-ds-divider">
                  {data.improvements.map((e) => (
                    <li key={`${e.kind}-${e.at}-${e.versionId}-${e.text}`} className="grid grid-cols-[22px_minmax(0,1fr)] gap-2 py-[9px] first:pt-0 last:pb-0">
                      <LogIcon kind={e.kind} />
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium text-ds-ink">{e.text}</div>
                        <div className="mt-px line-clamp-2 text-[12px] text-ds-muted" title={e.meta}>
                          {dayWord(e.at)}
                          {e.meta ? ` · ${e.meta}` : ""}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
