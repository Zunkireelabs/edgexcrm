"use client";

import { useMemo, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { activityOf, type EventsQuery, type MetricKey, type PersonRow, type PulseResponse } from "../lib/types";
import { avatarColor, deltaLabel, fmtNum, initials } from "./format";
import { Sparkline } from "./sparkline";

type OpenFn = (title: string, crumbs: string[], q: EventsQuery) => void;

type SortKey = "moves" | "calls" | "received" | "reached_applications" | "name";
const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: "moves", label: "Moved forward" },
  { key: "calls", label: "Calls" },
  { key: "received", label: "Leads received" },
  { key: "reached_applications", label: "Students in Apps" },
  { key: "name", label: "Name" },
];

const COLS: Array<{ key: MetricKey | "moves"; label: string; group: "activity" | "results"; sub: "usual" | "delta" }> = [
  { key: "received", label: "Leads received", group: "activity", sub: "usual" },
  { key: "moves", label: "Moved forward", group: "activity", sub: "delta" },
  { key: "status_changes", label: "Status changes", group: "activity", sub: "delta" },
  { key: "notes", label: "Notes", group: "activity", sub: "delta" },
  { key: "calls", label: "Calls", group: "activity", sub: "delta" },
  { key: "prospects", label: "Prospects", group: "results", sub: "delta" },
  { key: "reached_applications", label: "Students in Apps", group: "results", sub: "delta" },
  { key: "applications_filed", label: "Apps filed", group: "results", sub: "delta" },
];

const POSITION_ORDER = ["telecaller", "executive", "counsellor", "counselor", "app-executive"];

function Cell({
  value, usual, mode, max, onClick, extra, tint,
}: { value: number; usual: number; mode: "usual" | "delta"; max: number; onClick: () => void; extra?: string; tint: string }) {
  const d = deltaLabel(value, usual);
  const width = max > 0 ? Math.max(4, Math.round((value / max) * 100)) : 0;
  const alarm = mode === "usual" && usual > 0 && value >= usual * 1.8 && value >= 20;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={value === 0}
      className="relative block w-full px-2 py-2.5 text-right disabled:cursor-default"
      aria-label={`${value}`}
    >
      {value > 0 && (
        <span className="absolute inset-y-2 right-1 rounded-md" style={{ width: `${width}%`, maxWidth: "calc(100% - 8px)", background: tint, opacity: 0.55 }} aria-hidden />
      )}
      <span className="relative block text-[15px] font-semibold leading-5 text-gray-900">{value === 0 ? <span className="text-gray-300">—</span> : fmtNum(value)}</span>
      <span className={`relative block text-[11px] leading-4 ${mode === "usual" ? (alarm ? "font-semibold text-red-600" : "text-gray-500") : d?.tone === "bad" ? "font-semibold text-red-600" : d?.tone === "good" ? "font-semibold text-emerald-600" : "text-gray-500"}`}>
        {mode === "usual" ? `usual ${fmtNum(usual)}` : (extra ?? d?.text ?? "")}
      </span>
    </button>
  );
}

