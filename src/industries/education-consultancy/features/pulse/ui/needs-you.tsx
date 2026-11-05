"use client";

import Link from "next/link";
import type { Signal } from "../lib/types";

const BAR: Record<Signal["severity"], string> = { high: "bg-red-500", medium: "bg-amber-500", info: "bg-sky-500" };

/** Rule-ranked "Needs you". "Reassign" goes to the EXISTING leads bulk-reassign flow — Pulse adds no write path. */
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
    <section className="rounded-2xl border border-gray-200 bg-white p-5" aria-label="Needs you">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
          Needs you
          <span className="rounded-full bg-gray-900 px-2 py-0.5 text-[11px] font-semibold text-white">{signals.length}</span>
        </h2>
        <span className="text-xs text-gray-500">by rule</span>
      </div>
      {signals.length === 0 ? (
        <p className="py-8 text-sm text-gray-500">Nothing needs you right now.</p>
      ) : (
        <ul className="mt-3 space-y-4">
          {signals.map((s) => (
            <li key={s.id} className="flex gap-3">
              <span className={`w-[3px] shrink-0 rounded-full ${BAR[s.severity]}`} aria-hidden />
              <div className="min-w-0">
                <p className="text-sm text-gray-800">
                  <span className="font-semibold text-gray-900">{s.title}</span>
                </p>
                <p className="mt-0.5 text-xs text-gray-500">{s.detail}</p>
                <div className="mt-2 flex items-center gap-2">
                  {s.action === "reassign" && (
                    <Link
                      href={reassignHref(s)}
                      className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-900 hover:bg-gray-50"
                    >
                      Reassign
                    </Link>
                  )}
                  <button type="button" onClick={() => onOpen(s)} className="px-1.5 py-1.5 text-sm text-gray-500 hover:text-gray-900">
                    Open
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
