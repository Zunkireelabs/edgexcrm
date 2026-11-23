import type { AuthContext } from "@/lib/api/auth";
import { createAuditLog } from "@/lib/api/audit";
import { logger } from "@/lib/logger";
import { approveVersion, type ApproveStore, type TakenChange } from "../lib/approve";
import { canApproveProcess, type ProcessesDb } from "./context";
import { getVersionSpec, must, positionNameMap, positionSlugSet } from "./changes";

/** `processes` and `process_versions` have TWO foreign keys between them (process_id, and processes.live_version_id), so an embed
 *  without the FK name is ambiguous (PGRST201). Every embed names the FK. A guard test enforces it. */
export const PROCESS_EMBED = "processes!process_versions_process_id_fkey!inner";

function fail(op: string, error: { message: string; code?: string }): never {
  logger.error({ err: error, op, route: "processes/approve" }, "Processes store read failed");
  throw new Error(`${op}: ${error.message}`);
}

export function dbApproveStore(db: ProcessesDb): ApproveStore {
  return {
    async getVersion(processKey, versionId) {
      const { data, error } = await db.from("process_versions").select(`id, process_id, status, ${PROCESS_EMBED}(key, owner_user_id)`).eq("id", versionId).maybeSingle();
      if (error) fail("process_versions read", error);
      const r = data as unknown as { id: string; process_id: string; status: string; processes: { key: string; owner_user_id: string | null } | Array<{ key: string; owner_user_id: string | null }> } | null;
      const p = Array.isArray(r?.processes) ? r?.processes[0] : r?.processes;
      return r && p && p.key === processKey ? { id: r.id, process_id: r.process_id, status: r.status, owner_user_id: p.owner_user_id } : null;
    },
    async getLiveVersionId(processId) {
      const { data, error } = await db.from("process_versions").select("id").eq("process_id", processId).eq("status", "live").maybeSingle();
      if (error) fail("process_versions live read", error);
      return (data as unknown as { id: string } | null)?.id ?? null;
    },
    async setStatus(versionId, from, to, approver) {
      const patch: Record<string, unknown> = { status: to };
      if (approver) Object.assign(patch, { approved_by: approver.userId, approved_at: approver.at });
      const { data, error } = await db.from("process_versions").update(patch).eq("id", versionId).eq("status", from).select("id");
      return !error && ((data as unknown[] | null)?.length ?? 0) > 0;
    },
    async setProcessLive(processId, versionId, reviewDueAt) {
      const { error } = await db.from("processes").update({ live_version_id: versionId, review_due_at: reviewDueAt }).eq("id", processId);
      if (error) throw new Error(`processes live_version_id/review_due_at: ${error.message}`);
    },
    async listChanges(versionId) {
      const rows = must("changes read", await db.from("process_changes").select("id, part, field, before, after, taken").eq("version_id", versionId)) as unknown as TakenChange[] | null;
      return rows ?? [];
    },
    getSpec: (versionId) => getVersionSpec(db, versionId),
    positionSlugs: () => positionSlugSet(db),
    positionNames: () => positionNameMap(db),
    async setDraftSpec(versionId, spec, changeSummary) {
      const { data, error } = await db.from("process_versions").update({ spec, change_summary: changeSummary }).eq("id", versionId).eq("status", "draft").select("id");
      if (error) throw new Error(`draft spec write: ${error.message}`);
      return ((data as unknown[] | null)?.length ?? 0) > 0;
    },
    async markChanges(takenIds, notTakenIds) {
      if (takenIds.length) {
        const { error } = await db.from("process_changes").update({ status: "taken" }).in("id", takenIds);
        if (error) throw new Error(`changes mark taken: ${error.message}`);
      }
      if (notTakenIds.length) {
        const { error } = await db.from("process_changes").update({ status: "not_taken" }).in("id", notTakenIds);
        if (error) throw new Error(`changes mark not_taken: ${error.message}`);
      }
    },
  };
}

export async function approveProcessVersion(db: ProcessesDb, auth: AuthContext, processKey: string, versionId: string) {
  const out = await approveVersion(dbApproveStore(db), {
    processKey,
    versionId,
    userId: auth.userId,
    canApprove: (owner) => canApproveProcess(auth, owner),
    now: new Date(),
  });
  if (out.kind === "ok") {
    await createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "process.version_approved",
      entityType: "process_version",
      entityId: versionId,
      changes: { status: { old: "draft", new: "live" }, retired_version_id: { old: null, new: out.retiredVersionId } },
    });
  }
  return out;
}
