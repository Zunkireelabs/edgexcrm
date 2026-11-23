import type { AuthContext } from "@/lib/api/auth";
import { stepReads, needsImprovement, type StepRead } from "../../lib/improver/breakdown";
import { FactStore } from "../../lib/improver/facts";
import { improverWindow, type ImproverWindow } from "../../lib/improver/links";
import { isProcessKey, PROCESS_NAMES, type ProcessKey } from "../../lib/keys";
import type { RawMetrics } from "../../lib/metrics";
import { safeParseProcessSpec, type ProcessSpec } from "../../lib/spec";
import { must } from "../changes";
import type { ProcessesContext, ProcessesDb } from "../context";
import { fetchProcessMetrics } from "../load-processes";

/**
 * Everything one improver run needs about its ONE process, loaded once and shared by the run's tools. The process comes from the run's
 * trigger subject (never from model input) and is read through the scoped client, so another tenant's process id finds nothing.
 */

export interface ImproverProcess {
  id: string;
  key: ProcessKey;
  name: string;
  liveVersionId: string | null;
}

export interface LiveVersion {
  id: string;
  version: number;
  approvedAt: string | null;
  spec: ProcessSpec;
}

export interface ImproverContext {
  tenantId: string;
  tz: string;
  now: Date;
  window: ImproverWindow;
  process: ImproverProcess;
  live: LiveVersion | null;
  rawNow: RawMetrics | null;
  steps: StepRead[];
  onTarget: boolean;
  listIds: string[];
  intakeListIds: string[];
  positions: Array<{ slug: string; name: string }>;
  facts: FactStore;
}

export async function loadImproverContext(db: ProcessesDb, tenantId: string, processId: string, now: Date): Promise<ImproverContext | null> {
  const proc = must("process read", await db.from("processes").select("id, key, name, live_version_id").eq("id", processId).maybeSingle()) as unknown as
    | { id: string; key: string; name: string; live_version_id: string | null }
    | null;
  if (!proc || !isProcessKey(proc.key)) return null;

  const { data: t } = await db.fromGlobal("tenants").select("timezone").eq("id", tenantId).maybeSingle();
  const tz = (t as unknown as { timezone: string | null } | null)?.timezone ?? "Asia/Kathmandu";
  const window = improverWindow(now, tz);

  let live: LiveVersion | null = null;
  if (proc.live_version_id) {
    const v = must("live version read", await db.from("process_versions").select("id, version, approved_at, spec").eq("id", proc.live_version_id).maybeSingle()) as unknown as
      | { id: string; version: number; approved_at: string | null; spec: unknown }
      | null;
    const parsed = v ? safeParseProcessSpec(proc.key, v.spec) : null;
    if (v && parsed?.ok) live = { id: v.id, version: v.version, approvedAt: v.approved_at, spec: parsed.spec };
  }

  const [lists, positions, rawNow] = await Promise.all([
    db.from("lead_lists").select("id, is_intake, is_archive"),
    db.from("positions").select("slug, name"),
    fetchProcessMetrics(db, tenantId, proc.key, window.from, window.to, tz),
  ]);
  const listRows = ((lists.data ?? []) as unknown as Array<{ id: string; is_intake: boolean | null; is_archive: boolean }>);
  const listIds = listRows.map((l) => l.id);
  const intakeListIds = listRows.filter((l) => l.is_intake && !l.is_archive).map((l) => l.id);

  const steps = live && rawNow ? stepReads(proc.key, live.spec, rawNow, window, listIds) : [];
  return {
    tenantId,
    tz,
    now,
    window,
    process: { id: proc.id, key: proc.key, name: proc.name || PROCESS_NAMES[proc.key], liveVersionId: proc.live_version_id },
    live,
    rawNow,
    steps,
    onTarget: !!live && !!rawNow && !needsImprovement(steps),
    listIds,
    intakeListIds,
    positions: ((positions.data ?? []) as unknown as Array<{ slug: string; name: string }>),
    facts: new FactStore(),
  };
}

/** The minimal ProcessesContext the compare reader needs (it only uses the db, the tenant id and the timezone). */
export const compareContext = (db: ProcessesDb, c: Pick<ImproverContext, "tenantId" | "tz">): ProcessesContext => ({
  auth: { tenantId: c.tenantId } as unknown as AuthContext,
  db,
  tz: c.tz,
  tenantName: "",
});
