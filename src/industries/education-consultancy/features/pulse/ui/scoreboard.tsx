"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { rowNote } from "../lib/notes";
import { pluralLabel } from "../lib/positions";
import type { CellValues, EventsQuery, PersonRow, PulseGroup, PulseResponse, StageSeries } from "../lib/types";
import { Caret, Spark } from "./icons";
import { avatarColor, initials } from "./format";
import { changeVsUsual } from "../lib/compare";
import { NA_ROLES, sumVisible } from "../lib/scoreboard-cols";
import { evidenceLabels } from "./evidence";

type Open = (title: string, crumbs: string[], q: EventsQuery) => void;
type RowLike = Pick<PersonRow | PulseGroup, "current" | "previous" | "usual" | "forwardByStage" | "hasUsual" | "previousCovered">;

interface Col {
  id: string;
  label: string;
  group: "Intake" | "Moved to" | "Activity" | "Results · delivered";
  /** which roles are NOT part of this column ("–") */
  naRoles: string[];
  value: (r: RowLike, stageId?: string) => CellValues;
  query: (stageId?: string) => EventsQuery;
  /** a rise in this column is a bad thing (colours its change red) / capacity (amber) */
  rise?: "bad" | "warn";
  stageSlug?: string;
}
const metric = (k: keyof PersonRow["current"]) => (r: RowLike): CellValues => ({ current: r.current[k], previous: r.previous[k], usual: r.usual[k] });
const stage = (r: RowLike, id?: string): CellValues => (id ? (r.forwardByStage[id] ?? { current: 0, previous: 0, usual: 0 }) : { current: 0, previous: 0, usual: 0 });

const COLS: Col[] = [
  { id: "received", label: "Received", group: "Intake", naRoles: NA_ROLES["received"], value: metric("received"), query: () => ({ metric: "received" }), rise: "warn" },
  { id: "s-pre", label: "Pre-qual.", group: "Moved to", naRoles: NA_ROLES["s-pre"], value: (r, id) => stage(r, id), query: (id) => ({ metric: "moves_forward", detail: id }), stageSlug: "pre-qualified" },
  { id: "s-q", label: "Qualified", group: "Moved to", naRoles: NA_ROLES["s-q"], value: (r, id) => stage(r, id), query: (id) => ({ metric: "moves_forward", detail: id }), stageSlug: "qualified" },
  { id: "s-p", label: "Prospects", group: "Moved to", naRoles: NA_ROLES["s-p"], value: (r, id) => stage(r, id), query: (id) => ({ metric: "moves_forward", detail: id }), stageSlug: "prospects" },
  { id: "s-a", label: "Apps", group: "Moved to", naRoles: NA_ROLES["s-a"], value: (r, id) => stage(r, id), query: (id) => ({ metric: "moves_forward", detail: id }), stageSlug: "applications" },
  { id: "back", label: "Back", group: "Moved to", naRoles: NA_ROLES["back"], value: metric("back_archived"), query: () => ({ metric: "back_archived" }), rise: "bad" },
  { id: "status", label: "Status", group: "Activity", naRoles: NA_ROLES["status"], value: metric("status_changes"), query: () => ({ metric: "status_changes" }) },
  { id: "notes", label: "Notes", group: "Activity", naRoles: NA_ROLES["notes"], value: metric("notes"), query: () => ({ metric: "notes" }) },
  { id: "calls", label: "Calls", group: "Activity", naRoles: NA_ROLES["calls"], value: metric("calls"), query: () => ({ metric: "calls" }) },
  { id: "r-p", label: "Prospects", group: "Results · delivered", naRoles: NA_ROLES["r-p"], value: metric("prospects"), query: () => ({ metric: "prospects" }) },
  { id: "r-s", label: "Students", group: "Results · delivered", naRoles: NA_ROLES["r-s"], value: metric("reached_applications"), query: () => ({ metric: "reached_applications" }) },
  { id: "r-f", label: "Filed", group: "Results · delivered", naRoles: NA_ROLES["r-f"], value: metric("applications_filed"), query: () => ({ metric: "applications_filed" }) },
];
const GROUPS = ["Intake", "Moved to", "Activity", "Results · delivered"] as const;
const SPAN = (g: string) => COLS.filter((c) => c.group === g).length;
const FIRST_OF_GROUP = new Set(GROUPS.map((g) => COLS.find((c) => c.group === g)!.id));

