import { NextRequest } from "next/server";
import { apiConflict, apiError, apiForbidden, apiNotFound, apiSuccess } from "@/lib/api/response";
import { logger } from "@/lib/logger";
import { isProcessKey } from "@/industries/education-consultancy/features/processes/lib/keys";
import { resolveProcessesContext } from "@/industries/education-consultancy/features/processes/server/context";
import { rejectDraftAction } from "@/industries/education-consultancy/features/processes/server/changes";

// Reject a draft with a one-line reason (1-300 chars). Process owner or any tenant owner only. The draft is kept as `rejected`.
export async function POST(request: NextRequest, { params }: { params: Promise<{ key: string; versionId: string }> }) {
  const gate = await resolveProcessesContext();
  if (!gate.ok) return gate.response;
  const { key, versionId } = await params;
  if (!isProcessKey(key)) return apiNotFound("Process");
  let body: { reason?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    /* an empty body is the same as no reason: handled below */
  }
  try {
    const out = await rejectDraftAction(gate.ctx, key, versionId, body?.reason);
    if (out.kind === "not_found") return apiNotFound("Version");
    if (out.kind === "forbidden") return apiForbidden();
    if (out.kind === "reason_required") return apiError("VALIDATION_ERROR", "Give a reason (1 to 300 characters)", 422);
    if (out.kind === "not_a_draft") return apiConflict(`Only a draft can be rejected (this one is ${out.status})`);
    return apiSuccess({ rejected: true });
  } catch (err) {
    logger.error({ err, route: "processes/reject" }, "Failed to reject draft");
    return apiError("DB_ERROR", "Failed to reject draft", 500);
  }
}
