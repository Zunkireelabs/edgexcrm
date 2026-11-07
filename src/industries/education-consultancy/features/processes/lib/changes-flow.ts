import { applyChanges, changeInputSchema, currentValue, type ChangeField, type Evidence } from "./changes";
import type { ProcessKey } from "./keys";
import { safeParseProcessSpec } from "./spec";

/**
 * Suggest / edit / reject, as pure flows over a small store (the server wires it to the scoped client; tests wire it to memory).
 * Who may do what is decided by the caller: suggest = anyone the route gate lets in (owner/admin); edit and reject = `canApprove`.
 */

export interface ChangeRecord {
  id: string;
  process_id: string;
  version_id: string;
  part: string;
  field: ChangeField;
  before: unknown;
  after: unknown;
  why: string;
  evidence: Evidence[];
  author_kind: "person" | "agent";
  author_user_id: string | null;
  status: "open" | "taken" | "not_taken";
  taken: boolean;
  edited_by: string | null;
  edited_at: string | null;
  created_at: string;
}

export interface ProcessRef {
  id: string;
  owner_user_id: string | null;
  live_version_id: string | null;
}
export interface DraftRef {
  id: string;
  version: number;
  status: string;
}

export interface SuggestStore {
  getProcess(key: ProcessKey): Promise<ProcessRef | null>;
  getSpec(versionId: string): Promise<unknown | null>;
  getOpenDraft(processId: string): Promise<DraftRef | null>;
  maxVersion(processId: string): Promise<number>;
  /** Insert the draft. A unique-violation (a concurrent first suggestion won) resolves to null, and the caller re-reads. */
  createDraft(row: { process_id: string; version: number; spec: unknown; proposed_by: string; change_summary: string }): Promise<DraftRef | null>;
  insertChange(row: Omit<ChangeRecord, "id" | "created_at" | "status" | "taken" | "edited_by" | "edited_at">): Promise<ChangeRecord>;
  positionSlugs(): Promise<ReadonlySet<string>>;
}

export type SuggestOutcome =
  | { kind: "ok"; draft: DraftRef; change: ChangeRecord; createdDraft: boolean }
  | { kind: "not_found" }
  | { kind: "no_baseline" }
  | { kind: "invalid"; error: string };

/**
 * Add one change to the process's ONE open draft (created from the live spec on the first suggestion). 409-case: no live version yet.
 * `before` is read from the live spec; the proposal is validated by dry-running it onto the live spec (same code as approve).
 */
export async function suggestChange(store: SuggestStore, args: { processKey: ProcessKey; userId: string; input: unknown }): Promise<SuggestOutcome> {
  const parsed = changeInputSchema.safeParse(args.input);
  if (!parsed.success) return { kind: "invalid", error: parsed.error.issues[0]?.message ?? "Invalid change" };
  const input = parsed.data;

  const proc = await store.getProcess(args.processKey);
  if (!proc) return { kind: "not_found" };
  if (!proc.live_version_id) return { kind: "no_baseline" };

  const rawLive = await store.getSpec(proc.live_version_id);
  const live = safeParseProcessSpec(args.processKey, rawLive);
  if (!live.ok) return { kind: "invalid", error: `The live version is unreadable: ${live.error}` };

  let before: unknown;
  try {
    before = currentValue(live.spec, input.part, input.field);
    applyChanges(args.processKey, live.spec, [{ part: input.part, field: input.field, after: input.after }], await store.positionSlugs());
  } catch (e) {
    return { kind: "invalid", error: e instanceof Error ? e.message : String(e) };
  }

  let createdDraft = false;
  let draft = await store.getOpenDraft(proc.id);
  if (!draft) {
    draft = await store.createDraft({
      process_id: proc.id,
      version: (await store.maxVersion(proc.id)) + 1,
      spec: live.spec,
      proposed_by: args.userId,
      change_summary: "Suggested changes",
    });
    if (draft) createdDraft = true;
    else draft = await store.getOpenDraft(proc.id); // lost the race to a concurrent first suggestion
    if (!draft) return { kind: "invalid", error: "Could not open a draft" };
  }

  const change = await store.insertChange({
    process_id: proc.id,
    version_id: draft.id,
    part: input.part,
    field: input.field,
    before,
    after: input.after,
    why: input.why,
    evidence: input.evidence,
    author_kind: "person",
    author_user_id: args.userId,
  });
  return { kind: "ok", draft, change, createdDraft };
}

export interface EditStore {
  /** The change with its draft's status and its process (owner + key + live version), scoped to the tenant. */
  getChange(changeId: string): Promise<{ change: ChangeRecord; versionStatus: string; processKey: ProcessKey; ownerUserId: string | null; liveVersionId: string | null } | null>;
  getSpec(versionId: string): Promise<unknown | null>;
  positionSlugs(): Promise<ReadonlySet<string>>;
  updateChange(changeId: string, patch: Partial<Pick<ChangeRecord, "after" | "taken" | "edited_by" | "edited_at">>): Promise<ChangeRecord | null>;
}

