"use client";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import type { EventsQuery, MetricKey, PersonRow } from "../lib/types";
import { avatarColor, deltaLabel, fmtNum, fmtWhen, initials } from "./format";
import { usePulsePerson, type WindowSelection } from "./use-pulse";

const KINDS: Record<string, string> = { call: "Call", note: "Note on", move: "Moved", bulk_move: "Moved (bulk)", status: "Status" };

function Kpi({ label, value, usual, onClick }: { label: string; value: number; usual: number; onClick: () => void }) {
  const d = deltaLabel(value, usual);
  return (
    <button type="button" onClick={onClick} className="rounded-xl border border-gray-200 p-3 text-left hover:bg-gray-50">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-gray-900">{fmtNum(value)}</div>
      <div className={`text-xs font-semibold ${d?.tone === "bad" ? "text-red-600" : d?.tone === "good" ? "text-emerald-600" : "text-gray-500"}`}>
        {d ? `${d.text} vs ${fmtNum(usual)} usual` : "no usual yet"}
      </div>
    </button>
  );
}

/** Person view: 4 KPIs against their own usual, the daily chart with the dashed usual line, what they did. */
export function PersonDrawer({
  person, window: win, onClose, onOpen,
}: {
  person: PersonRow | null;
  window: WindowSelection;
  onClose: () => void;
  onOpen: (title: string, crumbs: string[], q: EventsQuery) => void;
}) {
  const { data, loading, error } = usePulsePerson(person?.userId ?? null, win);
  const tz = data?.window.tz ?? "UTC";
  const p = data?.person ?? person;
  const daily = data?.daily ?? [];
  const maxDay = Math.max(1, data?.usualPerDay ?? 0, ...daily.map((d) => d.calls + d.notes + d.moves));
  const kpi = (key: MetricKey, label: string, noun: string) =>
    p ? <Kpi label={label} value={p.current[key]} usual={p.usual[key]} onClick={() => onOpen(`${p.current[key]} ${noun} — ${p.name}`, [p.name, label], { metric: key, userId: p.userId })} /> : null;

  return (
    <Sheet open={!!person} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-[560px]">
        <SheetHeader>
          <div className="flex items-center gap-3">
            {p && <span className="grid h-12 w-12 place-items-center rounded-full text-sm font-semibold text-white" style={{ background: avatarColor(p.userId) }}>{initials(p.name)}</span>}
            <div>
              <SheetTitle className="text-xl">{p?.name ?? ""}</SheetTitle>
              <SheetDescription>{p ? [p.positionName, p.branchName].filter(Boolean).join(" · ") : ""}</SheetDescription>
            </div>
          </div>
        </SheetHeader>
        <div className="space-y-5 px-4 pb-6">
          {p && (
            <div className="grid grid-cols-2 gap-2.5">
              {kpi("calls", "Calls", "calls")}
              {kpi("notes", "Notes", "notes")}
              {kpi("prospects", "→ Prospects", "leads moved to Prospects")}
              {kpi("received", "Leads received", "new leads received")}
            </div>
          )}
          {error && <p className="text-sm text-red-600">Couldn&apos;t load this person&apos;s activity.</p>}
          {loading && !data && <Skeleton className="h-40 w-full" />}
          {data && (
            <>
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Daily activity <span className="font-normal text-gray-500">· dashed line = their usual</span></h3>
                <div className="relative mt-3 flex h-28 items-end gap-2">
                  <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-slate-300" style={{ bottom: `${(data.usualPerDay / maxDay) * 100}%` }} aria-hidden />
                  {daily.map((d) => {
                    const v = d.calls + d.notes + d.moves;
                    const low = data.usualPerDay > 0 && v <= data.usualPerDay * 0.4;
                    return (
                      <div key={d.day} className="flex flex-1 flex-col items-center justify-end gap-1" title={`${d.day}: ${v}`}>
                        <div className={`w-full rounded-sm ${low ? "bg-red-400" : "bg-blue-200"}`} style={{ height: `${Math.max((v / maxDay) * 100, 3)}%` }} />
                        <span className="text-[10px] text-gray-500">{new Date(`${d.day}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" })}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900">What they did</h3>
                {data.timeline.length === 0 ? (
                  <p className="py-4 text-sm text-gray-500">Nothing recorded in this period.</p>
                ) : (
                  <ul className="mt-2 border-l border-gray-200 pl-4">
                    {data.timeline.map((t, i) => (
                      <li key={i} className="relative py-1.5 text-sm text-gray-700">
                        <span className="absolute -left-[21px] top-3 h-2 w-2 rounded-full bg-gray-300" aria-hidden />
                        {KINDS[t.kind] ?? t.kind} <span className="font-semibold text-gray-900">{t.leadName}</span>
                        {t.detail ? <span className="text-gray-600"> · {t.detail}</span> : null}
                        <span className="ml-2 text-xs text-gray-500">{fmtWhen(t.at, tz)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
