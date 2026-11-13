import { NextRequest } from "next/server";
import { apiConflict, apiError, apiForbidden, apiNotFound, apiSuccess } from "@/lib/api/response";
import { logger } from "@/lib/logger";
import { isProcessKey } from "@/industries/education-consultancy/features/processes/lib/keys";
import { resolveProcessesContext } from "@/industries/education-consultancy/features/processes/server/context";
import { editChangeAction } from "@/industries/education-consultancy/features/processes/server/changes";

// Edit a change during review: its proposed value and/or its tick. Process owner or any tenant owner only; draft only.
// Touches the change row, never the spec.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ key: string; id: string }> }) {
  const gate = await resolveProcessesContext();
  if (!gate.ok) return gate.response;
  const { key, id } = await params;
  if (!isProcessKey(key)) return apiNotFound("Process");
  let body: { after?: unknown; taken?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return apiError("VALIDATION_ERROR", "Invalid JSON body", 400);
  }
  if (body === null || typeof body !== "object") return apiError("VALIDATION_ERROR", "Invalid body", 400);
  if (body.taken !== undefined && typeof body.taken !== "boolean") return apiError("VALIDATION_ERROR", "`taken` must be true or false", 422);
  try {
    const out = await editChangeAction(gate.ctx, key, id, { after: body.after, taken: body.taken as boolean | undefined });
    if (out.kind === "not_found") return apiNotFound("Change");
    if (out.kind === "forbidden") return apiForbidden();
    if (out.kind === "not_a_draft") return apiConflict(`Only a draft can be edited (this one is ${out.status})`);
    if (out.kind === "invalid") return apiError("VALIDATION_ERROR", out.error, 422);
    return apiSuccess({ change: out.change });
  } catch (err) {
    logger.error({ err, route: "processes/changes/[id]" }, "Failed to edit change");
    return apiError("DB_ERROR", "Failed to edit change", 500);
  }
}
