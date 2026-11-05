"use client";

import { ArrowRight, ChartNoAxesColumn, TrendingDown, TrendingUp } from "lucide-react";
import type { Signal } from "../lib/types";

/**
 * "Key changes" — the briefing slot. `source` is the seam for the later AI layer: only "rules" is implemented in
 * slice 1 (a plain card, no gradient, no spark — violet/gradient are reserved for AI). An "ai" source will render
 * the narrated briefing from the SAME typed signals.
 */
export function PulseBriefingCard({
  source,
  signals,
  periodLabel,
  onOpen,
}: {
  source: "rules" | "ai";
  signals: Signal[];
  periodLabel: string;
  onOpen: (s: Signal) => void;
}) {
  // source === "ai" is not built yet; fall through to the rules rendering so the slot never renders empty.
  void source;
  return (
    <section className="rounded-2xl border border-gray-200 bg-white overflow-hidden" aria-label="Key changes">
      <div className="h-[3px] bg-gradient-to-r from-sky-500 to-slate-400" aria-hidden />
      <div className="p-5">
        <div className="flex items-center justify-between gap-3 pb-3 border-b border-gray-100">
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-slate-100 text-slate-500">
              <ChartNoAxesColumn className="h-4 w-4" />
            </span>
            <h2 className="text-base font-semibold text-gray-900">Key changes {periodLabel}</h2>
          </div>
          <span className="text-xs text-gray-500">Calculated · AI explanations are off</span>
        </div>
        {signals.length === 0 ? (
          <p className="py-8 text-sm text-gray-500">Nothing stands out against the usual pattern this period.</p>
        ) : (
          <ul>
            {signals.map((s) => (
              <li key={s.id} className="flex items-start gap-3 py-3.5 border-b border-gray-100 last:border-0">
                <span
                  className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg ${
                    s.tone === "good" ? "bg-emerald-50 text-emerald-600" : s.tone === "bad" ? "bg-red-50 text-red-500" : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {s.tone === "good" ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                </span>
                <div className="min-w-0 flex-1 text-sm text-gray-800">
                  <p className="font-semibold text-gray-900">{s.title}</p>
                  <p className="mt-0.5 text-gray-600">{s.detail}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onOpen(s)}
                  className="mt-0.5 inline-flex shrink-0 items-center gap-1 text-sm text-gray-500 hover:text-gray-900"
                >
                  Open <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
