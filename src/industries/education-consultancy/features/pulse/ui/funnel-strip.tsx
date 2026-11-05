"use client";

import { ArrowRight } from "lucide-react";
import type { PulseResponse } from "../lib/types";
import type { EventsQuery } from "../lib/types";
import { deltaLabel, fmtNum } from "./format";
import { Sparkline } from "./sparkline";

type Stage = PulseResponse["funnel"]["stages"][number];

function pctText(n: number, d: number): string {
  return d > 0 ? `${Math.round((n / d) * 100)}%` : "—";
}

function Delta({ cur, base }: { cur: number; base: number }) {
  const d = deltaLabel(cur, base);
  if (!d) return null;
  const cls = d.tone === "good" ? "bg-emerald-50 text-emerald-700" : d.tone === "bad" ? "bg-red-50 text-red-600" : "bg-gray-100 text-gray-600";
  return <span className={`rounded-md px-1.5 py-0.5 text-xs font-semibold ${cls}`}>{d.text}</span>;
}

function dailySeries(stage: Stage | undefined): number[] {
  return stage ? stage.daily.map((d) => d.n) : [];
}

function Tile({
  label, value, cur, base, series, color, prevLabel, onClick,
}: { label: string; value: number; cur: number; base: number; series: number[]; color: string; prevLabel: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex-1 min-w-[150px] p-5 text-left hover:bg-gray-50/60 focus-visible:bg-gray-50">
      <div className="text-sm text-gray-600">{label}</div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-4xl font-semibold tracking-tight text-gray-900">{fmtNum(value)}</span>
        <Delta cur={cur} base={base} />
      </div>
      <div className="mt-1 text-sm text-gray-500">{fmtNum(base)} {prevLabel}</div>
      <div className="mt-3 w-full max-w-[170px]"><Sparkline values={series} color={color} width={160} height={32} fluid /></div>
    </button>
  );
}

function Connector({ pct, label, out, onOut }: { pct: string; label: string; out: number; onOut: () => void }) {
  return (
    <div className="hidden md:flex w-[112px] shrink-0 flex-col items-center justify-center gap-1 border-x border-gray-100 bg-gray-50/40 px-2 text-center">
      <div className="flex items-center gap-1 text-lg font-semibold text-gray-900">{pct}<ArrowRight className="h-3.5 w-3.5 text-gray-400" /></div>
      <div className="text-xs text-gray-500">{label}</div>
      <button type="button" onClick={onOut}
        className={`mt-1 rounded-md px-2 py-0.5 text-xs font-medium ${out > 0 ? "bg-red-50 text-red-600 hover:bg-red-100" : "bg-gray-100 text-gray-500"}`}>
        {out} out
      </button>
    </div>
  );
}

export function FunnelStrip({
  data,
  prevLabel,
  onOpen,
}: {
  data: PulseResponse;
  prevLabel: string;
  onOpen: (title: string, crumbs: string[], q: EventsQuery) => void;
}) {
  const by = (slug: string) => data.funnel.stages.find((s) => s.slug === slug);
  const pre = by("pre-qualified");
  const qual = by("qualified");
  const pros = by("prospects");
  const apps = by("applications");
  const nl = data.funnel.newLeads;
  const students = apps?.entered[0] ?? 0;
  const prospects = pros?.entered[0] ?? 0;
  const filed = data.people.reduce((a, p) => a + p.current.applications_filed, 0);
  const filedPrev = data.people.reduce((a, p) => a + p.previous.applications_filed, 0);

  return (
    <section className="flex flex-col md:flex-row overflow-hidden rounded-2xl border border-gray-200 bg-white" aria-label="Funnel">
      <Tile
        prevLabel={prevLabel}
        label="New leads in" value={nl.current} cur={nl.current} base={nl.previous} color="#2563eb"
        series={nl.daily.map((d) => d.n)}
        onClick={() => onOpen(`${nl.current} new leads`, ["New leads in"], { metric: "new_leads" })}
      />
      <Connector
        pct={pctText(qual?.entered[0] ?? 0, nl.current)} label="qualified" out={pre?.out[0] ?? 0}
        onOut={() => pre && onOpen(`Leads that left ${pre.name} backwards or to Archive`, ["Funnel", pre.name], { metric: "stage_out", detail: pre.listId })}
      />
      <Tile
        prevLabel={prevLabel}
        label="Moved to Prospects" value={prospects} cur={prospects} base={pros?.entered[1] ?? 0} color="#475569"
        series={dailySeries(pros)}
        onClick={() => onOpen(`${prospects} leads moved to Prospects`, ["Funnel", "Prospects"], { metric: "prospects" })}
      />
      <Connector
        pct={pctText(students, prospects)} label="to Applications" out={pros?.out[0] ?? 0}
        onOut={() => pros && onOpen(`Leads that left ${pros.name} backwards or to Archive`, ["Funnel", pros.name], { metric: "stage_out", detail: pros.listId })}
      />
      <Tile
        prevLabel={prevLabel}
        label="Students reached Applications" value={students} cur={students} base={apps?.entered[1] ?? 0} color="#059669"
        series={dailySeries(apps)}
        onClick={() => onOpen(`${students} leads moved to Applications`, ["Funnel", "Applications"], { metric: "reached_applications" })}
      />
      <Connector
        pct={students > 0 ? `${(filed / students).toFixed(1)}×` : "—"} label="per student" out={apps?.out[0] ?? 0}
        onOut={() => apps && onOpen(`Leads that left ${apps.name} backwards or to Archive`, ["Funnel", apps.name], { metric: "stage_out", detail: apps.listId })}
      />
      <Tile
        prevLabel={prevLabel}
        label="Applications filed" value={filed} cur={filed} base={filedPrev} color="#059669"
        series={[]}
        onClick={() => onOpen(`${filed} applications filed`, ["Funnel", "Applications filed"], { metric: "applications_filed" })}
      />
    </section>
  );
}
