"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckIcon, FileXIcon, GraduationCapIcon, PencilSimpleIcon, TrendUpIcon, UserPlusIcon, UserSwitchIcon, type Icon } from "@/components/icons";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { DEFAULT_WINDOW_DAYS, type ProcessKey } from "../lib/keys";
import { fmtValue, STATUS_TONE } from "../lib/format";
import type { ImprovementEvent } from "../lib/improvements";
import { needsYou, onTrack } from "../lib/view";
import type { ProcessView, StepView } from "../server/load-processes";
import { StepBar } from "./step-bar";
import { useProcessesFetch } from "./use-processes";

interface ListResponse {
  windowDays: number;
  baselinesCreated: string[];
  processes: ProcessView[];
  improvements: ImprovementEvent[];
}

export const when = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

const ICONS: Record<ProcessKey, Icon> = {
  new_lead_first_call: UserPlusIcon,
  visa_to_enrolled: GraduationCapIcon,
  dropping_a_student: FileXIcon,
  leaver_handover: UserSwitchIcon,
};

const TILE_BG = { met: "bg-ds-good-soft", amber: "bg-ds-warn-soft", red: "bg-ds-bad-soft", unknown: "bg-ds-sunken" } as const;

/** The big number + its "x of y" line + bar, for one step. Shared by the list rows. */
function HeadlineBlock({ h }: { h: StepView }) {
  const tone = STATUS_TONE[h.status];
  const isPercent = h.target.unit === "percent";
  return (
    <div className="min-w-0">
      <div className={`text-[22px] font-semibold leading-none ${tone.text}`}>{fmtValue(h.value, h.target.unit)}</div>
      <div className="mt-1.5 text-[12.5px] text-ds-muted">
        {isPercent && h.fraction ? `${h.fraction.n} of ${h.fraction.d} ` : ""}
        {h.metricLabel.toLowerCase()} · target {fmtValue(h.target.value, h.target.unit)}
      </div>
      {isPercent ? <StepBar step={h} /> : null}
    </div>
  );
}

function ProcessRowCard({ p }: { p: ProcessView }) {
  const h = p.headline;
  const draft = p.shown?.status === "draft";
  const Icon = ICONS[p.key];
  const drives = p.drives.slice(0, 3).join(", ");
  return (
    <Link href={`/processes/${p.key}`} className="grid items-center gap-4 rounded-ds-lg border border-ds-border bg-ds-surface p-4 hover:bg-ds-hover md:grid-cols-[minmax(0,1fr)_minmax(0,340px)_auto]">
      <div className="flex min-w-0 items-start gap-3">
        <span className={`grid size-10 shrink-0 place-items-center rounded-ds-lg ${TILE_BG[h?.status ?? "unknown"]} ${STATUS_TONE[h?.status ?? "unknown"].text}`}>
          <Icon size={20} aria-hidden />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-semibold text-ds-ink">{p.name}</span>
            {p.shown ? (
              <span className={`rounded-ds-full px-2 py-0.5 text-[11.5px] font-medium ${draft ? "bg-ds-warn-soft text-ds-warn" : "bg-ds-good-soft text-ds-good"}`}>
                v{p.shown.version} {draft ? "draft" : "live"}
              </span>
            ) : null}
          </div>
          <div className="mt-1 text-[12.5px] text-ds-muted">
            Owner {p.ownerName ?? "not set"} · {p.shown?.approvedAt ? when(p.shown.approvedAt) : "not approved yet"}
            {drives ? ` · drives ${drives}` : ""}
          </div>
        </div>
      </div>
      {h ? <HeadlineBlock h={h} /> : <div className="text-[12.5px] text-ds-muted">{p.specError ? "This version could not be read." : "No numbers yet."}</div>}
      {/* The row is the link; this is its visible affordance, so it is a span, not a nested button. */}
      <span
        className={`inline-flex h-8 items-center justify-center rounded-ds-sm px-3 text-[12.5px] font-medium ${
          draft && p.canApprove ? "bg-ds-ink text-white" : "border border-ds-border bg-ds-surface text-ds-ink"
        }`}
      >
        {draft && p.canApprove ? "Review baseline" : "Open"}
      </span>
    </Link>
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
    <div className="mx-auto max-w-[1100px] px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ds-ink">Processes</h1>
          <p className="mt-1 max-w-[640px] text-[13.5px] text-ds-muted">
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
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
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
              <h2 className="flex items-center gap-2 text-[14px] font-semibold text-ds-ink">
                <TrendUpIcon size={16} aria-hidden /> EdgeX improvements
              </h2>
              {data.improvements.length === 0 ? (
                <p className="mt-3 text-[12.5px] text-ds-muted">Nothing yet. Approved versions and new baselines show up here.</p>
              ) : (
                <ul className="mt-3 divide-y divide-ds-divider">
                  {data.improvements.map((e) => (
                    <li key={`${e.kind}-${e.at}-${e.text}`} className="flex items-start gap-2.5 py-2.5 first:pt-0 last:pb-0">
                      <span className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-ds-sm ${e.kind === "approved" ? "bg-ds-good-soft text-ds-good" : "bg-ds-sunken text-ds-muted"}`}>
                        {e.kind === "approved" ? <CheckIcon size={12} aria-hidden /> : <PencilSimpleIcon size={12} aria-hidden />}
                      </span>
                      <div className="min-w-0">
                        <div className="text-[13px] text-ds-ink">{e.text}</div>
                        <div className="mt-0.5 text-[12px] text-ds-faint">{when(e.at)}</div>
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
