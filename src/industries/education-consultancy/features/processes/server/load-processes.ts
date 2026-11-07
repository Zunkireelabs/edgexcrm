import { scopedClientForTenant } from "@/lib/supabase/scoped";
import { loadUserNames } from "../../pulse/server/context";
import { loadAssignmentSettings } from "../../home/server/assignment/settings";
import type { AssignmentMode } from "../../home/lib/assignment/outcome";
import { DEFAULT_WINDOW_DAYS, HEADLINE_METRIC, HEADLINE_STYLE, type HeadlineStyle, PROCESS_KEYS, PROCESS_NAMES, TRIGGER_METRIC, WINDOW_DAYS, isProcessKey, type ProcessKey } from "../lib/keys";
import { fmtValue } from "../lib/format";
import { liveRules, pluralizeRole, resolvePositionName, stepOwners, type RuleRow } from "../lib/view";
import { METRIC_REGISTRY, fmtN, formatMinutes, readMetric, stepStatus, type MetricUnit, type RawMetrics, type StepStatus } from "../lib/metrics";
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
  /** "x of y" behind a percent value, when the registry has one. */
  fraction: { n: number; d: number } | null;
  /** Who does this step, in words (position names; the assign step says "by hand" while smart assignment is off). */
  owners: string;
  /** "done" = the map's last card, labelled DONE WHEN. */
  kind: "step" | "done";
  /** The card's big number and the small text after it, already formatted (separators, "22 of 131", "median wait"). */
  big: string;
  small: string;
  /** The target in words ("within 5 minutes"). */
  targetWords: string | null;
  /** Caveat for a tooltip, kept off the card. */
  note: string | null;
  status: StepStatus;
}

export interface ProcessView {
  key: ProcessKey;
  name: string;
  processId: string;
  ownerUserId: string | null;
  ownerName: string | null;
  reviewDueAt: string | null;
  createdAt: string;
  /** The version being shown: the live one, else the newest draft. */
  shown: { id: string; version: number; status: VersionRow["status"]; source: VersionRow["source"]; approvedAt: string | null; changeSummary: string | null } | null;
  /** The step whose metric is this process's HEADLINE_METRIC (else the first step with a value): the row on the list page. */
  headline: StepView | null;
  headlineStyle: HeadlineStyle;
  /** The label under the headline number ("students with a visa moved to Enrolled"). */
  headlineLabel: string;
  /** One short sentence under the title (spec.summary, else purpose). */
  summary: string | null;
  /** The map's Trigger card number, where the process has one. */
  trigger: { value: number | null; detail: string } | null;
  /** What it drives, short (spec.drivesSummary, else the union of the steps' drives). */
  drivesSummary: string;
  /** Union of the position names that own the steps, plural ("Managers, Counselors"). */
  stepOwners: string[];
  /** Union of what the steps drive. */
  drives: string[];
  /** Rules EdgeX really runs today (new-lead process only). */
  rules: RuleRow[] | null;
  steps: StepView[];
  spec: ProcessSpec | null;
  specError: string | null;
  canApprove: boolean;
  /** An open draft sitting on top of a live version (decision 3: at most one). Null for a baseline draft (that one is `shown`). */
  draft: { id: string; version: number; changeCount: number } | null;
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
const uniqueOf = (xs: string[]) => [...new Set(xs)];
const VER_COLS = "id, process_id, version, status, spec, source, proposed_by, change_summary, approved_by, approved_at, created_at";

/** Live version, else the newest non-rejected one. */
export function pickShownVersion(versions: VersionRow[]): VersionRow | null {
  const live = versions.find((v) => v.status === "live");
  if (live) return live;
  return [...versions].filter((v) => v.status === "draft").sort((a, b) => b.version - a.version)[0] ?? null;
}

const NO_NAMES: ReadonlyMap<string, string> = new Map();

export function pickHeadline(key: ProcessKey, steps: StepView[]): StepView | null {
  return steps.find((s) => s.target.metric === HEADLINE_METRIC[key]) ?? steps.find((s) => s.value !== null) ?? steps[0] ?? null;
}

/** The list row's label under the headline number. Registry text, never lower-cased by code. */
export function headlineLabel(key: ProcessKey, steps: StepView[], raw: RawMetrics | null): string {
  const h = pickHeadline(key, steps);
  if (!h) return "";
  const def = METRIC_REGISTRY[key][h.target.metric];
  return def?.listLabel && raw ? def.listLabel(raw) : h.metricLabel;
}

export function buildTrigger(key: ProcessKey, raw: RawMetrics | null): { value: number | null; detail: string } | null {
  const metric = TRIGGER_METRIC[key];
  const m = metric && raw ? readMetric(key, metric, raw) : null;
  return m ? { value: m.value, detail: m.detail } : null;
}

export function buildStepViews(key: ProcessKey, spec: ProcessSpec, raw: RawMetrics | null, nameBySlug: ReadonlyMap<string, string> = NO_NAMES, mode: AssignmentMode = "off"): StepView[] {
  return spec.steps.map((s) => {
    const m = raw ? readMetric(key, s.target.metric, raw) : null;
    const value = m?.value ?? null;
    const def = METRIC_REGISTRY[key][s.target.metric];
    const shown = s.show && raw ? readMetric(key, s.show.metric, raw) : null;
    const showDef = s.show ? METRIC_REGISTRY[key][s.show.metric] : undefined;
    const big = shown ? (shown.unit === "min" ? formatMinutes(shown.value) : shown.value === null ? "No data" : fmtN(shown.value)) : fmtValue(value, s.target.unit);
    const small = shown
      ? (showDef?.shortLabel ?? shown.label.toLowerCase())
      : s.target.unit === "percent"
        ? m?.fraction
          ? `${fmtN(m.fraction.n)} of ${fmtN(m.fraction.d)}${def?.fractionNoun ? ` ${def.fractionNoun}` : ""}`
          : ""
        : (def?.shortLabel ?? "");
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
      fraction: m?.fraction ?? null,
      owners: stepOwners(s.key, s.who, nameBySlug, mode),
      kind: s.kind ?? "step",
      big,
      small,
      targetWords: s.targetText ?? null,
      note: def?.note ?? null,
      status: stepStatus(value, s.target.op, s.target.value),
    };
  });
}

