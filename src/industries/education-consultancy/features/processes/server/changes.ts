import { createAuditLog } from "@/lib/api/audit";
import { logger } from "@/lib/logger";
import { loadUserNames } from "../../pulse/server/context";
import { describeDrives, describeValue, changeTitle } from "../lib/changes";
import { editChange, rejectDraft, suggestChange, type ChangeRecord, type EditStore, type ProcessRef, type RejectStore, type SuggestStore } from "../lib/changes-flow";
import { readOrcaMeta, type DraftSource, type OrcaDraftMeta } from "../lib/improver/screens";
import { isProcessKey, PROCESS_NAMES, type ProcessKey } from "../lib/keys";
import { safeParseProcessSpec } from "../lib/spec";
import { canApproveProcess, type ProcessesContext, type ProcessesDb } from "./context";

/**
 * P2 stores + actions over the scoped client. `process_changes` points at both `processes` and `process_versions`, and those two
 * already have two FKs between them, so NOTHING here embeds: every read is a plain single-table query (the PGRST201 lesson).
 */

export const CHANGE_COLS = "id, process_id, version_id, part, field, before, after, why, evidence, author_kind, author_user_id, needs, turns_on, status, taken, edited_by, edited_at, created_at";

export function must<T>(op: string, res: { data: T | null; error: { message: string; code?: string } | null }): T | null {
  if (res.error) {
    logger.error({ err: res.error, op, route: "processes/changes" }, "Processes store call failed");
    throw new Error(`${op}: ${res.error.message}`);
  }
  return res.data;
}

export const positionSlugSet = async (db: ProcessesDb): Promise<ReadonlySet<string>> => {
  const rows = must("positions read", await db.from("positions").select("slug")) as unknown as Array<{ slug: string }> | null;
  return new Set((rows ?? []).map((r) => r.slug));
};

export const positionNameMap = async (db: ProcessesDb): Promise<ReadonlyMap<string, string>> => {
  const rows = must("positions read", await db.from("positions").select("slug, name")) as unknown as Array<{ slug: string; name: string }> | null;
  return new Map((rows ?? []).map((r) => [r.slug, r.name]));
};

export const getVersionSpec = async (db: ProcessesDb, versionId: string): Promise<unknown | null> => {
  const row = must("process_versions spec read", await db.from("process_versions").select("spec").eq("id", versionId).maybeSingle()) as unknown as { spec: unknown } | null;
  return row?.spec ?? null;
};

export function dbSuggestStore(db: ProcessesDb): SuggestStore {
  return {
    async getProcess(key) {
      return must("processes read", await db.from("processes").select("id, owner_user_id, live_version_id").eq("key", key).maybeSingle()) as unknown as ProcessRef | null;
    },
    getSpec: (versionId) => getVersionSpec(db, versionId),
    async getOpenDraft(processId) {
      return must("draft read", await db.from("process_versions").select("id, version, status").eq("process_id", processId).eq("status", "draft").maybeSingle()) as unknown as { id: string; version: number; status: string } | null;
    },
    async maxVersion(processId) {
      const rows = must("version max read", await db.from("process_versions").select("version").eq("process_id", processId).order("version", { ascending: false }).limit(1)) as unknown as Array<{ version: number }> | null;
      return rows?.[0]?.version ?? 0;
    },
    async createDraft(row) {
      const res = await db.from("process_versions").insert({ source: "person", ...row, status: "draft" }).select("id, version, status").single();
      if (res.error?.code === "23505") return null; // uniq_process_versions_one_draft: a concurrent suggestion opened it first
      return must("draft insert", res) as unknown as { id: string; version: number; status: string };
    },
    async insertChange(row) {
      return must("change insert", await db.from("process_changes").insert(row).select(CHANGE_COLS).single()) as unknown as ChangeRecord;
    },
    positionSlugs: () => positionSlugSet(db),
  };
}

