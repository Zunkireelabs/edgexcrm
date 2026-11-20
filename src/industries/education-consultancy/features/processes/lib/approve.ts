import { applyChanges, changeTitle } from "./changes";
import { isProcessKey, type ProcessKey } from "./keys";
import { safeParseProcessSpec } from "./spec";

/** A live version is due for review this many days after it was approved. */
export const REVIEW_EVERY_DAYS = 30;

export type ApproveOutcome =
  | { kind: "ok"; retiredVersionId: string | null }
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | { kind: "not_a_draft"; status: string }
  /** The draft has changes and none is ticked. */
  | { kind: "no_changes_taken" }
  /** The ticked changes don't make a valid spec (or the base is unreadable). */
  | { kind: "invalid"; error: string };

/** The part of a change the approve path needs. */
export interface TakenChange {
  id: string;
  part: string;
  field: "target" | "wording" | "who";
  before: unknown;
  after: unknown;
  taken: boolean;
}

export interface ApproveStore {
  /** The version, scoped to the tenant, with its process's owner. */
  getVersion(processKey: string, versionId: string): Promise<{ id: string; process_id: string; status: string; owner_user_id: string | null } | null>;
  getLiveVersionId(processId: string): Promise<string | null>;
  /** Move one version's status; `from` makes the write conditional (a concurrent change makes it return false). */
  setStatus(versionId: string, from: string, to: "live" | "retired", approver?: { userId: string; at: string }): Promise<boolean>;
  setProcessLive(processId: string, versionId: string, reviewDueAt: string): Promise<void>;
  /** The draft's changes (P2). Empty for a baseline or any draft written without changes. */
  listChanges(versionId: string): Promise<TakenChange[]>;
  getSpec(versionId: string): Promise<unknown | null>;
  positionSlugs(): Promise<ReadonlySet<string>>;
  /** Position slug -> name, for the change titles ("now Counselor"). Optional: titles fall back to title-cased slugs. */
  positionNames?(): Promise<ReadonlyMap<string, string>>;
  /** Write the rebuilt spec + summary into the draft (only while it is still a draft). */
  setDraftSpec(versionId: string, spec: unknown, changeSummary: string): Promise<boolean>;
  /** Mark the ticked changes `taken` and the rest `not_taken`. */
  markChanges(takenIds: string[], notTakenIds: string[]): Promise<void>;
}

/**
 * Make a draft version live. Only the process's owner or a tenant owner may (`canApprove`, decided by the caller). The current live
 * version, if any, is retired FIRST (one live per process is a unique index) and restored if the promotion fails. The spec is never
 * touched once live; the DB trigger would refuse it anyway.
 *
 * A draft WITH changes (P2) is rebuilt first: the CURRENT live spec + only the ticked changes, validated, written into the draft, the
 * changes marked taken / not_taken, then promoted. A base that moved since the draft was opened is fine: we always apply onto live.
 */
export async function approveVersion(
  store: ApproveStore,
  args: { processKey: string; versionId: string; userId: string; canApprove: (ownerUserId: string | null) => boolean; now: Date },
): Promise<ApproveOutcome> {
  const v = await store.getVersion(args.processKey, args.versionId);
  if (!v) return { kind: "not_found" };
  if (!args.canApprove(v.owner_user_id)) return { kind: "forbidden" };
  if (v.status !== "draft") return { kind: "not_a_draft", status: v.status };

  const liveId = await store.getLiveVersionId(v.process_id);

  const changes = await store.listChanges(v.id);
  if (changes.length > 0) {
    const taken = changes.filter((c) => c.taken);
    if (taken.length === 0) return { kind: "no_changes_taken" };
    if (!isProcessKey(args.processKey)) return { kind: "invalid", error: "Unknown process" };
    const base = safeParseProcessSpec(args.processKey, await store.getSpec(liveId ?? v.id));
    if (!base.ok) return { kind: "invalid", error: `The base version is unreadable: ${base.error}` };
    let rebuilt;
    try {
      rebuilt = applyChanges(args.processKey, base.spec, taken, await store.positionSlugs());
    } catch (e) {
      return { kind: "invalid", error: e instanceof Error ? e.message : String(e) };
    }
    const nameBySlug = (await store.positionNames?.()) ?? new Map<string, string>();
    const summary = taken.map((c) => changeTitle(c, base.spec, { processKey: args.processKey as ProcessKey, nameBySlug })).join("; ");
    if (!(await store.setDraftSpec(v.id, rebuilt, summary))) return { kind: "not_a_draft", status: "changed" };
    await store.markChanges(
      taken.map((c) => c.id),
      changes.filter((c) => !c.taken).map((c) => c.id),
    );
  }

  if (liveId && !(await store.setStatus(liveId, "live", "retired"))) return { kind: "not_a_draft", status: "changed" };
  const promoted = await store.setStatus(v.id, "draft", "live", { userId: args.userId, at: args.now.toISOString() });
  if (!promoted) {
    if (liveId) await store.setStatus(liveId, "retired", "live");
    return { kind: "not_a_draft", status: "changed" };
  }
  await store.setProcessLive(v.process_id, v.id, new Date(args.now.getTime() + REVIEW_EVERY_DAYS * 86_400_000).toISOString());
  return { kind: "ok", retiredVersionId: liveId };
}
