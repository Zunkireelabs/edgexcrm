import { NextRequest } from "next/server";
import { apiConflict, apiError, apiNotFound, apiSuccess } from "@/lib/api/response";
import { logger } from "@/lib/logger";
import { isProcessKey } from "@/industries/education-consultancy/features/processes/lib/keys";
import { resolveProcessesContext } from "@/industries/education-consultancy/features/processes/server/context";
import { suggestChangeAction } from "@/industries/education-consultancy/features/processes/server/changes";

// Suggest a change (EDGEX-109 P2): adds one change to the process's ONE open draft (created from the live spec on the first one).
// Owner/admin. 409 until the process has a live (approved) baseline.
export async function POST(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const gate = await resolveProcessesContext();
  if (!gate.ok) return gate.response;
  const { key } = await params;
  if (!isProcessKey(key)) return apiNotFound("Process");
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "Invalid JSON body", 400);
  }
  try {
    const out = await suggestChangeAction(gate.ctx, key, body);
    if (out.kind === "not_found") return apiNotFound("Process");
    if (out.kind === "no_baseline") return apiConflict("Approve the baseline first");
    if (out.kind === "invalid") return apiError("VALIDATION_ERROR", out.error, 422);
    return apiSuccess({ draftId: out.draft.id, version: out.draft.version, createdDraft: out.createdDraft, change: out.change }, out.createdDraft ? 201 : 200);
  } catch (err) {
    logger.error({ err, route: "processes/changes" }, "Failed to suggest a change");
    return apiError("DB_ERROR", "Failed to suggest a change", 500);
  }
}
