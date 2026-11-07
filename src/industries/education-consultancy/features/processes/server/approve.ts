import type { AuthContext } from "@/lib/api/auth";
import { approveVersion, type ApproveStore } from "../lib/approve";
import { canApproveProcess, type ProcessesDb } from "./context";

export function dbApproveStore(db: ProcessesDb): ApproveStore {
  return {
    async getVersion(processKey, versionId) {
      const { data } = await db.from("process_versions").select("id, process_id, status, processes!inner(key, owner_user_id)").eq("id", versionId).maybeSingle();
      const r = data as unknown as { id: string; process_id: string; status: string; processes: { key: string; owner_user_id: string | null } | Array<{ key: string; owner_user_id: string | null }> } | null;
      const p = Array.isArray(r?.processes) ? r?.processes[0] : r?.processes;
      return r && p && p.key === processKey ? { id: r.id, process_id: r.process_id, status: r.status, owner_user_id: p.owner_user_id } : null;
    },
    async getLiveVersionId(processId) {
      const { data } = await db.from("process_versions").select("id").eq("process_id", processId).eq("status", "live").maybeSingle();
      return (data as unknown as { id: string } | null)?.id ?? null;
    },
    async setStatus(versionId, from, to, approver) {
      const patch: Record<string, unknown> = { status: to };
      if (approver) Object.assign(patch, { approved_by: approver.userId, approved_at: approver.at });
      const { data, error } = await db.from("process_versions").update(patch).eq("id", versionId).eq("status", from).select("id");
      return !error && ((data as unknown[] | null)?.length ?? 0) > 0;
    },
    async setProcessLive(processId, versionId) {
      const { error } = await db.from("processes").update({ live_version_id: versionId }).eq("id", processId);
      if (error) throw new Error(`processes live_version_id: ${error.message}`);
    },
  };
}

export const approveProcessVersion = (db: ProcessesDb, auth: AuthContext, processKey: string, versionId: string) =>
  approveVersion(dbApproveStore(db), {
    processKey,
    versionId,
    userId: auth.userId,
    canApprove: (owner) => canApproveProcess(auth, owner),
    now: new Date(),
  });
