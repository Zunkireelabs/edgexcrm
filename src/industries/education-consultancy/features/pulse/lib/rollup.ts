import { POSITION_ORDER, pluralLabel } from "./positions";
import { METRIC_KEYS, ZERO_COUNTS, type MetricCounts, type PersonRow, type PulseGroup, type StageSeries } from "./types";

function sumCounts(rows: MetricCounts[]): MetricCounts {
  const out = { ...ZERO_COUNTS };
  for (const r of rows) for (const k of METRIC_KEYS) out[k] += r[k];
  return out;
}

function sumSeries(all: StageSeries[]): StageSeries {
  const out: StageSeries = {};
  for (const s of all) {
    for (const [id, v] of Object.entries(s)) {
      const o = out[id] ?? { current: 0, previous: 0, usual: 0 };
      o.current += v.current;
      o.previous += v.previous;
      o.usual += v.usual; // sum of per-person means == mean of the summed windows
      out[id] = o;
    }
  }
  return out;
}

export function rollup(key: string, label: string, people: PersonRow[]): PulseGroup {
  return {
    key,
    label,
    people: people.length,
    current: sumCounts(people.map((p) => p.current)),
    previous: sumCounts(people.map((p) => p.previous)),
    // A group's usual is only real when EVERY member has one (a partial sum would understate it).
    usual: sumCounts(people.map((p) => p.usual)),
    hasUsual: people.length > 0 && people.every((p) => p.hasUsual !== false),
    previousCovered: people.length > 0 && people.every((p) => p.previousCovered !== false),
    forwardByStage: sumSeries(people.map((p) => p.forwardByStage)),
    backByStage: sumSeries(people.map((p) => p.backByStage)),
  };
}

/** Role subtotals in display order (TeleCaller → Executive → Counsellor → App Executive → …), plus the team total. */
export function rollups(people: PersonRow[]): { groups: PulseGroup[]; team: PulseGroup } {
  const byKey = new Map<string, PersonRow[]>();
  for (const p of people) {
    const list = byKey.get(p.positionKey);
    if (list) list.push(p);
    else byKey.set(p.positionKey, [p]);
  }
  const groups = [...byKey.entries()]
    .map(([key, rows]) => rollup(key, pluralLabel(rows[0].positionLabel), rows))
    .sort((a, b) => {
      const ia = POSITION_ORDER.indexOf(a.key), ib = POSITION_ORDER.indexOf(b.key);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
  return { groups, team: rollup("team", "Team", people) };
}
