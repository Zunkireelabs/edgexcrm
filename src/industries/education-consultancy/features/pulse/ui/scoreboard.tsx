"use client";

import { useMemo, useState } from "react";
import { activityOf, type EventsQuery, type MetricKey, type PersonRow, type PulseResponse } from "../lib/types";
import { POSITION_ORDER, normalizePosition, pluralLabel } from "../lib/positions";
import { FieldSelect } from "./field-select";
import { avatarColor, initials } from "./format";
import { stageChipClass } from "./stage-style";
import { TrendSpark } from "./sparkline";
import { CARD, SEC_SUB, SEC_TITLE } from "./tokens";

type OpenFn = (title: string, crumbs: string[], q: EventsQuery) => void;
type SortKey = "moves" | "calls" | "received" | "reached_applications" | "name";
type ColKey = MetricKey | "moves_forward";

const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: "moves", label: "Moved forward" },
  { key: "calls", label: "Calls" },
  { key: "received", label: "Leads received" },
  { key: "reached_applications", label: "Students in Apps" },
  { key: "name", label: "Name" },
];

/** Column order is the mockup's: Leads received | Moved forward | Back / archived | Status | Notes | Calls | Results… */
const COLS: Array<{ key: ColKey; label: string; group: "activity" | "results"; sub: "usual" | "delta"; badWhenHigh?: boolean; gl?: boolean }> = [
  { key: "received", label: "Leads\nreceived", group: "activity", sub: "usual", badWhenHigh: true, gl: true },
  { key: "moves_forward", label: "Moved forward", group: "activity", sub: "delta" },
  { key: "back_archived", label: "Back /\narchived", group: "activity", sub: "usual", badWhenHigh: true },
  { key: "status_changes", label: "Status\nchanges", group: "activity", sub: "delta" },
  { key: "notes", label: "Notes", group: "activity", sub: "delta" },
  { key: "calls", label: "Calls", group: "activity", sub: "delta" },
  { key: "prospects", label: "Prospects", group: "results", sub: "delta", gl: true },
  { key: "reached_applications", label: "Students\nin Apps", group: "results", sub: "delta" },
  { key: "applications_filed", label: "Apps\nfiled", group: "results", sub: "delta" },
];
const NCOLS = COLS.length + 2; // person + trend

/** ".dv" in the mockup: green when clearly up, red when clearly down, grey when flat (±0 / small moves). */
function deltaSub(cur: number, usual: number): { text: string; cls: string } {
  if (usual <= 0) return cur > 0 ? { text: "new", cls: "text-[#9ca3af] font-medium" } : { text: "", cls: "" };
  const pct = Math.round(((cur - usual) / usual) * 100);
  if (pct === 0) return { text: "±0", cls: "text-[#9ca3af] font-medium" };
  const text = `${pct > 0 ? "+" : "−"}${Math.abs(pct)}%`;
  if (pct >= 5) return { text, cls: "text-[#047857]" };
  if (pct <= -5) return { text, cls: "text-[#b91c1c]" };
  return { text, cls: "text-[#9ca3af] font-medium" };
}

