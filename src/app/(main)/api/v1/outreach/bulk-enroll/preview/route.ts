import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiNotFound, apiError, apiValidationError } from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getFeatureAccess } from "@/industries/_loader";
import { describeSendWindow, validateSendWindow } from "@/industries/_shared/features/outreach/lib/send-window";
import { FEATURES } from "@/industries/_registry";
import {
  SUPPORTED_CONFLICT_POLICIES,
  parseBulkBody,
  planBulkEnroll,
  type ConflictPolicy,
} from "@/industries/_shared/features/outreach/lib/bulk-enroll";

// POST /api/v1/outreach/bulk-enroll/preview — "what WOULD happen if I enrolled these leads?" Writes nothing.
// Body: { sequence_id, source: { mode: "selected", lead_ids } | { mode: "filter", tree }, conflict_policy? }
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

  const conflictPolicy = (body.conflict_policy ?? "skip") as ConflictPolicy;
  if (!SUPPORTED_CONFLICT_POLICIES.includes(conflictPolicy)) {
    return apiValidationError({ conflict_policy: [`Must be one of: ${SUPPORTED_CONFLICT_POLICIES.join(", ")}`] });
  }

  const db = await scopedClient(auth);
  const { data: sequence } = await db
    .from("email_sequences")
    .select("id, name, status, auto_send, send_window")
    .eq("id", parsed.sequenceId)
    .maybeSingle();
  const seq = sequence as unknown as {
    id: string;
    name: string;
    status: string;
    auto_send: boolean;
    send_window?: unknown;
  } | null;
  if (!seq || seq.status !== "active") return apiNotFound("Sequence");

  const planned = await planBulkEnroll(
    auth,
    parsed.source,
    { user: await createClient(), service: await createServiceClient(), db },
    { sequenceId: parsed.sequenceId, conflictPolicy }
  );
  if (!planned.ok) return apiValidationError(planned.errors);

  // With a send window the first emails wait for it — the dialog says when ("Mon, Tue … at 10:00–12:00").
  const parsedWindow = validateSendWindow(seq.send_window ?? null);
  const windowText = parsedWindow.ok && parsedWindow.window ? describeSendWindow(parsedWindow.window) : null;

  return apiSuccess({
    ...planned.plan.preview,
    sequence: { id: seq.id, name: seq.name, auto_send: seq.auto_send, send_window_text: windowText },
  });
}