export async function loadProcessViews(ctx: ProcessesContext, windowDays: number, only?: ProcessKey): Promise<ProcessView[]> {
  const { db, auth, tz } = ctx;
  const { data: procs, error: procErr } = await db.from("processes").select(PROC_COLS);
  if (procErr) throw new Error(`processes read: ${procErr.message}`);
  const rows = ((procs ?? []) as unknown as ProcessRow[]).filter((p) => !only || p.key === only);
  if (rows.length === 0) return [];
  const { data: vers, error: verErr } = await db.from("process_versions").select(VER_COLS).in("process_id", rows.map((r) => r.id));
  if (verErr) throw new Error(`process_versions read: ${verErr.message}`);
  const versions = (vers ?? []) as unknown as VersionRow[];
  const names = await loadUserNames(db);
  // How many changes each open draft holds: one plain query (process_changes is never embedded).
  const draftIds = versions.filter((v) => v.status === "draft").map((v) => v.id);
  const countByDraft = new Map<string, number>();
  if (draftIds.length) {
    const { data: chg, error: chgErr } = await db.from("process_changes").select("version_id").in("version_id", draftIds);
    if (chgErr) throw new Error(`process_changes count: ${chgErr.message}`);
    for (const c of (chg ?? []) as unknown as Array<{ version_id: string }>) countByDraft.set(c.version_id, (countByDraft.get(c.version_id) ?? 0) + 1);
  }
  const [{ data: posRows }, settings] = await Promise.all([db.from("positions").select("slug, name"), loadAssignmentSettings(db)]);
  const nameBySlug = new Map(((posRows ?? []) as unknown as Array<{ slug: string; name: string }>).map((r) => [r.slug, r.name]));
  const to = new Date();
  const from = new Date(to.getTime() - windowDays * 86_400_000);

  const out: ProcessView[] = await Promise.all(
    rows.map(async (p) => {
      const shownVer = pickShownVersion(versions.filter((v) => v.process_id === p.id));
      const raw = await fetchProcessMetrics(db, auth.tenantId, p.key, from, to, tz);
      const parsed = shownVer ? safeParseProcessSpec(p.key, shownVer.spec) : null;
      const spec = parsed?.ok ? parsed.spec : null;
      const steps = spec ? buildStepViews(p.key, spec, raw, nameBySlug, settings.mode) : [];
      return {
        key: p.key,
        name: p.name || PROCESS_NAMES[p.key],
        processId: p.id,
        ownerUserId: p.owner_user_id,
        ownerName: p.owner_user_id ? (names.get(p.owner_user_id)?.name ?? null) : null,
        reviewDueAt: p.review_due_at,
        createdAt: p.created_at,
        shown: shownVer
          ? { id: shownVer.id, version: shownVer.version, status: shownVer.status, source: shownVer.source, approvedAt: shownVer.approved_at, changeSummary: shownVer.change_summary }
          : null,
        headline: pickHeadline(p.key, steps),
        headlineStyle: HEADLINE_STYLE[p.key],
        headlineLabel: headlineLabel(p.key, steps, raw),
        summary: spec ? (spec.summary ?? spec.purpose) : null,
        trigger: buildTrigger(p.key, raw),
        drivesSummary: spec?.drivesSummary ?? uniqueOf(steps.flatMap((s) => s.drives)).join(", "),
        stepOwners: uniqueOf(spec ? spec.steps.flatMap((s) => s.who.map((w) => pluralizeRole(resolvePositionName(w, nameBySlug)))) : []),
        drives: uniqueOf(steps.flatMap((s) => s.drives)),
        rules: liveRules(p.key, settings.mode),
        steps,
        spec,
        specError: parsed && !parsed.ok ? parsed.error : null,
        canApprove: canApproveProcess(auth, p.owner_user_id),
        draft: (() => {
          const open = versions.find((v) => v.process_id === p.id && v.status === "draft");
          return open && p.live_version_id ? { id: open.id, version: open.version, changeCount: countByDraft.get(open.id) ?? 0 } : null;
        })(),
      };
    }),
  );
  return out.sort((a, b) => PROCESS_KEYS.indexOf(a.key) - PROCESS_KEYS.indexOf(b.key));
}

export async function loadProcessVersions(db: Db, processId: string): Promise<Array<Omit<VersionRow, "spec" | "process_id">>> {
  const { data, error } = await db.from("process_versions").select(VER_COLS).eq("process_id", processId).order("version", { ascending: false });
  if (error) throw new Error(`process_versions list: ${error.message}`);
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