function Num({
  value, usual, mode, max, tint, extra, badWhenHigh, onClick,
}: { value: number; usual: number; mode: "usual" | "delta"; max: number; tint: string; extra?: string; badWhenHigh?: boolean; onClick: () => void }) {
  const width = max > 0 ? Math.max(4, Math.round((value / max) * 100)) : 0;
  let sub: { text: string; cls: string };
  if (extra) sub = { text: extra, cls: "text-[#9ca3af] font-medium" };
  else if (mode === "usual") {
    const hot = badWhenHigh && usual > 0 && value >= usual * 1.8 && value - usual >= 3;
    sub = { text: `usual ${Math.round(usual)}`, cls: hot ? "text-[#b91c1c]" : "text-[#9ca3af] font-medium" };
  } else sub = deltaSub(value, usual);
  return (
    <button type="button" onClick={onClick} disabled={value === 0} className="block w-full text-right disabled:cursor-default" aria-label={String(value)}>
      <span className="relative inline-block min-w-[44px] text-right">
        {value > 0 && width > 0 && (
          <span className="absolute right-0 top-1/2 h-[18px] -translate-y-1/2 rounded-[4px]" style={{ width: `${width}%`, background: tint }} aria-hidden />
        )}
        <b className="relative z-[1] text-[13.5px] font-semibold text-[#171717]">{value === 0 ? <span className="text-[#9ca3af]">—</span> : value}</b>
      </span>
      <span className={`block text-[10.5px] font-semibold leading-[1.2] ${sub.cls}`}>{sub.text}</span>
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

  const stages = useMemo(() => new Map(data.funnel.stages.map((s) => [s.listId, s])), [data.funnel.stages]);
  const people = useMemo(
    () => data.people.filter((p) => roleFilter === "all" || normalizePosition(p.positionSlug, p.positionName).key === roleFilter),
    [data.people, roleFilter],
  );
  const max = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of COLS) m[c.key] = Math.max(0, ...people.map((p) => p.current[c.key === "moves_forward" ? "moves" : (c.key as MetricKey)]));
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
      const { key, label } = normalizePosition(p.positionSlug, p.positionName);
      const g = m.get(key) ?? { key, name: pluralLabel(label), rows: [] };
      g.rows.push(p);
      m.set(key, g);
    }
    return [...m.values()].sort((a, b) => {
      const ia = POSITION_ORDER.indexOf(a.key), ib = POSITION_ORDER.indexOf(b.key);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
  }, [sorted, group]);

  const open = (p: PersonRow, metric: EventsQuery["metric"], n: number, label: string, detail?: string) =>
    onOpen(`${n} ${label} — ${p.name}`, [p.name, label], { metric, userId: p.userId, detail: detail ?? null });

  return (
    <section className={CARD} aria-label="Team scoreboard">
      <div className="mb-2.5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className={SEC_TITLE}>Team scoreboard</div>
          <div className={SEC_SUB}>Click any number to see the exact leads. Small figures show the change against that person&apos;s usual.</div>
        </div>
        <div className="flex gap-1.5">
          <FieldSelect label="Group" value={group} onChange={(v) => setGroup(v as "role" | "none")}>
            <option value="role">Group: Role</option>
            <option value="none">No grouping</option>
          </FieldSelect>
          <FieldSelect label="Sort" value={sort} onChange={(v) => setSort(v as SortKey)}>
            {SORTS.map((s) => <option key={s.key} value={s.key}>Sort: {s.label}</option>)}
          </FieldSelect>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1160px] border-separate border-spacing-0">
          <thead>
            <tr className="text-[10.5px] font-semibold tracking-[0.07em] text-[#9ca3af]">
              <th className="sticky left-0 z-20 bg-white" />
              <th colSpan={6} className="border-l border-[#e5e7eb] px-[7px] text-left">ACTIVITY · what they did</th>
              <th colSpan={3} className="border-l border-[#e5e7eb] px-[7px] text-left">RESULTS · on leads they hold</th>
              <th className="border-l border-[#e5e7eb]" />
            </tr>
            <tr className="text-[11px] font-medium leading-[1.25] text-[#6b7280]">
              <th className="sticky left-0 z-20 border-b border-[#e5e7eb] bg-white px-[7px] py-[7px] text-left align-bottom">Person</th>
              {COLS.map((c) => (
                <th key={c.key} className={`whitespace-pre-line border-b border-[#e5e7eb] px-[7px] py-[7px] align-bottom ${c.key === "moves_forward" ? "text-left" : "text-right"} ${c.gl ? "border-l" : ""}`}>
                  {c.label}
                </th>
              ))}
              <th className="whitespace-pre-line border-b border-l border-[#e5e7eb] px-[7px] py-[7px] text-left align-bottom">{"Trend\nvs usual"}</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <GroupRows key={g.key} name={g.name} count={g.rows.length} show={group === "role"}>
                {g.rows.map((p) => {
                  const edge = p.flag === "red" ? "shadow-[inset_3px_0_0_#ef4444]" : p.flag === "amber" ? "shadow-[inset_3px_0_0_#f59e0b]" : p.flag === "green" ? "shadow-[inset_3px_0_0_#10b981]" : "";
                  const tint = p.flag === "red" ? "bg-[rgba(239,68,68,0.04)]" : p.flag === "amber" ? "bg-[rgba(245,158,11,0.05)]" : "bg-white";
                  const role = normalizePosition(p.positionSlug, p.positionName).label;
                  const forward = Object.entries(p.movesByStage)
                    .map(([id, n]) => ({ id, n, s: stages.get(id) }))
                    .sort((a, b) => (a.s?.sortOrder ?? 99) - (b.s?.sortOrder ?? 99));
                  const trendColor = p.flag === "red" ? "#ef4444" : p.flag === "green" ? "#10b981" : activityOf(p.current) >= activityOf(p.usual) * 1.05 ? "#2272B4" : "#94a3b8";
                  return (
                    <tr key={p.userId} className={tint}>
                      <td className={`sticky left-0 z-10 border-b border-[#f3f3f3] px-[7px] py-[9px] ${tint} ${edge}`}>
                        <button type="button" onClick={() => onPerson(p)} className="flex items-center gap-2.5 text-left">
                          <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full text-[11px] font-semibold text-white" style={{ background: avatarColor(p.userId) }}>{initials(p.name)}</span>
                          <span>
                            <span className="block whitespace-nowrap font-medium text-[#171717]">{p.name}</span>
                            <span className="block whitespace-nowrap text-[11.5px] text-[#6b7280]">{[role, p.branchName].filter(Boolean).join(" · ")}</span>
                          </span>
                        </button>
                      </td>
                      {COLS.map((c) => {
                        const gl = c.gl ? "border-l border-[#e5e7eb]" : "";
                        const cell = "border-b border-[#f3f3f3] px-[7px] py-[9px] align-middle";
                        const isResult = c.group === "results";
                        // Results columns only apply to the roles that hold leads at those stages (the mockup shows "—").
                        if (c.key === "moves_forward") {
                          return (
                            <td key={c.key} className={cell}>
                              <div className="flex flex-wrap gap-1">
                                {forward.length === 0 && <span className="text-[#9ca3af]">—</span>}
                                {forward.map((e) => (
                                  <button key={e.id} type="button"
                                    onClick={() => open(p, "moves_forward", e.n, `moved forward to ${e.s?.name ?? "Other stage"}`, e.id)}
                                    className={`whitespace-nowrap rounded-[6px] px-[7px] py-px text-[11.5px] font-medium ${stageChipClass(e.s?.name ?? e.s?.slug)}`}>
                                    → {e.s?.name ?? "Other stage"} {e.n}
                                  </button>
                                ))}
                              </div>
                            </td>
                          );
                        }
                        const k = c.key as MetricKey;
                        const value = p.current[k];
                        if (isResult && value === 0 && p.usual[k] === 0) {
                          return <td key={c.key} className={`${cell} ${gl} text-right text-[#9ca3af]`}>—</td>;
                        }
                        return (
                          <td key={c.key} className={`${cell} ${gl}`}>
                            <Num value={value} usual={p.usual[k]} mode={c.sub} max={max[c.key]}
                              badWhenHigh={c.badWhenHigh}
                              tint={isResult ? "rgba(16,185,129,0.16)" : "rgba(34,114,180,0.10)"}
                              extra={k === "notes" ? `${p.notesEdited} edited` : undefined}
                              onClick={() => open(p, k, value, c.label.replace("\n", " ").toLowerCase())} />
                          </td>
                        );
                      })}
                      <td className="border-b border-l border-[#e5e7eb] border-b-[#f3f3f3] px-[7px] py-[9px]">
                        <TrendSpark values={p.trend} usual={activityOf(p.usual)} color={trendColor} />
                      </td>
                    </tr>
                  );
                })}
              </GroupRows>
            ))}
            {people.length === 0 && (
              <tr><td colSpan={NCOLS} className="py-10 text-center text-[#6b7280]">No team members match this filter.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-2.5">
        <div className="flex flex-1 items-center gap-2 rounded-[10px] bg-[#f5f5f5] px-3 py-2 text-[12px] text-[#6b7280]">
          <span><b className="font-semibold text-[#333]">Not in scores:</b>{" "}
            {data.bulk.moves === 0
              ? "no bulk stage moves in this period."
              : `${data.bulk.moves} stage move${data.bulk.moves === 1 ? "" : "s"} made in bulk (${data.bulk.byPerson.map((b) => `${b.name} ${b.count}`).join(", ")}) — they count for leads and results, not for anyone's activity.`}
          </span>
        </div>
      </div>
    </section>
  );
}

function GroupRows({ name, count, show, children }: { name: string; count: number; show: boolean; children: React.ReactNode }) {
  return (
    <>
      {show && (
        <tr>
          <td colSpan={NCOLS} className="bg-[#fafafa] px-2.5 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-[#6b7280]">
            {name} · {count}
          </td>
        </tr>
      )}
      {children}
    </>
  );
}
