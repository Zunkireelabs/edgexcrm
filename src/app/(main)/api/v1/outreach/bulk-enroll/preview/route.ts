import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiNotFound, apiError, apiValidationError } from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { parseBulkBody, planBulkEnroll } from "@/industries/_shared/features/outreach/lib/bulk-enroll";

// POST /api/v1/outreach/bulk-enroll/preview — "what WOULD happen if I enrolled these leads?" Writes nothing.
// Body: { sequence_id, source: { mode: "selected", lead_ids } | { mode: "filter", tree } }
export async function POST(request: NextRequest) {
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

  const db = await scopedClient(auth);
  const { data: sequence } = await db
    .from("email_sequences")
    .select("id, name, status, auto_send")
    .eq("id", parsed.sequenceId)
    .maybeSingle();
  const seq = sequence as unknown as { id: string; name: string; status: string; auto_send: boolean } | null;
  if (!seq || seq.status !== "active") return apiNotFound("Sequence");

  const planned = await planBulkEnroll(auth, parsed.source, {
    user: await createClient(),
    service: await createServiceClient(),
    db,
  });
  if (!planned.ok) return apiValidationError(planned.errors);

  return apiSuccess({ ...planned.plan.preview, sequence: { id: seq.id, name: seq.name, auto_send: seq.auto_send } });
}
