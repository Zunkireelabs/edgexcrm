import { loadUserNames } from "../../pulse/server/context";
import { buildMeasures, comparePeriods, measureMetrics, WINDOWED_PROCESSES, type Measure } from "../lib/compare";
import { changeTitle } from "../lib/changes";
import type { ChangeRecord } from "../lib/changes-flow";
import { buildImprovementLog, thirtyDaysOn, type LogChange, type LogEvent, type LogVersion } from "../lib/improvements-log";
import { PROCESS_NAMES, type ProcessKey } from "../lib/keys";
import type { RawMetrics } from "../lib/metrics";
import { safeParseProcessSpec } from "../lib/spec";
import type { ProcessesContext } from "./context";
import { must } from "./changes";
import { fetchProcessMetrics } from "./load-processes";
import { localDay } from "./snapshots";

/** Before -> after and the improvements log. Plain single-table queries only (no embeds): see server/changes.ts. */

interface Proc {
  id: string;
  key: ProcessKey;
  name: string;
}
interface Ver {
  id: string;
  process_id: string;
  version: number;
  status: LogVersion["status"];
  source: LogVersion["source"];
  spec: unknown;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  rejected_at: string | null;
  rejected_by: string | null;
  rejected_reason: string | null;
}
const VER_COLS = "id, process_id, version, status, source, spec, approved_by, approved_at, created_at, rejected_at, rejected_by, rejected_reason";
const iso = (d: Date) => d.toISOString();

export interface CompareResult {
  process: { key: ProcessKey; name: string };
  previous: { versionId: string; version: number; period: { from: string; to: string } } | null;
  current: { versionId: string; version: number; status: string; approvedAt: string; approvedByName: string | null; period: { from: string; to: string }; daysLive: number };
  measures: Measure[];
}

/** The previous version = the highest earlier version that was ever approved. */
export const previousVersion = <V extends { version: number; approved_at: string | null }>(versions: V[], current: V): V | null =>
  versions.filter((v) => v.version < current.version && v.approved_at).sort((a, b) => b.version - a.version)[0] ?? null;

/** A snapshot's metrics for the latest day on/before `day` (current-state processes have no window, so their "before" is a snapshot). */
async function snapshotBefore(ctx: ProcessesContext, processId: string, day: string): Promise<RawMetrics | null> {
  const rows = must(
    "snapshot read",
    await ctx.db.from("process_metric_snapshots").select("metrics").eq("process_id", processId).lte("day", day).order("day", { ascending: false }).limit(1),
  ) as unknown as Array<{ metrics: RawMetrics }> | null;
  return rows?.[0]?.metrics ?? null;
}

/** Two SQL calls (windowed process) or one snapshot read + one live call (current-state processes). */
export async function compareVersion(ctx: ProcessesContext, proc: Proc, versions: Ver[], current: Ver, now: Date, names: ReadonlyMap<string, { name: string }>): Promise<CompareResult | null> {
  if (!current.approved_at) return null;
  const approved = new Date(current.approved_at);
  const periods = comparePeriods(approved, now);
  const prev = previousVersion(versions, current);
  const curSpec = safeParseProcessSpec(proc.key, current.spec);
  const result: CompareResult = {
    process: { key: proc.key, name: proc.name || PROCESS_NAMES[proc.key] },
    previous: prev ? { versionId: prev.id, version: prev.version, period: { from: iso(periods.previous.from), to: iso(periods.previous.to) } } : null,
    current: {
      versionId: current.id,
      version: current.version,
      status: current.status,
      approvedAt: current.approved_at,
      approvedByName: current.approved_by ? (names.get(current.approved_by)?.name ?? null) : null,
      period: { from: iso(periods.current.from), to: iso(periods.current.to) },
      daysLive: periods.daysLive,
    },
    measures: [],
  };
  if (!prev || !curSpec.ok) return result;

  const prevSpec = safeParseProcessSpec(proc.key, prev.spec);
  const metrics = measureMetrics(prevSpec.ok ? prevSpec.spec : null, curSpec.spec);
  const windowed = WINDOWED_PROCESSES.includes(proc.key);
  const [rawBefore, rawAfter] = await Promise.all([
    windowed ? fetchProcessMetrics(ctx.db, ctx.auth.tenantId, proc.key, periods.previous.from, periods.previous.to, ctx.tz) : snapshotBefore(ctx, proc.id, localDay(approved, ctx.tz)),
    fetchProcessMetrics(ctx.db, ctx.auth.tenantId, proc.key, periods.current.from, periods.current.to, ctx.tz),
  ]);
  result.measures = buildMeasures(proc.key, metrics, rawBefore, rawAfter, periods.daysLive);
  return result;
}

