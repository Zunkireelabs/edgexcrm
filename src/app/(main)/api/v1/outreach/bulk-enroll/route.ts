import { NextRequest, after } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiError,
  apiValidationError,
} from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import {
  BULK_ENROLL_CONFIRM_FROM,
  BULK_ENROLL_MAX_LEADS,
  SUPPORTED_CONFLICT_POLICIES,
  createBulkEnrollRun,
  parseBulkBody,
  planBulkEnroll,
  type ConflictPolicy,
} from "@/industries/_shared/features/outreach/lib/bulk-enroll";
import { processBulkEnrollRun } from "@/industries/_shared/features/outreach/lib/bulk-enroll-runner";

// POST /api/v1/outreach/bulk-enroll — Start. Re-resolves the audience NOW (so it is exactly what the rep's own
// visibility allows at this moment), saves one row per lead, and hands over to the background worker. The
// worker is kicked with after() so it keeps going if the browser disconnects; the in-process timer in
// src/instrumentation.ts is the safety net.
// Body: { sequence_id, source, conflict_policy?, confirm? }
export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: "/api/v1/outreach/bulk-enroll" });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.OUTREACH)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }
  const parsed = parseBulkBody(body);
  if (!parsed.ok) return apiValidationError(parsed.errors);

  const conflictPolicy = (body.conflict_policy ?? "skip") as ConflictPolicy;
  if (!SUPPORTED_CONFLICT_POLICIES.includes(conflictPolicy)) {
    return apiValidationError({ conflict_policy: [`Must be one of: ${SUPPORTED_CONFLICT_POLICIES.join(", ")}`] });
  }

  const db = await scopedClient(auth);
  const { data: sequence } = await db.from("email_sequences").select("id, status").eq("id", parsed.sequenceId).maybeSingle();
  if (!sequence || (sequence as unknown as { status: string }).status !== "active") return apiNotFound("Sequence");

  const planned = await planBulkEnroll(
    auth,
    parsed.source,
    { user: await createClient(), service: await createServiceClient(), db },
    { sequenceId: parsed.sequenceId, conflictPolicy }
  );
  if (!planned.ok) return apiValidationError(planned.errors);
  const { plan } = planned;

  if (plan.preview.willEnroll === 0) {
    return apiValidationError({ source: ["Nobody in this selection can be enrolled — see the preview for why."] });
  }
  if (plan.preview.overLimit) {
    return apiValidationError({ source: [`A run can enroll at most ${BULK_ENROLL_MAX_LEADS} leads — narrow the selection.`] });
  }
  if (plan.preview.willEnroll >= BULK_ENROLL_CONFIRM_FROM && body.confirm !== true) {
    return apiValidationError({ confirm: [`Enrolling ${BULK_ENROLL_CONFIRM_FROM} or more leads needs an explicit confirmation.`] });
  }

  let runId: string;
  try {
    runId = await createBulkEnrollRun(db, auth, {
      sequenceId: parsed.sequenceId,
      source: parsed.source,
      conflictPolicy,
      plan,
    });
  } catch (err) {
    log.error({ err }, "Failed to start bulk enrollment");
    return apiError("DB_ERROR", "Failed to start the bulk enrollment", 500);
  }

  after(async () => {
    try {
      await processBulkEnrollRun(auth.tenantId, runId);
    } catch (err) {
      log.error({ err, runId }, "bulk-enroll: first pass threw (the timer will retry)");
    }
  });

  log.info({ runId, willEnroll: plan.preview.willEnroll }, "Bulk enrollment started");
  return apiSuccess({ run_id: runId, will_enroll: plan.preview.willEnroll }, 201);
}
