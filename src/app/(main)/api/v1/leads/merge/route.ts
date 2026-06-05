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
import { validate, required, isUUID } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { mergeLeads } from "@/lib/leads/merge";

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: "/api/v1/leads/merge" });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ body: ["Invalid JSON body"] });
  }

  const { valid, errors } = validate(body, {
    canonical_id: [required("canonical_id"), isUUID()],
    absorbed_id: [required("absorbed_id"), isUUID()],
  });
  if (!valid) return apiValidationError(errors);

  const canonicalId = body.canonical_id as string;
  const absorbedId = body.absorbed_id as string;

  log.info({ canonicalId, absorbedId }, "Merging leads");

  try {
    const supabase = await createServiceClient();
    const result = await mergeLeads(supabase, {
      tenantId: auth.tenantId,
      canonicalId,
      absorbedId,
      mergedBy: auth.userId,
      source: "manual",
      requestId,
    });

    log.info({ mergeId: result.mergeId, repointedCounts: result.repointedCounts }, "Leads merged");
    return apiSuccess(result, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Merge failed";
    log.error({ err }, "Lead merge failed");

    // Validation-class errors (converted lead, cross-tenant, already merged)
    if (
      message.includes("cannot merge a converted") ||
      message.includes("both leads must belong") ||
      message.includes("canonicalId and absorbedId must be different") ||
      message.includes("already deleted")
    ) {
      return apiValidationError({ merge: [message] });
    }

    return apiServiceUnavailable(message);
  }
}