async function loadProcAndVersions(ctx: ProcessesContext, key: ProcessKey): Promise<{ proc: Proc & { live_version_id: string | null }; versions: Ver[] } | null> {
  const proc = must("processes read", await ctx.db.from("processes").select("id, key, name, live_version_id").eq("key", key).maybeSingle()) as unknown as (Proc & { live_version_id: string | null }) | null;
  if (!proc) return null;
  const versions = (must("versions read", await ctx.db.from("process_versions").select(VER_COLS).eq("process_id", proc.id).order("version", { ascending: true })) as unknown as Ver[] | null) ?? [];
  return { proc, versions };
}

export type CompareOutcome = { kind: "ok"; result: CompareResult } | { kind: "not_found" } | { kind: "no_live" };

/** `?version=<id>` (default: the live one). A version that never went live has no before -> after. */
export async function loadCompare(ctx: ProcessesContext, key: ProcessKey, versionId: string | null, now: Date = new Date()): Promise<CompareOutcome> {
  const found = await loadProcAndVersions(ctx, key);
  if (!found) return { kind: "not_found" };
  const current = versionId ? found.versions.find((v) => v.id === versionId) : found.versions.find((v) => v.id === found.proc.live_version_id);
  if (!current) return { kind: versionId ? "not_found" : "no_live" };
  if (!current.approved_at) return { kind: "not_found" };
  const names = await loadUserNames(ctx.db);
  const result = await compareVersion(ctx, found.proc, found.versions, current, now, names);
  return result ? { kind: "ok", result } : { kind: "not_found" };
}

/** Real events, newest first. `processKey` filters to one process. "30 days on" carries the measures from the compare logic. */
export async function loadImprovementLog(ctx: ProcessesContext, processKey: ProcessKey | null, now: Date = new Date()): Promise<LogEvent[]> {
  const procs = ((must("processes read", await ctx.db.from("processes").select("id, key, name")) as unknown as Proc[] | null) ?? []).filter((p) => !processKey || p.key === processKey);
  if (procs.length === 0) return [];
  const ids = procs.map((p) => p.id);
  const vers = (must("versions read", await ctx.db.from("process_versions").select(VER_COLS).in("process_id", ids)) as unknown as Ver[] | null) ?? [];
  const chg = (must("changes read", await ctx.db.from("process_changes").select("id, process_id, version_id, part, field, author_kind, author_user_id, created_at").in("process_id", ids)) as unknown as
    | Array<Pick<ChangeRecord, "id" | "process_id" | "version_id" | "part" | "field" | "author_kind" | "author_user_id" | "created_at">>
    | null) ?? [];
  const names = await loadUserNames(ctx.db);
  const procById = new Map(procs.map((p) => [p.id, p]));
  const specByVersion = new Map(vers.map((v) => [v.id, v.spec]));

  const logVersions: LogVersion[] = vers.map((v) => ({
    id: v.id,
    processKey: procById.get(v.process_id)!.key,
    version: v.version,
    status: v.status,
    source: v.source,
    created_at: v.created_at,
    approved_at: v.approved_at,
    approved_by: v.approved_by,
    rejected_at: v.rejected_at,
    rejected_by: v.rejected_by,
    rejected_reason: v.rejected_reason,
  }));
  const logChanges: LogChange[] = chg.map((c) => {
    const key = procById.get(c.process_id)!.key;
    const parsed = safeParseProcessSpec(key, specByVersion.get(c.version_id));
    return { id: c.id, processKey: key, versionId: c.version_id, title: changeTitle(c, parsed.ok ? parsed.spec : null), author_user_id: c.author_user_id, author_kind: c.author_kind, created_at: c.created_at };
  });

  const measuresByVersion = new Map<string, Measure[]>();
  for (const t of thirtyDaysOn(logVersions, now)) {
    const cur = vers.find((v) => v.id === t.id)!;
    const proc = procById.get(cur.process_id)!;
    const res = await compareVersion(ctx, proc, vers.filter((v) => v.process_id === proc.id), cur, now, names);
    measuresByVersion.set(t.id, res?.measures ?? []);
  }
  return buildImprovementLog({
    versions: logVersions,
    changes: logChanges,
    names: new Map([...names.entries()].map(([id, n]) => [id, n.name])),
    measuresByVersion,
    now,
  });
}