export type EditOutcome =
  | { kind: "ok"; change: ChangeRecord; edited: boolean; toggled: boolean }
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | { kind: "not_a_draft"; status: string }
  | { kind: "invalid"; error: string };

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Review-time edit: change the proposed value and/or tick/untick it. Touches ONLY the change row. Draft only; approver only. */
export async function editChange(
  store: EditStore,
  args: { processKey: ProcessKey; changeId: string; userId: string; canApprove: (ownerUserId: string | null) => boolean; patch: { after?: unknown; taken?: boolean }; now: Date },
): Promise<EditOutcome> {
  const found = await store.getChange(args.changeId);
  if (!found || found.processKey !== args.processKey) return { kind: "not_found" };
  if (!args.canApprove(found.ownerUserId)) return { kind: "forbidden" };
  if (found.versionStatus !== "draft") return { kind: "not_a_draft", status: found.versionStatus };
  const hasAfter = "after" in args.patch && args.patch.after !== undefined;
  if (!hasAfter && typeof args.patch.taken !== "boolean") return { kind: "invalid", error: "Nothing to change" };

  const patch: Parameters<EditStore["updateChange"]>[1] = {};
  let edited = false;
  if (hasAfter && !sameJson(args.patch.after, found.change.after)) {
    if (!found.liveVersionId) return { kind: "invalid", error: "Approve the baseline first" };
    const live = safeParseProcessSpec(found.processKey, await store.getSpec(found.liveVersionId));
    if (!live.ok) return { kind: "invalid", error: `The live version is unreadable: ${live.error}` };
    try {
      applyChanges(found.processKey, live.spec, [{ part: found.change.part, field: found.change.field, after: args.patch.after }], await store.positionSlugs());
    } catch (e) {
      return { kind: "invalid", error: e instanceof Error ? e.message : String(e) };
    }
    patch.after = args.patch.after;
    patch.edited_by = args.userId;
    patch.edited_at = args.now.toISOString();
    edited = true;
  }
  let toggled = false;
  if (typeof args.patch.taken === "boolean" && args.patch.taken !== found.change.taken) {
    patch.taken = args.patch.taken;
    toggled = true;
  }
  if (!edited && !toggled) return { kind: "ok", change: found.change, edited: false, toggled: false };
  const updated = await store.updateChange(args.changeId, patch);
  return updated ? { kind: "ok", change: updated, edited, toggled } : { kind: "not_found" };
}

export const REJECT_REASON_MAX = 300;

export interface RejectStore {
  getVersion(processKey: string, versionId: string): Promise<{ id: string; process_id: string; status: string; owner_user_id: string | null } | null>;
  /** The draft's change titles joined "; " (becomes the rejected version's change_summary), or null when it has none. */
  changeSummary(processKey: string, versionId: string): Promise<string | null>;
  /** draft -> rejected, conditional on the version still being a draft. `summary` (when given) replaces the placeholder change_summary. */
  setRejected(versionId: string, by: { userId: string; at: string; reason: string; summary: string | null }): Promise<boolean>;
  /** A rejected draft never leaves a change `open`: mark its still-open changes `not_taken`. */
  closeChanges(versionId: string): Promise<void>;
}

export type RejectOutcome =
  | { kind: "ok"; processId: string }
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | { kind: "not_a_draft"; status: string }
  | { kind: "reason_required" };

/** Reject a draft with a one-line reason (1-300 chars). The draft is kept as `rejected`; its open changes become `not_taken`. */
export async function rejectDraft(
  store: RejectStore,
  args: { processKey: string; versionId: string; userId: string; canApprove: (ownerUserId: string | null) => boolean; reason: unknown; now: Date },
): Promise<RejectOutcome> {
  const v = await store.getVersion(args.processKey, args.versionId);
  if (!v) return { kind: "not_found" };
  if (!args.canApprove(v.owner_user_id)) return { kind: "forbidden" };
  const reason = typeof args.reason === "string" ? args.reason.trim() : "";
  if (reason.length < 1 || reason.length > REJECT_REASON_MAX) return { kind: "reason_required" };
  if (v.status !== "draft") return { kind: "not_a_draft", status: v.status };
  const summary = await store.changeSummary(args.processKey, v.id);
  const ok = await store.setRejected(v.id, { userId: args.userId, at: args.now.toISOString(), reason, summary });
  if (!ok) return { kind: "not_a_draft", status: "changed" };
  await store.closeChanges(v.id);
  return { kind: "ok", processId: v.process_id };
}