export function dbEditStore(db: ProcessesDb): EditStore {
  return {
    async getChange(changeId) {
      const change = must("change read", await db.from("process_changes").select(CHANGE_COLS).eq("id", changeId).maybeSingle()) as unknown as ChangeRecord | null;
      if (!change) return null;
      const ver = must("version read", await db.from("process_versions").select("status").eq("id", change.version_id).maybeSingle()) as unknown as { status: string } | null;
      const proc = must("process read", await db.from("processes").select("key, owner_user_id, live_version_id").eq("id", change.process_id).maybeSingle()) as unknown as
        | { key: ProcessKey; owner_user_id: string | null; live_version_id: string | null }
        | null;
      if (!ver || !proc) return null;
      return { change, versionStatus: ver.status, processKey: proc.key, ownerUserId: proc.owner_user_id, liveVersionId: proc.live_version_id };
    },
    getSpec: (versionId) => getVersionSpec(db, versionId),
    positionSlugs: () => positionSlugSet(db),
    async updateChange(changeId, patch) {
      return must("change update", await db.from("process_changes").update(patch).eq("id", changeId).select(CHANGE_COLS).maybeSingle()) as unknown as ChangeRecord | null;
    },
  };
}

export function dbRejectStore(db: ProcessesDb): RejectStore {
  return {
    async getVersion(processKey, versionId) {
      // Two plain queries, no embed.
      const v = must("version read", await db.from("process_versions").select("id, process_id, status").eq("id", versionId).maybeSingle()) as unknown as { id: string; process_id: string; status: string } | null;
      if (!v) return null;
      const p = must("process read", await db.from("processes").select("key, owner_user_id").eq("id", v.process_id).maybeSingle()) as unknown as { key: string; owner_user_id: string | null } | null;
      return p && p.key === processKey ? { id: v.id, process_id: v.process_id, status: v.status, owner_user_id: p.owner_user_id } : null;
    },
    async changeSummary(processKey, versionId) {
      const rows = must("changes read", await db.from("process_changes").select("part, field, before, after").eq("version_id", versionId).order("created_at", { ascending: true })) as unknown as
        | Array<Pick<ChangeRecord, "part" | "field" | "before" | "after">>
        | null;
      if (!rows || rows.length === 0) return null;
      const parsed = safeParseProcessSpec(processKey as ProcessKey, await getVersionSpec(db, versionId));
      const nameBySlug = await positionNameMap(db);
      return rows.map((c) => changeTitle(c, parsed.ok ? parsed.spec : null, { processKey: isProcessKey(processKey) ? processKey : undefined, nameBySlug })).join("; ");
    },
    async setRejected(versionId, by) {
      const res = await db
        .from("process_versions")
        .update({ status: "rejected", rejected_reason: by.reason, rejected_by: by.userId, rejected_at: by.at, ...(by.summary ? { change_summary: by.summary } : {}) })
        .eq("id", versionId)
        .eq("status", "draft")
        .select("id");
      if (res.error) throw new Error(`draft reject: ${res.error.message}`);
      return ((res.data as unknown[] | null)?.length ?? 0) > 0;
    },
    async closeChanges(versionId) {
      const { error } = await db.from("process_changes").update({ status: "not_taken" }).eq("version_id", versionId).eq("status", "open");
      if (error) throw new Error(`changes close: ${error.message}`);
    },
  };
}

export const suggestChangeAction = async (ctx: ProcessesContext, key: ProcessKey, input: unknown) => {
  const out = await suggestChange(dbSuggestStore(ctx.db), { processKey: key, userId: ctx.auth.userId, input });
  if (out.kind === "ok") {
    await createAuditLog({
      tenantId: ctx.auth.tenantId,
      userId: ctx.auth.userId,
      action: "process.change_suggested",
      entityType: "process",
      entityId: out.change.process_id,
      changes: { change: { old: null, new: out.change.id }, draft: { old: null, new: out.draft.id } },
    });
  }
  return out;
};

