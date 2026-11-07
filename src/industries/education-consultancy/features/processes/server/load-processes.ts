import { scopedClientForTenant } from "@/lib/supabase/scoped";
import { loadUserNames } from "../../pulse/server/context";
import { DEFAULT_WINDOW_DAYS, PROCESS_KEYS, PROCESS_NAMES, WINDOW_DAYS, isProcessKey, type ProcessKey } from "../lib/keys";
import { readMetric, stepStatus, type MetricUnit, type RawMetrics, type StepStatus } from "../lib/metrics";
import { safeParseProcessSpec, type ProcessSpec } from "../lib/spec";
import type { ProcessRow } from "../lib/store";
import { canApproveProcess, type ProcessesContext } from "./context";

type Db = Awaited<ReturnType<typeof scopedClientForTenant>>;

export interface VersionRow {
  id: string;
  process_id: string;
  version: number;
  status: "draft" | "live" | "retired" | "rejected";
  spec: unknown;
  source: "system" | "person" | "agent";
  proposed_by: string | null;
  change_summary: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

export interface StepView {
  key: string;
  title: string;
  who: string[];
  text: string;
  drives: string[];
  target: { metric: string; op: "<=" | ">="; value: number; unit: MetricUnit };
  metricLabel: string;
  value: number | null;
  detail: string;
  status: StepStatus;
}

export interface ProcessView {
  key: ProcessKey;
  name: string;
  processId: string;
  ownerUserId: string | null;
  ownerName: string | null;
  reviewDueAt: string | null;
  /** The version being shown: the live one, else the newest draft. */
  shown: { id: string; version: number; status: VersionRow["status"]; source: VersionRow["source"]; approvedAt: string | null; changeSummary: string | null } | null;
  /** The first step's headline number against its target: the card on the list page. */
  headline: StepView | null;
  steps: StepView[];
  spec: ProcessSpec | null;
  specError: string | null;
  canApprove: boolean;
}

export const parseWindowDays = (raw: string | null): number => {
  const n = Number(raw);
  return (WINDOW_DAYS as readonly number[]).includes(n) ? n : DEFAULT_WINDOW_DAYS;
};

/** One call into the metrics SQL (migration 286). Returns null on a SQL error so one bad process never blanks the page. */
export async function fetchProcessMetrics(db: Db, tenantId: string, key: ProcessKey, from: Date, to: Date, tz: string): Promise<RawMetrics | null> {
  const { data, error } = await db.raw().rpc("education_process_metrics", { p_tenant: tenantId, p_key: key, p_from: from.toISOString(), p_to: to.toISOString(), p_tz: tz });
  return error || !data ? null : (data as unknown as RawMetrics);
}

const PROC_COLS = "id, key, name, owner_user_id, live_version_id, review_due_at, created_at";
const VER_COLS = "id, process_id, version, status, spec, source, proposed_by, change_summary, approved_by, approved_at, created_at";

/** Live version, else the newest non-rejected one. */
export function pickShownVersion(versions: VersionRow[]): VersionRow | null {
  const live = versions.find((v) => v.status === "live");
  if (live) return live;
  return [...versions].filter((v) => v.status === "draft").sort((a, b) => b.version - a.version)[0] ?? null;
}

export function buildStepViews(key: ProcessKey, spec: ProcessSpec, raw: RawMetrics | null): StepView[] {
  return spec.steps.map((s) => {
    const m = raw ? readMetric(key, s.target.metric, raw) : null;
    const value = m?.value ?? null;
    return {
      key: s.key,
      title: s.title,
      who: s.who,
      text: s.text,
      drives: s.drives,
      target: s.target,
      metricLabel: m?.label ?? s.target.metric,
      value,
      detail: m?.detail ?? "",
      status: stepStatus(value, s.target.op, s.target.value),
    };
  });
}

export async function loadProcessViews(ctx: ProcessesContext, windowDays: number, only?: ProcessKey): Promise<ProcessView[]> {
  const { db, auth, tz } = ctx;
  const { data: procs } = await db.from("processes").select(PROC_COLS);
  const rows = ((procs ?? []) as unknown as ProcessRow[]).filter((p) => !only || p.key === only);
  if (rows.length === 0) return [];
  const { data: vers } = await db.from("process_versions").select(VER_COLS).in("process_id", rows.map((r) => r.id));
  const versions = (vers ?? []) as unknown as VersionRow[];
  const names = await loadUserNames(db);
  const to = new Date();
  const from = new Date(to.getTime() - windowDays * 86_400_000);

  const out: ProcessView[] = await Promise.all(
    rows.map(async (p) => {
      const shownVer = pickShownVersion(versions.filter((v) => v.process_id === p.id));
      const raw = await fetchProcessMetrics(db, auth.tenantId, p.key, from, to, tz);
      const parsed = shownVer ? safeParseProcessSpec(p.key, shownVer.spec) : null;
      const spec = parsed?.ok ? parsed.spec : null;
      const steps = spec ? buildStepViews(p.key, spec, raw) : [];
      return {
        key: p.key,
        name: p.name || PROCESS_NAMES[p.key],
        processId: p.id,
        ownerUserId: p.owner_user_id,
        ownerName: p.owner_user_id ? (names.get(p.owner_user_id)?.name ?? null) : null,
        reviewDueAt: p.review_due_at,
        shown: shownVer
          ? { id: shownVer.id, version: shownVer.version, status: shownVer.status, source: shownVer.source, approvedAt: shownVer.approved_at, changeSummary: shownVer.change_summary }
          : null,
        headline: steps[0] ? (steps.find((s) => s.value !== null) ?? steps[0]) : null,
        steps,
        spec,
        specError: parsed && !parsed.ok ? parsed.error : null,
        canApprove: canApproveProcess(auth, p.owner_user_id),
      };
    }),
  );
  return out.sort((a, b) => PROCESS_KEYS.indexOf(a.key) - PROCESS_KEYS.indexOf(b.key));
}

export async function loadProcessVersions(db: Db, processId: string): Promise<Array<Omit<VersionRow, "spec" | "process_id">>> {
  const { data } = await db.from("process_versions").select(VER_COLS).eq("process_id", processId).order("version", { ascending: false });
  return ((data ?? []) as unknown as VersionRow[]).map((v) => ({
    id: v.id,
    version: v.version,
    status: v.status,
    source: v.source,
    proposed_by: v.proposed_by,
    change_summary: v.change_summary,
    approved_by: v.approved_by,
    approved_at: v.approved_at,
    created_at: v.created_at,
  }));
}

export { isProcessKey };
