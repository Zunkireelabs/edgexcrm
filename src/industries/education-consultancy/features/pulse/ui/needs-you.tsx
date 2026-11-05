"use client";

import Link from "next/link";
import type { Signal } from "../lib/types";
import { BTN_LINK, BTN_SM, CARD, SEC_SUB, SEC_TITLE } from "./tokens";

const BAR: Record<Signal["severity"], string> = { high: "#ef4444", medium: "#f59e0b", info: "#2272B4" };

/**
 * Rule-ranked "Needs you", phrased as ACTIONS (Key changes is the observational slot — the two never repeat each
 * other). "Reassign" goes to the EXISTING leads bulk-reassign flow; Pulse adds no write path.
 */
export function NeedsYou({
  signals,
  onOpen,
  reassignHref,
}: {
  signals: Signal[];
  onOpen: (s: Signal) => void;
  reassignHref: (s: Signal) => string;
}) {
  return (
    <section className={CARD} aria-label="Needs you">
      <div className="mb-1 flex items-center justify-between">
        <div className={`${SEC_TITLE} flex items-center gap-2`}>
          Needs you
          <span className="rounded-full bg-[#171717] px-2 py-px text-[11px] font-semibold text-white">{signals.length}</span>
        </div>
        <span className={SEC_SUB}>by rule</span>
      </div>
      {signals.length === 0 ? (
        <p className="py-8 text-[#6b7280]">Nothing needs you right now.</p>
      ) : (
        <div>
          {signals.map((s, i) => (
            <div key={s.id} className={`grid grid-cols-[4px_1fr] gap-3 py-3 ${i > 0 ? "border-t border-[#f1f1f1]" : ""}`}>
              <span className="rounded-[4px]" style={{ background: BAR[s.severity] }} aria-hidden />
              <div>
                <p className="text-[#1f2937]"><b className="font-semibold text-[#171717]">{s.needs?.title ?? s.title}</b></p>
                <div className="mt-0.5 text-[11.5px] text-[#6b7280]">{s.needs?.detail ?? s.detail}</div>
                <div className="mt-2 flex items-center gap-1.5">
                  {s.action === "reassign" && <Link href={reassignHref(s)} className={BTN_SM}>Reassign</Link>}
                  <button type="button" onClick={() => onOpen(s)} className={BTN_LINK}>Open</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
