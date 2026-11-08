import { loadUserNames } from "../../pulse/server/context";
import { buildMeasures, comparePeriods, measureMetrics, previousOnlyMetrics, WINDOWED_PROCESSES, type Measure } from "../lib/compare";
import { changeTitle } from "../lib/changes";
import type { ChangeRecord } from "../lib/changes-flow";
import { buildImprovementLog, thirtyDaysOn, type LogChange, type LogEvent, type LogVersion, type OfficeHoursChange } from "../lib/improvements-log";
import { describeOfficeHours } from "../lib/working-hours";
import { METRIC_REGISTRY } from "../lib/metrics";
import { canApproveProcess } from "./context";
import { PROCESS_NAMES, type ProcessKey } from "../lib/keys";
import type { RawMetrics } from "../lib/metrics";
import { safeParseProcessSpec, type ProcessSpec } from "../lib/spec";
import type { ProcessesContext } from "./context";
import { must, positionNameMap } from "./changes";
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
  change_summary: string | null;
}
const VER_COLS = "id, process_id, version, status, source, spec, approved_by, approved_at, created_at, rejected_at, rejected_by, rejected_reason, change_summary";
const iso = (d: Date) => d.toISOString();

/** One change of the compared version, for "What changed in vN". */
export interface CompareChange {
  id: string;
  title: string;
  status: ChangeRecord["status"];
  authorName: string | null;
  authorKind: "person" | "agent";
  createdAt: string;
}

export interface CompareResult {
  process: { key: ProcessKey; name: string };
  previous: { versionId: string; version: number; period: { from: string; to: string } } | null;
  current: { versionId: string; version: number; status: string; approvedAt: string; approvedByName: string | null; period: { from: string; to: string }; daysLive: number };
  measures: Measure[];
  /** The compared version's changes: taken ones first (in the order suggested), then not-taken. */
  changes: CompareChange[];
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

/** A version's changes with readable titles and author names. Plain query, no embed. */
async function loadVersionChanges(ctx: ProcessesContext, key: ProcessKey, versionId: string, spec: ProcessSpec | null, names: ReadonlyMap<string, { name: string }>): Promise<CompareChange[]> {
  const rows =
    (must("changes read", await ctx.db.from("process_changes").select("id, part, field, before, after, status, author_kind, author_user_id, created_at").eq("version_id", versionId).order("created_at", { ascending: true })) as unknown as
      | Array<Pick<ChangeRecord, "id" | "part" | "field" | "before" | "after" | "status" | "author_kind" | "author_user_id" | "created_at">>
      | null) ?? [];
  const nameBySlug = await positionNameMap(ctx.db);
  const out: CompareChange[] = rows.map((c) => ({
    id: c.id,
    title: changeTitle(c, spec, { processKey: key, nameBySlug }),
    status: c.status,
    authorName: c.author_kind === "agent" ? "Orca" : c.author_user_id ? (names.get(c.author_user_id)?.name ?? null) : null,
    authorKind: c.author_kind,
    createdAt: c.created_at,
  }));
  return [...out.filter((c) => c.status !== "not_taken"), ...out.filter((c) => c.status === "not_taken")];
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
    changes: await loadVersionChanges(ctx, proc.key, current.id, curSpec.ok ? curSpec.spec : null, names),
  };
  if (!prev || !curSpec.ok) return result;

