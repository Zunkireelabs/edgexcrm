"use client";

import { ArrowRight, ChartNoAxesColumn, TrendingDown, TrendingUp } from "lucide-react";
import type { Signal } from "../lib/types";
import { BTN_LINK, CARD } from "./tokens";

const TAG: Record<Signal["tone"], string> = {
  bad: "bg-[#fee2e2] text-[#b91c1c]",
  good: "bg-[#d1fae5] text-[#047857]",
  neutral: "bg-[#dbeafe] text-[#2563eb]",
};

/**
 * "Key changes" — the briefing slot (v2-s3-ai-off.png). `source` is the seam for the later AI layer; only "rules" is
 * implemented. This is the AI-OFF card, so it is plain: white, standard border, NO gradient top bar and no spark —
 * the gradient and the spark are reserved for AI (the "ai" source will add them).
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
  void source; // "ai" is not built yet; it falls through to the rules rendering so the slot never renders empty.
  return (
    <section className={CARD} aria-label="Key changes">
      <div className="mb-1.5 flex items-center justify-between">
        <div className="flex items-center gap-2.5 text-[15px] font-semibold text-[#171717]">
          <span className="grid h-[26px] w-[26px] place-items-center rounded-[8px] bg-[#9ca3af] text-white">
            <ChartNoAxesColumn className="h-[15px] w-[15px]" />
          </span>
          Key changes {periodLabel}
        </div>
        <div className="text-[12px] text-[#6b7280]">Calculated · AI explanations are off</div>
      </div>
      {signals.length === 0 ? (
        <p className="py-8 text-[#6b7280]">Nothing stands out against the usual pattern this period.</p>
      ) : (
        <div>
          {signals.map((s, i) => (
            <div key={s.id} className={`grid grid-cols-[30px_1fr_auto] items-start gap-3 py-[13px] ${i > 0 ? "border-t border-[#e8eef6]" : ""}`}>
              <span className={`grid h-7 w-7 place-items-center rounded-[9px] ${TAG[s.tone]}`}>
                {s.tone === "good" ? <TrendingUp className="h-[15px] w-[15px]" /> : <TrendingDown className="h-[15px] w-[15px]" />}
              </span>
              <p className="text-[13.5px] text-[#1f2937]">
                <b className="font-semibold text-[#171717]">{s.title}</b> {s.detail}
              </p>
              <button type="button" onClick={() => onOpen(s)} className={BTN_LINK}>
                Open <ArrowRight className="h-[15px] w-[15px]" />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
