import { apiError, apiForbidden, apiNotFound, apiSuccess } from "@/lib/api/response";
import { logger } from "@/lib/logger";
import { isProcessKey } from "@/industries/education-consultancy/features/processes/lib/keys";
import { resolveProcessesContext } from "@/industries/education-consultancy/features/processes/server/context";
import { approveProcessVersion } from "@/industries/education-consultancy/features/processes/server/approve";

// Make a draft version live. Process owner or any tenant owner only; admins can't. Never edits the spec.
export async function POST(_request: Request, { params }: { params: Promise<{ key: string; versionId: string }> }) {
  const gate = await resolveProcessesContext();
  if (!gate.ok) return gate.response;
  const { key, versionId } = await params;
  if (!isProcessKey(key)) return apiNotFound("Process");
  try {
    const out = await approveProcessVersion(gate.ctx.db, gate.ctx.auth, key, versionId);
    if (out.kind === "not_found") return apiNotFound("Version");
    if (out.kind === "forbidden") return apiForbidden();
    if (out.kind === "not_a_draft") return apiError("CONFLICT", `Only a draft can be approved (this one is ${out.status})`, 409);
    return apiSuccess({ approved: true, retiredVersionId: out.retiredVersionId });
  } catch (err) {
    logger.error({ err, route: "processes/approve" }, "Failed to approve version");
    return apiError("DB_ERROR", "Failed to approve version", 500);
  }
}
