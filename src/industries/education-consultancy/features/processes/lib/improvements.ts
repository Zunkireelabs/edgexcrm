import { PROCESS_NAMES, type ProcessKey } from "./keys";

export interface VersionEventRow {
  key: ProcessKey;
  version: number;
  source: "system" | "person" | "agent";
  created_at: string;
  approved_at: string | null;
}
export interface ImprovementEvent {
  at: string;
  kind: "baseline" | "approved";
  text: string;
}

/** "EdgeX improvements": REAL events only. Baselines written (grouped when created together) and versions approved. Nothing invented. */
export function buildImprovements(rows: VersionEventRow[], limit = 6): ImprovementEvent[] {
  const events: ImprovementEvent[] = [];
  const baselines = rows.filter((r) => r.source === "system" && r.version === 1);
  if (baselines.length) {
    const at = baselines.map((b) => b.created_at).sort()[baselines.length - 1];
    events.push({ at, kind: "baseline", text: `${baselines.length} ${baselines.length === 1 ? "process" : "processes"} written from your data (v1 as-is baseline)` });
  }
  for (const r of rows) {
    if (r.approved_at) events.push({ at: r.approved_at, kind: "approved", text: `${PROCESS_NAMES[r.key]}: v${r.version} approved` });
  }
  return events.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}