type SortKey = "moves" | "calls" | "received" | "reached_applications" | "name";
const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: "moves", label: "Moved forward" }, { key: "calls", label: "Calls" }, { key: "received", label: "Received" },
  { key: "reached_applications", label: "Students" }, { key: "name", label: "Name" },
];

/**
 * A cell's value. A role-less row (team total, branch group) is the sum of the VISIBLE person cells in that column, so
 * a total can never show people the rows beneath it do not (the old "total 16, every row 0 or –").
 */
function cellValue(col: Col, r: RowLike, roleKey: string | null, ps: PersonRow[] | undefined, sid?: string): CellValues {
  return roleKey === null && ps ? sumVisible(col.naRoles, ps, (p) => col.value(p, sid)) : col.value(r, sid);
}

/** The change vs usual: the one shared guard (lib/compare.ts), so the table and the drawer tiles agree. */
function change(v: CellValues, hasUsual: boolean, rise?: "bad" | "warn"): { text: string; cls: string } | null {
  return changeVsUsual(v.current, v.usual, hasUsual, rise);
}

function Cell({
  v, col, na, onOpen, plain, periodLabel, hasUsual, previousCovered, unit, slot, today,
}: { slot: number; v: CellValues; col: Col; na: boolean; onOpen?: () => void; plain?: boolean; periodLabel: string; hasUsual: boolean; previousCovered: boolean; unit: string; today?: boolean }) {
  const first = FIRST_OF_GROUP.has(col.id) ? "sp" : "";
  if (na) return <td className={first}><span className="z">–</span></td>;
  const ch = change(v, hasUsual, col.rise);
  const num = v.current === 0 ? <span className="z">0</span> : <>{v.current.toLocaleString("en-US")}</>;
  return (
    <td className={first}>
      <span className="cell">
        {onOpen && v.current > 0 && !plain ? (
          <button type="button" onClick={onOpen} aria-label={`${v.current}`}><span className="v0">{num}</span></button>
        ) : (
          <span className="v0">{num}</span>
        )}
        {/* Change figures are for Intake / Activity / Results only — stage-move columns stay quiet (design system §6). */}
        {/* The delta slot exists only in columns where some visible row shows a change, sized to the longest one. */}
        {col.group !== "Moved to" && slot > 0 && <span className={`d ${ch?.cls ?? ""}`} style={{ width: `calc(${slot}ch + 4px)` }}>{ch?.text ?? ""}</span>}
        <span className="tip" role="tooltip">
          <div><span>{periodLabel}</span><b>{v.current}</b></div>
          {hasUsual ? <div><span>{today ? "Usual by this time" : "Usual"}</span><b>{Math.round(v.usual)}</b></div> : <div className="nu">No usual yet · needs 2 earlier {unit} periods</div>}
          {previousCovered && <div><span>{today ? "Yesterday by this time" : "Last period"}</span><b>{v.previous}</b></div>}
        </span>
      </span>
    </td>
  );
}

