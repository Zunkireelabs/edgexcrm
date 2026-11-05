"use client";

import { ArrowRight } from "lucide-react";
import { stageConversion } from "../lib/definitions";
import type { EventsQuery, PulseResponse } from "../lib/types";
import { deltaLabel, fmtNum } from "./format";
import { FlowSpark } from "./sparkline";
import { CARD } from "./tokens";

type Stage = PulseResponse["funnel"]["stages"][number];

function Delta({ cur, base }: { cur: number; base: number }) {
  const d = deltaLabel(cur, base);
  if (!d) return null;
  const cls = d.tone === "good" ? "bg-[#d1fae5] text-[#047857]" : d.tone === "bad" ? "bg-[#fee2e2] text-[#b91c1c]" : "bg-[#f3f4f6] text-[#6b7280]";
  return <span className={`rounded-[6px] px-1.5 py-px text-[12px] font-semibold tracking-normal ${cls}`}>{d.text}</span>;
}

function Tile({
  label, value, cur, base, series, color, prevLabel, note, onClick,
}: {
  label: string; value: number; cur: number; base: number; series: number[]; color: string; prevLabel: string; note?: string; onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="min-w-0 px-[18px] py-4 text-left hover:bg-[#fafafa] focus-visible:bg-[#fafafa]">
      <div className="text-[12px] font-medium text-[#6b7280]">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-2 text-[30px] font-semibold tracking-[-0.02em] text-[#171717]">
        {fmtNum(value)} <Delta cur={cur} base={base} />
      </div>
      <div className="text-[12px] text-[#6b7280]">{note ?? `${fmtNum(base)} ${prevLabel}`}</div>
      <FlowSpark values={series} color={color} />
    </button>
  );
}

function Connector({ pct, label, out, onOut }: { pct: string; label: string; out: number; onOut: () => void }) {
  return (
    <div className="hidden flex-col items-center justify-center gap-1.5 border-x border-dashed border-[#e5e7eb] bg-[#fbfbfb] px-1.5 text-center lg:flex">
      <div className="flex items-center gap-0.5 text-[15px] font-semibold text-[#171717]">{pct}<ArrowRight className="h-[13px] w-[13px]" /></div>
      <div className="text-[11px] leading-[1.3] text-[#6b7280]">{label}</div>
      <button type="button" onClick={onOut}
        className={`rounded-[6px] px-1.5 py-px text-[11px] ${out > 0 ? "bg-[#fef2f2] text-[#b91c1c] hover:bg-[#fee2e2]" : "bg-[#f3f4f6] text-[#6b7280]"}`}>
        {out} out
      </button>
    </div>
  );
}

const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n * 100)}%`);

export function FunnelStrip({
  data, prevLabel, onOpen,
}: {
  data: PulseResponse;
  prevLabel: string;
  onOpen: (title: string, crumbs: string[], q: EventsQuery) => void;
}) {
  const by = (slug: string): Stage | undefined => data.funnel.stages.find((s) => s.slug === slug);
  const pre = by("pre-qualified"), qual = by("qualified"), pros = by("prospects"), apps = by("applications");
  const nl = data.funnel.newLeads;
  const students = apps?.entered[0] ?? 0;
  const prospects = pros?.entered[0] ?? 0;
  const filed = data.people.reduce((a, p) => a + p.current.applications_filed, 0);
  const filedPrev = data.people.reduce((a, p) => a + p.previous.applications_filed, 0);
  const outOf = (s: Stage | undefined, crumb: string) => () =>
    s && onOpen(`Leads that left ${s.name} backwards or to Archive`, ["Funnel", crumb], { metric: "stage_out", detail: s.listId });

  return (
    <section className={`${CARD} my-[14px] grid grid-cols-1 overflow-hidden !p-0 lg:grid-cols-[1fr_92px_1fr_92px_1fr_92px_1fr]`} aria-label="Funnel">
      <Tile label="New leads in" value={nl.current} cur={nl.current} base={nl.previous} color="#2272B4" prevLabel={prevLabel}
        series={nl.daily.map((d) => d.n)}
        onClick={() => onOpen(`${nl.current} new leads`, ["New leads in"], { metric: "new_leads" })} />
      {/* Of the leads that were in Pre-qualified this period, the share that moved on; "out" = everything that left
          Pre-qualified or Qualified backwards / to Archive. Never over 100%: the base includes every lead that moved. */}
      <Connector pct={pct(pre ? stageConversion(pre.forward[0] ?? 0, pre.base) : null)} label="of Pre-qualified"
        out={(pre?.out[0] ?? 0) + (qual?.out[0] ?? 0)}
        onOut={outOf(qual ?? pre, "Qualified")} />
      <Tile label="Moved to Prospects" value={prospects} cur={prospects} base={pros?.entered[1] ?? 0} color="#475569" prevLabel={prevLabel}
        series={pros?.daily.map((d) => d.n) ?? []}
        onClick={() => onOpen(`${prospects} leads moved to Prospects`, ["Funnel", "Prospects"], { metric: "prospects" })} />
      <Connector pct={pct(pros ? stageConversion(pros.forward[0] ?? 0, pros.base) : null)} label="of Prospects"
        out={pros?.out[0] ?? 0} onOut={outOf(pros, "Prospects")} />
      <Tile label="Students reached Applications" value={students} cur={students} base={apps?.entered[1] ?? 0} color="#10b981" prevLabel={prevLabel}
        series={apps?.daily.map((d) => d.n) ?? []}
        onClick={() => onOpen(`${students} leads moved to Applications`, ["Funnel", "Applications"], { metric: "reached_applications" })} />
      <Connector pct={students > 0 ? `${(filed / students).toFixed(1)}×` : "—"} label="per student"
        out={apps?.out[0] ?? 0} onOut={outOf(apps, "Applications")} />
      <Tile label="Applications filed" value={filed} cur={filed} base={filedPrev} color="#10b981" prevLabel={prevLabel}
        series={[]}
        onClick={() => onOpen(`${filed} applications filed`, ["Funnel", "Applications filed"], { metric: "applications_filed" })} />
    </section>
  );
}
