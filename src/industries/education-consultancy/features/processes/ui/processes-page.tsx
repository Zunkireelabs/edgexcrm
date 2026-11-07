"use client";

import { useState } from "react";
import Link from "next/link";
import { FlowArrowIcon, PencilSimpleIcon, CheckIcon, ArrowRightIcon } from "@/components/icons";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { DEFAULT_WINDOW_DAYS, WINDOW_DAYS } from "../lib/keys";
import { fmtTarget, fmtValue, STATUS_TONE } from "../lib/format";
import type { ImprovementEvent } from "../lib/improvements";
import type { ProcessView } from "../server/load-processes";
import { StepBar } from "./step-bar";
import { useProcessesFetch } from "./use-processes";

interface ListResponse {
  windowDays: number;
  baselinesCreated: string[];
  processes: ProcessView[];
  improvements: ImprovementEvent[];
}

export function WindowPicker({ days, onChange }: { days: number; onChange: (d: number) => void }) {
  return (
    <SegmentedControl
      aria-label="Time window"
      value={String(days)}
      onValueChange={(v) => onChange(Number(v))}
      items={WINDOW_DAYS.map((d) => ({ value: String(d), label: d === DEFAULT_WINDOW_DAYS ? "Last 30 days" : `${d} days` }))}
    />
  );
}

export const when = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

function ProcessCard({ p }: { p: ProcessView }) {
  const h = p.headline;
  const tone = STATUS_TONE[h?.status ?? "unknown"];
  const draft = p.shown?.status === "draft";
  return (
    <Link href={`/processes/${p.key}`} className="block rounded-ds-lg border border-ds-border bg-ds-surface p-4 hover:bg-ds-hover">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-[14px] font-semibold text-ds-ink">
          <FlowArrowIcon size={16} aria-hidden />
          {p.name}
        </div>
        <span className={`rounded-ds-full px-2 py-0.5 text-[11.5px] font-medium ${draft ? "bg-ds-warn-soft text-ds-warn" : "bg-ds-good-soft text-ds-good"}`}>
          {p.shown ? `v${p.shown.version} ${draft ? "baseline draft" : "live"}` : "No version"}
        </span>
      </div>
      <div className="mt-1 text-[12px] text-ds-muted">Owner {p.ownerName ?? "not set"}</div>
      {h ? (
        <div className="mt-3">
          <div className={`text-[26px] font-semibold leading-none ${tone.text}`}>{fmtValue(h.value, h.target.unit)}</div>
          <div className="mt-1 text-[12.5px] text-ds-muted">
            {h.metricLabel} · target {fmtTarget(h.target.op, h.target.value, h.target.unit)}
          </div>
          <StepBar step={h} />
        </div>
      ) : (
        <div className="mt-3 text-[12.5px] text-ds-muted">{p.specError ? "This version could not be read." : "No numbers yet."}</div>
      )}
      <div className="mt-3 flex items-center gap-1 text-[12.5px] font-medium text-ds-accent">
        {draft ? "Review baseline" : "Open"} <ArrowRightIcon size={12} aria-hidden />
      </div>
    </Link>
  );
}

export function ProcessesPage() {
  const [days, setDays] = useState<number>(DEFAULT_WINDOW_DAYS);
  const { data, loading, error, reload } = useProcessesFetch<ListResponse>(`/api/v1/processes?days=${days}`);

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-semibold text-ds-ink">Processes</h1>
          <p className="mt-1 max-w-[620px] text-[13px] text-ds-muted">
            How your team works, written from your own data. Each process has one owner, and only the owner can make a new version live.
          </p>
        </div>
        <WindowPicker days={days} onChange={setDays} />
      </div>

      {error ? (
        <div className="mt-6 rounded-ds-lg border border-ds-border bg-ds-surface p-4 text-[13px] text-ds-bad">
          Couldn&apos;t load the processes. <button className="underline" onClick={reload}>Try again</button>
        </div>
      ) : loading && !data ? (
        <div className="mt-6 text-[13px] text-ds-muted">Loading…</div>
      ) : data ? (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {data.processes.map((p) => (
              <ProcessCard key={p.key} p={p} />
            ))}
          </div>
          {/* Slot: "Orca suggests" chips arrive in P4. Hidden in P1. */}
          <section className="mt-6 rounded-ds-lg border border-ds-border bg-ds-surface p-4">
            <h2 className="text-[13px] font-semibold text-ds-ink">EdgeX improvements</h2>
            {data.improvements.length === 0 ? (
              <p className="mt-2 text-[12.5px] text-ds-muted">Nothing yet. Approved versions and new baselines show up here.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {data.improvements.map((e) => (
                  <li key={`${e.kind}-${e.at}-${e.text}`} className="flex items-start gap-2 text-[12.5px] text-ds-text">
                    {e.kind === "approved" ? <CheckIcon size={14} className="mt-0.5 text-ds-good" aria-hidden /> : <PencilSimpleIcon size={14} className="mt-0.5 text-ds-muted" aria-hidden />}
                    <span>{e.text}</span>
                    <span className="ml-auto shrink-0 text-ds-faint">{when(e.at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