export function Scoreboard({
  data, mode, periodLabel, onOpen, onPerson,
}: {
  data: PulseResponse;
  mode: "preview" | "off";
  periodLabel: string;
  onOpen: Open;
  onPerson: (p: PersonRow) => void;
}) {
  const unit = data.window.key === "7d" ? "7-day" : data.window.key === "30d" ? "30-day" : data.window.key === "today" ? "same-weekday" : "equal-length";
  const [sort, setSort] = useState<SortKey>("moves");
  // Right-edge fade only when the table actually scrolls horizontally and there is more to the right.
  const tblRef = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState(false);
  const measure = useCallback(() => {
    const el = tblRef.current;
    if (el) setFade(el.scrollWidth - el.clientWidth - el.scrollLeft > 2);
  }, []);
  useEffect(() => {
    const el = tblRef.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, data.people.length]);
  const [view, setView] = useState<"role" | "branch" | "none">("role");
  const stageId = useMemo(() => {
    const m: Record<string, string> = {};
    for (const s of data.funnel.stages) m[s.slug] = s.listId;
    return m;
  }, [data.funnel.stages]);

  const sorted = useMemo(() => {
    const arr = [...data.people];
    arr.sort((a, b) => (sort === "name" ? a.name.localeCompare(b.name) : b.current[sort] - a.current[sort] || a.name.localeCompare(b.name)));
    return arr;
  }, [data.people, sort]);

  const groups = useMemo(() => {
    if (view === "none") return [] as Array<{ key: string; label: string; people: PersonRow[]; agg: PulseGroup | null }>;
    if (view === "role") {
      return data.groups.map((g) => ({ key: g.key, label: g.label, people: sorted.filter((p) => p.positionKey === g.key), agg: g }));
    }
    const m = new Map<string, PersonRow[]>();
    for (const p of sorted) { const k = p.branchName ?? "No branch"; m.set(k, [...(m.get(k) ?? []), p]); }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, ps]) => ({ key: k, label: k, people: ps, agg: null as PulseGroup | null }));
  }, [view, data.groups, sorted]);

  const aggFor = (ps: PersonRow[]): RowLike => {
    const sum = (f: (p: PersonRow) => number) => ps.reduce((a, p) => a + f(p), 0);
    const mk = (pick: "current" | "previous" | "usual") => {
      const o = { ...ps[0]?.[pick] } as PersonRow["current"];
      for (const k of Object.keys(o) as Array<keyof typeof o>) o[k] = sum((p) => p[pick][k]);
      return o;
    };
    const fwd: StageSeries = {};
    for (const p of ps) for (const [id, v] of Object.entries(p.forwardByStage)) {
      const e = fwd[id] ?? { current: 0, previous: 0, usual: 0 };
      fwd[id] = { current: e.current + v.current, previous: e.previous + v.previous, usual: e.usual + v.usual };
    }
    return { current: mk("current"), previous: mk("previous"), usual: mk("usual"), forwardByStage: fwd, hasUsual: ps.every((p) => p.hasUsual !== false), previousCovered: ps.every((p) => p.previousCovered !== false) };
  };

  // Per column: the length of the longest change text any visible row shows (0 → no slot at all).
  const slotLen = useMemo(() => {
    const rows: Array<{ r: RowLike; role: string | null; ps?: PersonRow[] }> = sorted.map((p) => ({ r: p, role: p.positionKey }));
    if (view === "role") for (const g of groups) rows.push({ r: g.agg ?? aggFor(g.people), role: g.key });
    else if (view === "branch") for (const g of groups) rows.push({ r: aggFor(g.people), role: null, ps: g.people });
    rows.push({ r: data.team, role: null, ps: data.people });
    const out: Record<string, number> = {};
    for (const col of COLS) {
      if (col.group === "Moved to") continue;
      const sid = col.stageSlug ? stageId[col.stageSlug] : undefined;
      let max = 0;
      for (const { r, role, ps } of rows) {
        if (role !== null && col.naRoles.includes(role)) continue;
        const ch = change(cellValue(col, r, role, ps, sid), r.hasUsual !== false, col.rise);
        if (ch) max = Math.max(max, ch.text.length);
      }
      out[col.id] = max;
    }
    return out;
  }, [sorted, groups, view, data.team, data.people, stageId]);

  const open = (p: PersonRow, col: Col) => {
    const sid = col.stageSlug ? stageId[col.stageSlug] : undefined;
    const q = col.query(sid);
    const v = col.value(p, sid);
    const { title, crumb } = evidenceLabels(q.metric, v.current, { stage: col.stageSlug ? col.label : undefined });
    onOpen(title, [p.name, crumb], { ...q, userId: p.userId });
  };

  const cells = (r: RowLike, roleKey: string | null, p?: PersonRow, ps?: PersonRow[]) =>
    COLS.map((col) => {
      const sid = col.stageSlug ? stageId[col.stageSlug] : undefined;
      return <Cell key={col.id} col={col} v={cellValue(col, r, roleKey, ps, sid)} na={roleKey !== null && col.naRoles.includes(roleKey)} plain={!p} periodLabel={periodLabel} hasUsual={r.hasUsual !== false} previousCovered={r.previousCovered !== false} unit={unit} today={data.window.key === "today"} slot={slotLen[col.id] ?? 0} onOpen={p ? () => open(p, col) : undefined} />;
    });

  const personRow = (p: PersonRow) => {
    const note = rowNote(p);
    return (
      <tr key={p.userId} className={p.flag === "red" ? "rowflag" : p.flag === "amber" ? "rowflag-am" : ""}>
        <td className="l">
          <div className="who">
            <span className="av" style={{ background: avatarColor(p.userId) }}>{initials(p.name)}</span>
            <div className="two">
              <button type="button" className="nm" onClick={() => onPerson(p)}>{p.name}</button>
              <span className="sub">{p.branchName ?? "No branch"}</span>
              {note && (mode === "preview"
                ? <span className="rnote"><Spark className="i" />{note.text}</span>
                : <span className={`flag ${note.kind === "amber" ? "am" : note.kind === "green" ? "gd" : ""}`}>{note.text}</span>)}
            </div>
          </div>
        </td>
        {cells(p, p.positionKey, p)}
      </tr>
    );
  };

  return (
    <div className="sb">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <div className="h2">Team scoreboard</div>
          <div className="meta" style={{ marginTop: 2 }}>Click a number for the exact leads. Hover for usual and last period.</div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <div className="seg" role="tablist" aria-label="Group scoreboard">
            {([["role", "By role"], ["branch", "By branch"], ["none", "Everyone"]] as const).map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={view === k} className={view === k ? "on" : ""} onClick={() => setView(k)}
                style={{ padding: "5px 11px", borderRadius: 8, color: view === k ? "var(--ink)" : "var(--muted)", fontWeight: 500, fontSize: 12.5, background: view === k ? "var(--surface)" : "transparent", boxShadow: view === k ? "0 1px 2px rgba(0,0,0,.06)" : "none" }}>{l}</button>
            ))}
          </div>
          <span className="selwrap">
            <select aria-label="Sort scoreboard" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              {SORTS.map((s) => <option key={s.key} value={s.key}>Sort: {s.label}</option>)}
            </select>
            <Caret />
          </span>
        </div>
      </div>

      <div className={`tblwrap ${fade ? "fade" : ""}`}>
      <div className="tbl" ref={tblRef} onScroll={measure}>
        <table>
          <thead>
            <tr className="g">
              <th className="l" />
              {GROUPS.map((g) => <th key={g} className="l sp" colSpan={SPAN(g)}>{g}</th>)}
            </tr>
            <tr>
              <th className="l">Person</th>
              {COLS.map((c) => <th key={c.id} className={FIRST_OF_GROUP.has(c.id) ? "sp" : ""}>{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {view === "none" && sorted.map(personRow)}
            {groups.map((g) => (
              <Fragment key={g.key}>
                <tr className="gr">
                  <td className="l">{view === "role" ? pluralLabel(g.label.replace(/s$/, "")) : g.label} <span style={{ color: "var(--faint)", fontWeight: 500 }}>{g.people.length}</span></td>
                  {cells(g.agg ?? aggFor(g.people), view === "role" ? g.key : null, undefined, g.people)}
                </tr>
                {g.people.map(personRow)}
              </Fragment>
            ))}
            {data.people.length === 0 && <tr><td className="l" colSpan={COLS.length + 1} style={{ textAlign: "center", color: "var(--muted)", height: 80 }}>No team members yet.</td></tr>}
            <tr className="tot">
              <td className="l">Team total · {data.people.length} {data.people.length === 1 ? "person" : "people"}</td>
              {cells(data.team, null, undefined, data.people)}
            </tr>
          </tbody>
        </table>
      </div>
      </div>

      <div className="foot">
        <span>
          <b style={{ color: "var(--muted)" }}>Not in scores</b> ·{" "}
          {data.bulk.moves === 0
            ? "no bulk moves this period"
            : `${data.bulk.moves} bulk stage move${data.bulk.moves === 1 ? "" : "s"} (${data.bulk.byPerson.map((b) => `${b.name} ${b.count}`).join(", ")}) count for leads and results, not for anyone's activity`}
        </span>
        <span>
          <span className="lg"><span className="d up">+30%</span> / <span className="d dn">−47%</span> vs usual, shown when 25%+ off</span>{" "}
          <span className="lg"><span className="z">0</span> none</span>{" "}
          <span className="lg"><span className="z">–</span> not this role</span>
        </span>
      </div>
    </div>
  );
}
