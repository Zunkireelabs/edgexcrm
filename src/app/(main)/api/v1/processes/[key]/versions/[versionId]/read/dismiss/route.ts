import { NextRequest } from "next/server";
import { createAuditLog } from "@/lib/api/audit";
import { apiConflict, apiError, apiNotFound, apiSuccess } from "@/lib/api/response";
import { logger } from "@/lib/logger";
import { isProcessKey } from "@/industries/education-consultancy/features/processes/lib/keys";
import { dbRejectStore } from "@/industries/education-consultancy/features/processes/server/changes";
import { resolveProcessesContext } from "@/industries/education-consultancy/features/processes/server/context";
import { dismissProcessRead } from "@/industries/education-consultancy/features/processes/server/improver/read-store";

// Dismiss Orca's read on a version (EDGEX-109 P4a): hides it until the next read. Owner/admin only (the Processes gate); audited.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ key: string; versionId: string }> }) {
  const gate = await resolveProcessesContext();
  if (!gate.ok) return gate.response;
  const { key, versionId } = await params;
  if (!isProcessKey(key)) return apiNotFound("Process");
  try {
    // The version must belong to THIS process of THIS tenant (plain single-table reads, scoped client).
    const version = await dbRejectStore(gate.ctx.db).getVersion(key, versionId);
    if (!version) return apiNotFound("Version");
    const done = await dismissProcessRead(gate.ctx.db, versionId, gate.ctx.auth.userId, new Date());
    if (!done) return apiConflict("There is no read to dismiss");
    await createAuditLog({
      tenantId: gate.ctx.auth.tenantId,
      userId: gate.ctx.auth.userId,
      action: "process.read_dismissed",
      entityType: "process_version",
      entityId: versionId,
      changes: { read: { old: "shown", new: "dismissed" } },
    });
    return apiSuccess({ dismissed: true });
  } catch (err) {
    logger.error({ err, route: "processes/read/dismiss" }, "Failed to dismiss Orca's read");
    return apiError("DB_ERROR", "Failed to dismiss the read", 500);
  }
}