  const prevSpec = safeParseProcessSpec(proc.key, prev.spec);
  const prevParsed = prevSpec.ok ? prevSpec.spec : null;
  const metrics = measureMetrics(prevParsed, curSpec.spec);
  const windowed = WINDOWED_PROCESSES.includes(proc.key);
  const [rawBefore, rawAfter] = await Promise.all([
    windowed ? fetchProcessMetrics(ctx.db, ctx.auth.tenantId, proc.key, periods.previous.from, periods.previous.to, ctx.tz) : snapshotBefore(ctx, proc.id, localDay(approved, ctx.tz)),
    fetchProcessMetrics(ctx.db, ctx.auth.tenantId, proc.key, periods.current.from, periods.current.to, ctx.tz),
  ]);
  result.measures = buildMeasures(proc.key, metrics, rawBefore, rawAfter, periods.daysLive, { previousOnly: previousOnlyMetrics(prevParsed, curSpec.spec), previousVersion: prev.version });
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

/** Saved office-hours changes from the audit trail (written by PUT /settings/office-hours), as words. */
async function loadOfficeHoursChanges(ctx: ProcessesContext, names: ReadonlyMap<string, { name: string }>): Promise<OfficeHoursChange[]> {
  const rows =
    (must("office hours audit read", await ctx.db.from("audit_logs").select("created_at, user_id, changes").eq("entity_type", "tenant_office_hours").eq("action", "office_hours.updated").order("created_at", { ascending: false }).limit(50)) as unknown as
      | Array<{ created_at: string; user_id: string | null; changes: Record<string, { old: unknown; new: unknown }> | null }>
      | null) ?? [];
  const words = (c: Record<string, { old: unknown; new: unknown }>, side: "old" | "new"): string | null => {
    const days = c.days?.[side];
    const start = c.start_min?.[side];
    const end = c.end_min?.[side];
    if (!Array.isArray(days) || typeof start !== "number" || typeof end !== "number") return null;
    return describeOfficeHours({ days: days.filter((d): d is number => typeof d === "number"), startMin: start, endMin: end });
  };
  return rows.flatMap((r) => {
    const to = r.changes ? words(r.changes, "new") : null;
    return to ? [{ at: r.created_at, actor: r.user_id ? (names.get(r.user_id)?.name ?? null) : null, from: words(r.changes!, "old"), to }] : [];
  });
}

/** Real events, newest first. `processKey` filters to one process. "30 days on" carries the measures from the compare logic. */
export async function loadImprovementLog(ctx: ProcessesContext, processKey: ProcessKey | null, now: Date = new Date(), opts: { measures?: boolean } = {}): Promise<LogEvent[]> {
  const withMeasures = opts.measures !== false;
  const procs = ((must("processes read", await ctx.db.from("processes").select("id, key, name")) as unknown as Proc[] | null) ?? []).filter((p) => !processKey || p.key === processKey);
  if (procs.length === 0) return [];
  const ids = procs.map((p) => p.id);
  const vers = (must("versions read", await ctx.db.from("process_versions").select(VER_COLS).in("process_id", ids)) as unknown as Ver[] | null) ?? [];
  const chg = (must("changes read", await ctx.db.from("process_changes").select("id, process_id, version_id, part, field, before, after, why, status, author_kind, author_user_id, created_at").in("process_id", ids)) as unknown as
    | Array<Pick<ChangeRecord, "id" | "process_id" | "version_id" | "part" | "field" | "before" | "after" | "why" | "status" | "author_kind" | "author_user_id" | "created_at">>
    | null) ?? [];
  const names = await loadUserNames(ctx.db);
  const nameBySlug = await positionNameMap(ctx.db);
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
    return {
      id: c.id,
      processKey: key,
      versionId: c.version_id,
      title: changeTitle(c, parsed.ok ? parsed.spec : null, { processKey: key, nameBySlug }),
      why: c.why,
      status: c.status,
      author_user_id: c.author_user_id,
      author_kind: c.author_kind,
      created_at: c.created_at,
    };
  });

  const measuresByVersion = new Map<string, Measure[]>();
  for (const t of withMeasures ? thirtyDaysOn(logVersions, now) : []) {
    const cur = vers.find((v) => v.id === t.id)!;
    const proc = procById.get(cur.process_id)!;
    const res = await compareVersion(ctx, proc, vers.filter((v) => v.process_id === proc.id), cur, now, names);
    measuresByVersion.set(t.id, res?.measures ?? []);
  }
  const officeHoursChanges = await loadOfficeHoursChanges(ctx, names);
  const workingClockVersions = logVersions.filter((lv) => {
    if (lv.status !== "live") return false;
    const parsed = safeParseProcessSpec(lv.processKey, specByVersion.get(lv.id));
    const fc = parsed.ok ? parsed.spec.steps.find((s) => s.key === "first_contact") : undefined;
    return !!fc && METRIC_REGISTRY[lv.processKey][fc.target.metric]?.clock === "working";
  });
  return buildImprovementLog({
    officeHoursChanges,
    workingClockVersions,
    versions: logVersions,
    changes: logChanges,
    names: new Map([...names.entries()].map(([id, n]) => [id, n.name])),
    measuresByVersion,
    now,
    skipThirtyDays: !withMeasures,
  });
}

