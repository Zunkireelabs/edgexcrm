import type { Measure } from "./compare";
import { COMPARE_WINDOW_DAYS } from "./compare";
import { PROCESS_NAMES, type ProcessKey } from "./keys";

/**
 * The improvements log (EDGEX-109 P2, decision 10): REAL events derived from rows, no events table. Baseline written, change suggested,
 * version approved, draft rejected, and "30 days on" for a version that has been live 30 days. Nothing invented.
 */

export interface LogVersion {
  id: string;
  processKey: ProcessKey;
  version: number;
  status: "draft" | "live" | "retired" | "rejected";
  source: "system" | "person" | "agent";
  created_at: string;
  approved_at: string | null;
  approved_by: string | null;
  rejected_at: string | null;
  rejected_by: string | null;
  rejected_reason: string | null;
}
export interface LogChange {
  id: string;
  processKey: ProcessKey;
  versionId: string;
  title: string;
  author_user_id: string | null;
  author_kind: "person" | "agent";
  created_at: string;
}

export type LogKind = "baseline" | "suggested" | "approved" | "rejected" | "thirty_days";
export interface LogEvent {
  at: string;
  kind: LogKind;
  processKey: ProcessKey;
  processName: string;
  versionId: string;
  version: number;
  text: string;
  actor: string | null;
  reason: string | null;
  /** True where a "Before -> after" button applies (an approved v2+, and every "30 days on"). */
  beforeAfter: boolean;
  /** "30 days on" only. */
  measures: Measure[] | null;
}

const DAY = 86_400_000;

/**
 * Versions that have run 30 days: v2+ with an approval time, where the NEXT version's approval (if any) did not cut it short. The event
 * happens at approved_at + 30 days.
 */
export function thirtyDaysOn(versions: LogVersion[], now: Date): Array<LogVersion & { at: string }> {
  const out: Array<LogVersion & { at: string }> = [];
  for (const v of versions) {
    if (v.version < 2 || !v.approved_at) continue;
    const due = Date.parse(v.approved_at) + COMPARE_WINDOW_DAYS * DAY;
    const next = versions
      .filter((x) => x.processKey === v.processKey && x.version > v.version && x.approved_at)
      .sort((a, b) => a.version - b.version)[0];
    const end = next?.approved_at ? Date.parse(next.approved_at) : now.getTime();
    if (end >= due) out.push({ ...v, at: new Date(due).toISOString() });
  }
  return out;
}

export function buildImprovementLog(input: {
  versions: LogVersion[];
  changes: LogChange[];
  names: ReadonlyMap<string, string>;
  /** Measures for each version in `thirtyDaysOn`, keyed by version id. */
  measuresByVersion: ReadonlyMap<string, Measure[]>;
  now: Date;
}): LogEvent[] {
  const { versions, changes, names, measuresByVersion, now } = input;
  const who = (id: string | null) => (id ? (names.get(id) ?? null) : null);
  const vById = new Map(versions.map((v) => [v.id, v]));
  const ev = (v: { processKey: ProcessKey; id: string; version: number }, e: Pick<LogEvent, "at" | "kind" | "text"> & Partial<LogEvent>): LogEvent => ({
    processName: PROCESS_NAMES[v.processKey],
    processKey: v.processKey,
    versionId: v.id,
    version: v.version,
    actor: null,
    reason: null,
    beforeAfter: false,
    measures: null,
    ...e,
  });

  const out: LogEvent[] = [];
  for (const v of versions) {
    const name = PROCESS_NAMES[v.processKey];
    if (v.source === "system" && v.version === 1) out.push(ev(v, { at: v.created_at, kind: "baseline", text: `${name}: v1 written from your data (how it works today)` }));
    if (v.approved_at) out.push(ev(v, { at: v.approved_at, kind: "approved", text: `${name}: v${v.version} approved`, actor: who(v.approved_by), beforeAfter: v.version >= 2 }));
    if (v.rejected_at) out.push(ev(v, { at: v.rejected_at, kind: "rejected", text: `${name}: draft v${v.version} rejected`, actor: who(v.rejected_by), reason: v.rejected_reason }));
  }
  for (const c of changes) {
    const v = vById.get(c.versionId);
    if (!v) continue;
    out.push(ev(v, { at: c.created_at, kind: "suggested", text: `${PROCESS_NAMES[c.processKey]}: ${c.title} suggested`, actor: c.author_kind === "agent" ? "Orca" : who(c.author_user_id) }));
  }
  for (const t of thirtyDaysOn(versions, now)) {
    out.push(ev(t, { at: t.at, kind: "thirty_days", text: `${PROCESS_NAMES[t.processKey]}: v${t.version} after 30 days`, beforeAfter: true, measures: measuresByVersion.get(t.id) ?? [] }));
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}