export const editChangeAction = async (ctx: ProcessesContext, key: ProcessKey, changeId: string, patch: { after?: unknown; taken?: boolean }) => {
  const out = await editChange(dbEditStore(ctx.db), {
    processKey: key,
    changeId,
    userId: ctx.auth.userId,
    canApprove: (owner) => canApproveProcess(ctx.auth, owner),
    patch,
    now: new Date(),
  });
  if (out.kind === "ok" && (out.edited || out.toggled)) {
    await createAuditLog({
      tenantId: ctx.auth.tenantId,
      userId: ctx.auth.userId,
      action: out.edited ? "process.change_edited" : "process.change_toggled",
      entityType: "process_change",
      entityId: out.change.id,
      changes: { ...(out.edited ? { after: { old: null, new: out.change.after } } : {}), taken: { old: !out.change.taken, new: out.change.taken } },
    });
  }
  return out;
};

export const rejectDraftAction = async (ctx: ProcessesContext, key: string, versionId: string, reason: unknown) => {
  const out = await rejectDraft(dbRejectStore(ctx.db), {
    processKey: key,
    versionId,
    userId: ctx.auth.userId,
    canApprove: (owner) => canApproveProcess(ctx.auth, owner),
    reason,
    now: new Date(),
  });
  if (out.kind === "ok") {
    await createAuditLog({
      tenantId: ctx.auth.tenantId,
      userId: ctx.auth.userId,
      action: "process.draft_rejected",
      entityType: "process_version",
      entityId: versionId,
      changes: { status: { old: "draft", new: "rejected" }, reason: { old: null, new: String(reason).trim() } },
    });
  }
  return out;
};

export interface ChangeView {
  id: string;
  part: string;
  field: ChangeRecord["field"];
  /** Readable title from `changeTitle()` ("First contact: count in working hours"). */
  title: string;
  /** The step the change is on (null for trigger / done / exceptions). */
  stepKey: string | null;
  before: unknown;
  after: unknown;
  /** Both values in words, for the v1 now / proposed boxes. */
  beforeText: string;
  afterText: string;
  why: string;
  evidence: ChangeRecord["evidence"];
  authorKind: "person" | "agent";
  authorUserId: string | null;
  authorName: string | null;
  status: ChangeRecord["status"];
  taken: boolean;
  editedByName: string | null;
  editedAt: string | null;
  createdAt: string;
  /** "Changes in EdgeX" line. */
  drives: string;
  /** Orca's badges (migration 289/290): a feature that is not built yet, and the Settings switch to flip after approving. */
  needs: string | null;
  turnsOn: string | null;
}

export interface DraftAuthor {
  userId: string | null;
  kind: "person" | "agent";
  name: string | null;
}

export interface DraftView {
  process: { key: ProcessKey; name: string; processId: string; ownerUserId: string | null; ownerName: string | null; canApprove: boolean };
  /** The viewer's own name, for "Approved by Manish". */
  viewerName: string | null;
  /** For the who editor. */
  positions: Array<{ slug: string; name: string }>;
  /** Step key -> its title, for "Not changed: Call-backs: ..." lines. */
  stepTitles?: Record<string, string>;
  live: { id: string; version: number; approvedAt: string | null } | null;
  draft: null | {
    id: string;
    version: number;
    createdAt: string;
    /** True while the process has no live version: this is the baseline draft and cannot hold changes. */
    isBaseline: boolean;
    /** Who wrote the draft. `agent` = Orca: the screens say "Proposed by Orca" and show each change's Why with its evidence. */
    source: DraftSource;
    /** The banner line Orca wrote (`change_summary`) and its run metadata (new leads counted, red steps it left alone and why). Null for a person's draft. */
    summary: string | null;
    orca: OrcaDraftMeta | null;
    authors: DraftAuthor[];
    changes: ChangeView[];
  };
}

