"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { fmtValue } from "../lib/format";
import { dayKey, dayLabel, groupLogEvents, type LogEvent } from "../lib/improvements-log";
import { PROCESS_KEYS, PROCESS_NAMES, type ProcessKey } from "../lib/keys";
import type { Measure } from "../lib/compare";
import { changeTone } from "./versions-page";
import { Crumb, LogIcon, PAGE, SmallChip } from "./parts";
import { useProcessesFetch } from "./use-processes";

/** S4: every real improvement event, newest first, grouped by day. Filter by process; "30 days on" results as coloured chips. */

const SHORT: Record<ProcessKey, string> = { new_lead_first_call: "New lead", visa_to_enrolled: "Visa", dropping_a_student: "Dropping", leaver_handover: "Leavers" };

export function ImprovementsPage() {
  const { data, loading, error, reload } = useProcessesFetch<{ events: LogEvent[]; tz: string }>("/api/v1/processes/improvements");
  const [filter, setFilter] = useState<"all" | ProcessKey>("all");

  const groups = useMemo(() => {
    if (!data) return [];
    const grouped = groupLogEvents(data.events, data.tz).filter((e) => filter === "all" || e.processKeys.includes(filter));
    const out: Array<{ key: string; label: string; events: LogEvent[] }> = [];
    for (const e of grouped) {
      const k = dayKey(e.at, data.tz);
      const last = out[out.length - 1];
      if (last && last.key === k) last.events.push(e);
      else out.push({ key: k, label: dayLabel(e.at, data.tz), events: [e] });
    }
    return out;
  }, [data, filter]);

  return (
    <div className={PAGE}>
      <Crumb items={[{ label: "Processes", href: "/processes" }, { label: "EdgeX improvements" }]} />
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0 md:flex-1">
          <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ds-ink">EdgeX improvements</h1>
          <p className="mt-1 text-[13.5px] text-ds-muted">
            Every change to how your team works: who suggested it, who approved it, and what it did. <strong className="font-semibold text-ds-ink">Only real events, newest first.</strong>
          </p>
        </div>
        <div className="max-w-full overflow-x-auto md:shrink-0 md:overflow-visible">
          <SegmentedControl
            aria-label="Filter by process"
            value={filter}
            onValueChange={(v) => setFilter(v as typeof filter)}
            items={[{ value: "all", label: "All processes" }, ...PROCESS_KEYS.map((k) => ({ value: k, label: SHORT[k] }))]}
          />
        </div>
      </div>

      {error ? (
        <div className="mt-5 rounded-ds-lg border border-ds-border bg-ds-surface p-4 text-[13px] text-ds-bad">
          Couldn&apos;t load the improvements. <button className="underline" onClick={reload}>Try again</button>
        </div>
      ) : loading && !data ? (
        <div className="mt-5 text-[13px] text-ds-muted">Loading…</div>
      ) : groups.length === 0 ? (
        <p className="mt-5 rounded-ds-lg border border-ds-border bg-ds-surface p-4 text-[13px] text-ds-muted">Nothing yet{filter === "all" ? "" : ` for ${PROCESS_NAMES[filter]}`}. Baselines, suggestions and approved versions show up here.</p>
      ) : (
        groups.map((g) => (
          <section key={g.key} className="mt-[18px]">
            <h2 className="mb-1.5 ml-0.5 text-[12px] font-medium text-ds-muted">{g.label}</h2>
            <ul className="overflow-hidden rounded-[12px] border border-ds-border bg-ds-surface">
              {g.events.map((e) => (
                <EventRow key={`${e.kind}-${e.versionId}-${e.at}-${e.text}`} e={e} />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

function Result({ m }: { m: Measure }) {
  if (m.before === null || m.after === null) return null;
  const tone = m.change !== null ? changeTone(m, m.change) : "flat";
  return (
    <SmallChip tone={tone === "flat" ? "plain" : tone}>
      {m.label} {fmtValue(m.before, m.unit)} → {fmtValue(m.after, m.unit)}
    </SmallChip>
  );
}

function EventRow({ e }: { e: LogEvent }) {
  const results = (e.measures ?? []).filter((m) => m.before !== null && m.after !== null);
  const btn = "inline-flex h-[30px] items-center rounded-ds-sm border border-ds-border bg-ds-surface px-[11px] text-[12.5px] font-medium text-ds-ink hover:bg-ds-hover";
  return (
    <li className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 border-t border-ds-divider px-3.5 py-[11px] first:border-t-0">
      <LogIcon kind={e.kind} size={28} />
      <div className="min-w-0 text-[13.5px] text-ds-text">
        <b className="font-medium text-ds-ink">{e.text}</b>
        {e.meta ? <span className="mt-px block text-[12px] text-ds-muted">{e.meta}</span> : null}
        {results.length ? (
          <span className="mt-[5px] inline-flex flex-wrap gap-1.5">
            {results.map((m) => (
              <Result key={m.metric} m={m} />
            ))}
          </span>
        ) : null}
      </div>
      <div>
        {e.beforeAfter ? (
          <Link href={`/processes/${e.processKey}/versions?version=${e.versionId}`} className={btn}>
            Before → after
          </Link>
        ) : e.kind === "rejected" ? (
          <Link href={`/processes/${e.processKey}`} className={`${btn} border-transparent bg-transparent text-ds-muted hover:text-ds-ink`}>
            Open
          </Link>
        ) : null}
      </div>
    </li>
  );
}
