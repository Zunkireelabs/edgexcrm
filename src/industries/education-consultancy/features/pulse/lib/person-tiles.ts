import type { MetricKey, PersonRow } from "./types";

export interface PersonTile {
  key: string;
  label: string;
  value: number;
  /** null → no baseline: the delta slot stays empty. */
  usual: number | null;
  /** The evidence drill for this tile. */
  metric: MetricKey | "untouched";
}

/** The person drawer's four tiles, by role: Calls / Notes / <what this role delivers> / Untouched. */
export function personTiles(p: PersonRow, untouched: number): PersonTile[] {
  const third: { label: string; metric: MetricKey } =
    p.positionKey === "counsellor" ? { label: "To Apps", metric: "reached_applications" }
    : p.positionKey === "executive" ? { label: "To Prospects", metric: "prospects" }
    : p.positionKey === "app-executive" ? { label: "Filed", metric: "applications_filed" }
    : { label: "Moved", metric: "moves" };
  const t = (key: string, label: string, metric: MetricKey): PersonTile => ({ key, label, metric, value: p.current[metric], usual: p.usual[metric] > 0 ? p.usual[metric] : null });
  return [t("calls", "Calls", "calls"), t("notes", "Notes", "notes"), t("third", third.label, third.metric), { key: "untouched", label: "Untouched", metric: "untouched", value: untouched, usual: null }];
}
