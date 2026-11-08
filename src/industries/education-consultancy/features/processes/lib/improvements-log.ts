import type { Measure } from "./compare";
import { COMPARE_WINDOW_DAYS } from "./compare";
import { PROCESS_NAMES, type ProcessKey } from "./keys";
import { fmtDay } from "./view";

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
/** A saved office-hours change (audit row `office_hours.updated`). `from` / `to` are already in words: "Sun–Fri, 9–6". */
export interface OfficeHoursChange {
  at: string;
  actor: string | null;
  from: string | null;
  to: string;
}
export interface LogChange {
  id: string;
  processKey: ProcessKey;
  versionId: string;
  /** From `changeTitle()`: "First contact: count in working hours". */
  title: string;
  why: string;
  status: "open" | "taken" | "not_taken";
  author_user_id: string | null;
  author_kind: "person" | "agent";
  created_at: string;
}

export type LogKind = "baseline" | "suggested" | "approved" | "rejected" | "thirty_days" | "office_hours";
export interface LogEvent {
  at: string;
  kind: LogKind;
  processKey: ProcessKey;
  /** Every process the event covers (more than one only on a grouped "4 baselines" row). */
  processKeys: ProcessKey[];
  processName: string;
  versionId: string;
  version: number;
  /** The bold headline ("New lead → first call: v2 live"). */
  text: string;
  /** The grey line under it. */
  meta: string;
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

const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n).trimEnd()}…` : t);

/** "Manish" / "Manish and Asha" / "Manish and 2 others". */
export const joinNames = (names: string[]): string => (names.length <= 1 ? (names[0] ?? "someone") : names.length === 2 ? `${names[0]} and ${names[1]}` : `${names[0]} and ${names.length - 1} others`);

export function buildImprovementLog(input: {
  versions: LogVersion[];
  changes: LogChange[];
  names: ReadonlyMap<string, string>;
  /** Measures for each version in `thirtyDaysOn`, keyed by version id. */
  measuresByVersion: ReadonlyMap<string, Measure[]>;
  now: Date;
  /** The cheap list-card variant skips the "30 days on" events (they need the metrics SQL). */
  skipThirtyDays?: boolean;
  /** Saved office-hours changes, shown under every process in `workingClockVersions`. */
  officeHoursChanges?: OfficeHoursChange[];
  /** The LIVE versions whose first-contact clock is "working" (office hours): the processes an office-hours change affects. */
  workingClockVersions?: LogVersion[];
}): LogEvent[] {
  const { versions, changes, names, measuresByVersion, now } = input;
  const who = (id: string | null) => (id ? (names.get(id) ?? null) : null);
  const authorOf = (c: LogChange) => (c.author_kind === "agent" ? "Orca" : (who(c.author_user_id) ?? "someone"));
  const vById = new Map(versions.map((v) => [v.id, v]));
  const ev = (v: { processKey: ProcessKey; id: string; version: number }, e: Pick<LogEvent, "at" | "kind" | "text"> & Partial<LogEvent>): LogEvent => ({
    processName: PROCESS_NAMES[v.processKey],
    processKey: v.processKey,
    processKeys: [v.processKey],
    versionId: v.id,
    version: v.version,
    meta: "",
    actor: null,
    reason: null,
    beforeAfter: false,
    measures: null,
    ...e,
  });

  const out: LogEvent[] = [];
  for (const v of versions) {
    const name = PROCESS_NAMES[v.processKey];
    if (v.source === "system" && v.version === 1) {
      const from = fmtDay(new Date(Date.parse(v.created_at) - 30 * DAY).toISOString());
      out.push(ev(v, { at: v.created_at, kind: "baseline", text: `${name}: v1 written from your data`, meta: `v1 as-is baseline, from ${from} – ${fmtDay(v.created_at)}` }));
    }
    if (v.approved_at) {
      const actor = who(v.approved_by);
      if (v.version >= 2) {
        const mine = changes.filter((c) => c.versionId === v.id);
        const taken = mine.filter((c) => c.status === "taken");
        const notTaken = mine.filter((c) => c.status === "not_taken");
        const authors = [...new Set(taken.map(authorOf))];
        const bits = [
          taken.length ? `${taken.length} ${taken.length === 1 ? "change" : "changes"}: ${taken.map((c) => c.title).join("; ")}` : null,
          taken.length ? `suggested by ${joinNames(authors)}, approved by ${actor ?? "someone"}` : `approved by ${actor ?? "someone"}`,
          notTaken.length ? `${notTaken.length} ${notTaken.length === 1 ? "change" : "changes"} not taken` : null,
        ].filter(Boolean);
        out.push(ev(v, { at: v.approved_at, kind: "approved", text: `${name}: v${v.version} live`, meta: bits.join(" · "), actor, beforeAfter: true }));
      } else {
        out.push(ev(v, { at: v.approved_at, kind: "approved", text: `${name}: baseline approved`, meta: `v1 approved by ${actor ?? "someone"}`, actor }));
      }
    }
    if (v.rejected_at) {
      const actor = who(v.rejected_by);
      out.push(ev(v, { at: v.rejected_at, kind: "rejected", text: `${name}: draft v${v.version} rejected`, meta: `Rejected by ${actor ?? "someone"}${v.rejected_reason ? ` · "${v.rejected_reason}"` : ""}`, actor, reason: v.rejected_reason }));
    }
  }
  for (const c of changes) {
    const v = vById.get(c.versionId);
    if (!v) continue;
    const actor = c.author_kind === "agent" ? "Orca" : who(c.author_user_id);
    out.push(ev(v, { at: c.created_at, kind: "suggested", text: `${PROCESS_NAMES[c.processKey]}: change suggested`, meta: `${actor ?? "someone"} · ${c.title} · "${clip(c.why, 80)}"`, actor }));
  }
  for (const wv of input.workingClockVersions ?? []) {
    for (const o of input.officeHoursChanges ?? []) {
      if (wv.approved_at && o.at < wv.approved_at) continue; // before this version went live: it did not run on it
      out.push(ev(wv, { at: o.at, kind: "office_hours", text: `${PROCESS_NAMES[wv.processKey]}: office hours changed`, meta: `${o.actor ?? "Someone"} · ${o.from ? `${o.from} → ` : "now "}${o.to}`, actor: o.actor }));
    }
  }
  if (!input.skipThirtyDays) {
    for (const t of thirtyDaysOn(versions, now)) {
      const prev = versions.filter((x) => x.processKey === t.processKey && x.version < t.version && x.approved_at).sort((a, b) => b.version - a.version)[0];
      const last = new Date(Date.parse(t.at) - DAY).toISOString();
      out.push(
        ev(t, {
          at: t.at,
          kind: "thirty_days",
          text: `${PROCESS_NAMES[t.processKey]}: v${t.version}, 30 days on`,
          meta: `Same measures${prev ? ` as v${prev.version}` : ""}, ${fmtDay(t.approved_at!)} – ${fmtDay(last)}`,
          beforeAfter: true,
          measures: measuresByVersion.get(t.id) ?? [],
        }),
      );
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

/** YYYY-MM-DD in the tenant's timezone. */
export const dayKey = (iso: string, tz: string): string => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
/** "9 December 2026". */
export const dayLabel = (iso: string, tz: string): string => new Date(iso).toLocaleDateString("en-GB", { timeZone: tz, day: "numeric", month: "long", year: "numeric" });

/**
 * Merge what the mockup shows as one row: baselines written the same day become "4 processes written from your data", and baselines
 * approved the same day by the same person become "4 baselines approved". Everything else is untouched. Order is kept (newest first).
 */
export function groupLogEvents(events: LogEvent[], tz: string): LogEvent[] {
  const out: LogEvent[] = [];
  const buckets = new Map<string, LogEvent[]>();
  const slot = new Map<string, number>();
  for (const e of events) {
    const mergeable = e.kind === "baseline" || (e.kind === "approved" && e.version === 1);
    if (!mergeable) {
      out.push(e);
      continue;
    }
    const k = `${e.kind}|${dayKey(e.at, tz)}|${e.actor ?? ""}`;
    const b = buckets.get(k);
    if (b) b.push(e);
    else {
      buckets.set(k, [e]);
      slot.set(k, out.length);
      out.push(e);
    }
  }
  for (const [k, group] of buckets) {
    if (group.length < 2) continue;
    const first = group[0];
    const keys = group.map((g) => g.processKey);
    const merged: LogEvent =
      first.kind === "baseline"
        ? { ...first, processKeys: keys, text: `${group.length} processes written from your data`, meta: first.meta.replace(/^v1 as-is baseline, /, "v1 as-is baseline of each, ") }
        : { ...first, processKeys: keys, text: `${group.length} baselines approved`, meta: `${first.actor ?? "Someone"} approved v1 of ${group.map((g) => g.processName).join(", ")}` };
    out[slot.get(k)!] = merged;
  }
  return out;
}