export interface VersionListItem {
  id: string;
  version: number;
  status: LogVersion["status"];
  source: LogVersion["source"];
  createdAt: string;
  approvedAt: string | null;
  approvedByName: string | null;
  /** Who suggested its changes ("Manish", "Manish and 1 other"); null for a system baseline. */
  suggestedBy: string | null;
  changeCount: number;
  takenCount: number;
  summary: string | null;
}

export interface VersionsPage {
  process: { key: ProcessKey; name: string; ownerName: string | null; canApprove: boolean };
  versions: VersionListItem[];
  /** The open draft on top of a live version (null when none, or when the only draft is the baseline). */
  draft: { id: string; version: number; changeCount: number; suggestedBy: string | null } | null;
  /** The compared version (`?version=`, default the live one) with its before -> after; null when the process has no live version. */
  compare: CompareResult | null;
}

const joinNames = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? null) : xs.length === 2 ? `${xs[0]} and ${xs[1]}` : `${xs[0]} and ${xs.length - 1} others`);

/** Everything the Before -> after page needs, in one call. */
export async function loadVersionsPage(ctx: ProcessesContext, key: ProcessKey, versionId: string | null, now: Date = new Date()): Promise<VersionsPage | null> {
  const found = await loadProcAndVersions(ctx, key);
  if (!found) return null;
  const { proc, versions } = found;
  const names = await loadUserNames(ctx.db);
  const ownerRow = must("owner read", await ctx.db.from("processes").select("owner_user_id").eq("id", proc.id).maybeSingle()) as unknown as { owner_user_id: string | null } | null;
  const ownerId = ownerRow?.owner_user_id ?? null;
  const rows =
    (must("changes read", await ctx.db.from("process_changes").select("version_id, status, author_kind, author_user_id").eq("process_id", proc.id)) as unknown as
      | Array<{ version_id: string; status: ChangeRecord["status"]; author_kind: "person" | "agent"; author_user_id: string | null }>
      | null) ?? [];
  const nameOf = (id: string | null) => (id ? (names.get(id)?.name ?? null) : null);
  const authorsOf = (vid: string) => {
    const seen: string[] = [];
    for (const c of rows.filter((r) => r.version_id === vid)) {
      const n = c.author_kind === "agent" ? "Orca" : nameOf(c.author_user_id);
      if (n && !seen.includes(n)) seen.push(n);
    }
    return joinNames(seen);
  };
  const items: VersionListItem[] = versions
    .map((v) => ({
      id: v.id,
      version: v.version,
      status: v.status,
      source: v.source,
      createdAt: v.created_at,
      approvedAt: v.approved_at,
      approvedByName: nameOf(v.approved_by),
      suggestedBy: authorsOf(v.id),
      changeCount: rows.filter((r) => r.version_id === v.id).length,
      takenCount: rows.filter((r) => r.version_id === v.id && r.status === "taken").length,
      summary: v.change_summary,
    }))
    .sort((a, b) => a.version - b.version);
  const open = items.find((v) => v.status === "draft");
  const draft = open && proc.live_version_id ? { id: open.id, version: open.version, changeCount: open.changeCount, suggestedBy: open.suggestedBy } : null;

  const current = versionId ? versions.find((v) => v.id === versionId) : versions.find((v) => v.id === proc.live_version_id);
  const compare = current && current.approved_at ? await compareVersion(ctx, proc, versions, current, now, names) : null;
  return { process: { key, name: proc.name || PROCESS_NAMES[key], ownerName: nameOf(ownerId), canApprove: canApproveProcess(ctx.auth, ownerId) }, versions: items, draft, compare };
}