export function Scoreboard({
  data, roleFilter, onOpen, onPerson,
}: {
  data: PulseResponse;
  roleFilter: string;
  onOpen: OpenFn;
  onPerson: (p: PersonRow) => void;
}) {
  const [sort, setSort] = useState<SortKey>("moves");
  const [group, setGroup] = useState<"role" | "none">("role");

  const stageName = useMemo(() => new Map(data.funnel.stages.map((s) => [s.listId, s])), [data.funnel.stages]);
  const people = useMemo(() => data.people.filter((p) => roleFilter === "all" || p.positionSlug === roleFilter), [data.people, roleFilter]);
  const max = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of COLS) m[c.key] = Math.max(0, ...people.map((p) => p.current[c.key as MetricKey]));
    return m;
  }, [people]);

  const sorted = useMemo(() => {
    const arr = [...people];
    arr.sort((a, b) => (sort === "name" ? a.name.localeCompare(b.name) : b.current[sort] - a.current[sort] || a.name.localeCompare(b.name)));
    return arr;
  }, [people, sort]);

  const groups = useMemo(() => {
    if (group === "none") return [{ key: "all", name: "", rows: sorted }];
    const m = new Map<string, { key: string; name: string; rows: PersonRow[] }>();
    for (const p of sorted) {
      const key = p.positionSlug ?? "none";
      const g = m.get(key) ?? { key, name: p.positionName ?? "No position", rows: [] };
      g.rows.push(p);
      m.set(key, g);
    }
    return [...m.values()].sort((a, b) => {
      const ia = POSITION_ORDER.indexOf(a.key), ib = POSITION_ORDER.indexOf(b.key);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
  }, [sorted, group]);

  const open = (p: PersonRow, key: MetricKey | "moves", label: string, detail?: string) =>
    onOpen(`${p.current[key as MetricKey]} ${label} — ${p.name}`, [p.name, label], { metric: key as MetricKey, userId: p.userId, detail: detail ?? null });

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5" aria-label="Team scoreboard">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Team scoreboard</h2>
          <p className="mt-0.5 text-sm text-gray-500">Click any number to see the exact leads. Small figures show the change against that person&apos;s usual.</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={group} onValueChange={(v) => setGroup(v as "role" | "none")}>
            <SelectTrigger size="sm" className="w-auto gap-1.5 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="role">Group: Role</SelectItem>
              <SelectItem value="none">No grouping</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
            <SelectTrigger size="sm" className="w-auto gap-1.5 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {SORTS.map((s) => <SelectItem key={s.key} value={s.key}>Sort: {s.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[1080px] border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              <th className="sticky left-0 z-20 bg-white" />
              <th colSpan={5} className="px-2 pb-1 text-left">Activity · what they did</th>
              <th colSpan={3} className="border-l border-gray-100 px-2 pb-1 text-left">Results · on leads they hold</th>
              <th />
            </tr>
            <tr className="text-xs font-medium text-gray-500">
              <th className="sticky left-0 z-20 bg-white px-2 pb-2 text-left">Person</th>
              {COLS.map((c, i) => (
                <th key={c.key} className={`px-2 pb-2 text-right ${c.key === "prospects" ? "border-l border-gray-100" : ""} ${i === 1 ? "min-w-[180px]" : "min-w-[84px]"}`}>{c.label}</th>
              ))}
              <th className="px-2 pb-2 text-left">Trend vs usual</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <GroupRows key={g.key} g={g} showHeader={group === "role"}>
                {g.rows.map((p) => {
                  const flagCls = p.flag === "red" ? "border-l-red-500" : p.flag === "amber" ? "border-l-amber-500" : "border-l-transparent";
                  return (
                    <tr key={p.userId} className="group border-t border-gray-100">
                      <td className={`sticky left-0 z-10 border-l-[3px] bg-white px-2 py-2 ${flagCls}`}>
                        <button type="button" onClick={() => onPerson(p)} className="flex items-center gap-2.5 text-left">
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-white" style={{ background: avatarColor(p.userId) }}>{initials(p.name)}</span>
                          <span>
                            <span className="block text-sm font-semibold text-gray-900 hover:underline">{p.name}</span>
                            <span className="block text-xs text-gray-500">{[p.positionName, p.branchName].filter(Boolean).join(" · ")}</span>
                          </span>
                        </button>
                      </td>
                      {COLS.map((c) => {
                        const tint = c.group === "results" ? "#d1fae5" : "#dbeafe";
                        const border = c.key === "prospects" ? "border-l border-gray-100" : "";
                        if (c.key === "moves") {
                          const entries = Object.entries(p.movesByStage)
                            .map(([id, n]) => ({ id, n, s: stageName.get(id) }))
                            .sort((a, b) => (a.s?.sortOrder ?? 99) - (b.s?.sortOrder ?? 99));
                          return (
                            <td key={c.key} className={`px-1 ${border}`}>
                              <div className="flex flex-wrap items-center justify-end gap-1">
                                {entries.length === 0 && <span className="px-2 text-gray-300">—</span>}
                                {entries.map((e) => (
                                  <button key={e.id} type="button"
                                    onClick={() => open(p, "moves", `moved to ${e.s?.name ?? "Other stage"}`, e.id)}
                                    className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-700 hover:bg-slate-200">
                                    → {e.s?.name ?? "Other stage"} {e.n}
                                  </button>
                                ))}
                              </div>
                            </td>
                          );
                        }
                        const k = c.key as MetricKey;
                        const extra = k === "notes" && p.notesEdited > 0 ? `${p.notesEdited} edited` : undefined;
                        return (
                          <td key={c.key} className={border}>
                            <Cell value={p.current[k]} usual={p.usual[k]} mode={c.sub} max={max[c.key]} tint={tint}
                              extra={extra}
                              onClick={() => open(p, k, c.label.toLowerCase(), undefined)} />
                          </td>
                        );
                      })}
                      <td className="px-2">
                        <Sparkline values={p.trend} color={p.flag === "red" ? "#dc2626" : "#2563eb"} width={92} height={28} reference={activityOf(p.usual)} />
                      </td>
                    </tr>
                  );
                })}
              </GroupRows>
            ))}
            {people.length === 0 && (
              <tr><td colSpan={COLS.length + 2} className="py-10 text-center text-sm text-gray-500">No team members match this filter.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-gray-50 px-4 py-3 text-sm text-gray-700">
        <span>
          <span className="font-semibold">Not in scores:</span>{" "}
          {data.bulk.moves === 0
            ? "no bulk stage moves in this period."
            : `${data.bulk.moves} stage move${data.bulk.moves === 1 ? "" : "s"} made in bulk (${data.bulk.byPerson.map((b) => `${b.name} ${b.count}`).join(", ")}). They count for leads and results, not for anyone's activity.`}
        </span>
      </div>
    </section>
  );
}

function GroupRows({ g, showHeader, children }: { g: { name: string; rows: PersonRow[] }; showHeader: boolean; children: React.ReactNode }) {
  return (
    <>
      {showHeader && (
        <tr>
          <td colSpan={COLS.length + 2} className="bg-gray-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            {g.name} · {g.rows.length}
          </td>
        </tr>
      )}
      {children}
    </>
  );
}
