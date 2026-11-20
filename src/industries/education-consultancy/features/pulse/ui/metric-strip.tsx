"use client";

import { stageConversion } from "../lib/definitions";
import type { EventsQuery, PulseResponse } from "../lib/types";
import { compareToUsual, formatChange } from "../lib/compare";
import { SparkLine } from "./spark-line";

type Open = (title: string, crumbs: string[], q: EventsQuery) => void;

function Chg({ cur, base, covered }: { cur: number; base: number; covered: boolean }) {
  // No change figure when the previous period starts before the data does (an empty base is not a baseline).
  // And none when the previous value is below the noise floor (MIN_USUAL): "0 vs 4 = −100%" is a false alarm.
  const c = compareToUsual(cur, base, covered);
  const text = formatChange(c);
  if (!c || !text) return <span className="chg flat" />;
  return <span className={`chg ${c.pct > 0 ? "up" : c.pct < 0 ? "dn" : "flat"}`}>{text}</span>;
}

/** Four tiles in one bordered strip: label + change top-right, big number + sparkline, caption with the ≤100% conversion. */
export function MetricStrip({ data, prevLabel, onOpen }: { data: PulseResponse; prevLabel: string; onOpen: Open }) {
  const by = (slug: string) => data.funnel.stages.find((s) => s.slug === slug);
  const qual = by("qualified"), pros = by("prospects"), apps = by("applications");
  const nl = data.funnel.newLeads;
  const prospects = pros?.entered[0] ?? 0, students = apps?.entered[0] ?? 0;
  const filed = data.team.current.applications_filed, filedPrev = data.team.previous.applications_filed;
  const conv = (forward: number | undefined, base: number | undefined) => {
    const v = stageConversion(forward ?? 0, base ?? 0);
    return v === null ? null : `${Math.round(v * 100)}%`;
  };
  const toProspects = conv(qual?.forward[0], qual?.base);
  const toApps = conv(pros?.forward[0], pros?.base);

  const tiles = [
    { label: "New leads", num: nl.current, prev: nl.previous, series: nl.daily.map((d) => d.n), extra: null as string | null,
      q: { metric: "new_leads" } as EventsQuery, title: `${nl.current} new leads` },
    { label: "Moved to Prospects", num: prospects, prev: pros?.entered[1] ?? 0, series: pros?.daily.map((d) => d.n) ?? [], extra: toProspects ? `${toProspects} of Qualified` : null,
      q: { metric: "prospects" } as EventsQuery, title: `${prospects} leads moved to Prospects` },
    { label: "Students to Applications", num: students, prev: apps?.entered[1] ?? 0, series: apps?.daily.map((d) => d.n) ?? [], extra: toApps ? `${toApps} of Prospects` : null,
      q: { metric: "reached_applications" } as EventsQuery, title: `${students} leads moved to Applications` },
    { label: "Applications filed", num: filed, prev: filedPrev, series: [] as number[], extra: students > 0 ? `${(filed / students).toFixed(1)} per student` : null,
      q: { metric: "applications_filed" } as EventsQuery, title: `${filed} applications filed` },
  ];
  return (
    <div className="metrics">
      {tiles.map((t) => (
        <button type="button" key={t.label} className="m" onClick={() => onOpen(t.title, [t.label], t.q)}>
          <div className="top"><span className="lbl">{t.label}</span><Chg cur={t.num} base={t.prev} covered={data.coverage?.baselineCovered !== false} /></div>
          <div className="v"><span className="num">{t.num.toLocaleString("en-US")}</span><SparkLine values={t.series} /></div>
          <div className="def">{data.coverage?.baselineCovered === false ? "No earlier period yet" : <>{t.prev.toLocaleString("en-US")} {prevLabel}</>}{t.extra && <> · <span style={{ color: "var(--muted)" }}>{t.extra}</span></>}</div>
        </button>
      ))}
    </div>
  );
}
