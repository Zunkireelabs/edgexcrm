import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import {
  apiSuccess,
  apiValidationError,
  apiUnauthorized,
  apiForbidden,
  apiServiceUnavailable,
} from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { undoMerge } from "@/lib/leads/merge";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ mergeId: string }> }
) {
  const requestId = crypto.randomUUID();
  const { mergeId } = await params;
  const log = createRequestLogger({
    requestId,
    method: "POST",
    path: `/api/v1/leads/merge/${mergeId}/undo`,
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!requireAdmin(auth)) return apiForbidden();

  log.info({ mergeId }, "Undoing lead merge");

  try {
    const supabase = await createServiceClient();
    const result = await undoMerge(supabase, mergeId, auth.tenantId, auth.userId, requestId);

    log.info(
      { restoredAbsorbedId: result.restoredAbsorbedId, canonicalId: result.canonicalId },
      "Lead merge undone"
    );
    return apiSuccess(result, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Undo failed";
    log.error({ err, mergeId }, "Lead merge undo failed");

    if (message.includes("not found") || message.includes("already been undone")) {
      return apiValidationError({ merge: [message] });
    }

    return apiServiceUnavailable(message);
  }
}
