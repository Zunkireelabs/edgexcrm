/** A live version is due for review this many days after it was approved. */
export const REVIEW_EVERY_DAYS = 30;

export type ApproveOutcome =
  | { kind: "ok"; retiredVersionId: string | null }
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | { kind: "not_a_draft"; status: string };

export interface ApproveStore {
  /** The version, scoped to the tenant, with its process's owner. */
  getVersion(processKey: string, versionId: string): Promise<{ id: string; process_id: string; status: string; owner_user_id: string | null } | null>;
  getLiveVersionId(processId: string): Promise<string | null>;
  /** Move one version's status; `from` makes the write conditional (a concurrent change makes it return false). */
  setStatus(versionId: string, from: string, to: "live" | "retired", approver?: { userId: string; at: string }): Promise<boolean>;
  setProcessLive(processId: string, versionId: string, reviewDueAt: string): Promise<void>;
}

/**
 * Make a draft version live. Only the process's owner or a tenant owner may (`canApprove`, decided by the caller). The current live
 * version, if any, is retired FIRST (one live per process is a unique index) and restored if the promotion fails. The spec is never
 * touched; the DB trigger would refuse it anyway.
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
  if (liveId && !(await store.setStatus(liveId, "live", "retired"))) return { kind: "not_a_draft", status: "changed" };
  const promoted = await store.setStatus(v.id, "draft", "live", { userId: args.userId, at: args.now.toISOString() });
  if (!promoted) {
    if (liveId) await store.setStatus(liveId, "retired", "live");
    return { kind: "not_a_draft", status: "changed" };
  }
  await store.setProcessLive(v.process_id, v.id, new Date(args.now.getTime() + REVIEW_EVERY_DAYS * 86_400_000).toISOString());
  return { kind: "ok", retiredVersionId: liveId };
}