/** The open draft and its changes (with author names and each change's drives line). Plain queries, no embeds. */
export async function loadDraft(ctx: ProcessesContext, key: ProcessKey): Promise<DraftView | null> {
  const { db, auth } = ctx;
  const proc = must("processes read", await db.from("processes").select("id, key, name, owner_user_id, live_version_id").eq("key", key).maybeSingle()) as unknown as
    | { id: string; key: ProcessKey; name: string; owner_user_id: string | null; live_version_id: string | null }
    | null;
  if (!proc) return null;
  const base: DraftView = {
    process: { key, name: proc.name || PROCESS_NAMES[key], processId: proc.id, ownerUserId: proc.owner_user_id, ownerName: null, canApprove: canApproveProcess(auth, proc.owner_user_id) },
    viewerName: null,
    positions: [],
    live: null,
    draft: null,
  };
  const draft = must("draft read", await db.from("process_versions").select("id, version, created_at, spec, source, change_summary, evidence").eq("process_id", proc.id).eq("status", "draft").maybeSingle()) as unknown as
    | { id: string; version: number; created_at: string; spec: unknown; source: DraftSource; change_summary: string | null; evidence: unknown }
    | null;
  let liveSpec: unknown = null;
  if (proc.live_version_id) {
    const live = must("live read", await db.from("process_versions").select("id, version, approved_at, spec").eq("id", proc.live_version_id).maybeSingle()) as unknown as
      | { id: string; version: number; approved_at: string | null; spec: unknown }
      | null;
    if (live) {
      base.live = { id: live.id, version: live.version, approvedAt: live.approved_at };
      liveSpec = live.spec;
    }
  }
  const names = await loadUserNames(db);
  const nameOf = (id: string | null) => (id ? (names.get(id)?.name ?? null) : null);
  base.process.ownerName = nameOf(proc.owner_user_id);
  base.viewerName = nameOf(auth.userId);
  const positions = (must("positions read", await db.from("positions").select("slug, name")) as unknown as Array<{ slug: string; name: string }> | null) ?? [];
  base.positions = positions;
  if (!draft) return base;

  const rows = (must("changes read", await db.from("process_changes").select(CHANGE_COLS).eq("version_id", draft.id).order("created_at", { ascending: true })) as unknown as ChangeRecord[] | null) ?? [];
  const parsed = safeParseProcessSpec(key, liveSpec ?? draft.spec);
  const spec = parsed.ok ? parsed.spec : null;
  const nameBySlug = new Map(positions.map((p) => [p.slug, p.name]));
  if (spec) base.stepTitles = Object.fromEntries(spec.steps.map((st) => [st.key, st.title]));

  const changes: ChangeView[] = rows.map((c) => {
    const stepKey = c.part.startsWith("step:") ? c.part.slice(5) : null;
    const step = spec?.steps.find((s) => s.key === stepKey);
    return {
      id: c.id,
      part: c.part,
      field: c.field,
      title: changeTitle(c, spec, { processKey: key, nameBySlug }),
      stepKey,
      before: c.before,
      after: c.after,
      beforeText: describeValue(key, spec, c.part, c.field, c.before, undefined, nameBySlug),
      afterText: describeValue(key, spec, c.part, c.field, c.after, c.before, nameBySlug),
      why: c.why,
      evidence: c.evidence,
      authorKind: c.author_kind,
      authorUserId: c.author_user_id,
      authorName: c.author_kind === "agent" ? "Orca" : nameOf(c.author_user_id),
      status: c.status,
      taken: c.taken,
      editedByName: nameOf(c.edited_by),
      editedAt: c.edited_at,
      createdAt: c.created_at,
      drives: describeDrives(c, step, nameBySlug),
      needs: c.needs ?? null,
      turnsOn: c.turns_on ?? null,
    };
  });
  const seen = new Set<string>();
  const authors: DraftAuthor[] = [];
  for (const c of changes) {
    const id = c.authorKind === "agent" ? "agent" : (c.authorUserId ?? "unknown");
    if (seen.has(id)) continue;
    seen.add(id);
    authors.push({ userId: c.authorUserId, kind: c.authorKind, name: c.authorName });
  }
  base.draft = { id: draft.id, version: draft.version, createdAt: draft.created_at, isBaseline: !proc.live_version_id, source: draft.source, summary: draft.source === "agent" ? draft.change_summary : null, orca: draft.source === "agent" ? readOrcaMeta(draft.evidence) : null, authors, changes };
  return base;
}
