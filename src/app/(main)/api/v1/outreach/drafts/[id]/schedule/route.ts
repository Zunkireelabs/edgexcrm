import { NextRequest, type NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiNotFound, apiError, apiConflict, apiValidationError } from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient, type ScopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES, INDUSTRIES } from "@/industries/_registry";
import { isBulkEmailEnabledForTenant } from "@/lib/email/outbound/flag";
import type { AuthContext } from "@/lib/api/auth";

type Props = { params: Promise<{ id: string }> };

// A schedule must be far enough ahead for the in-app runner (about a minute) and not absurdly far.
const MIN_LEAD_MS = 5 * 60 * 1000;
const MAX_LEAD_MS = 90 * 24 * 60 * 60 * 1000;

interface DraftRow {
  id: string;
  subject: string;
  status: string;
  assigned_to: string | null;
}

async function loadAllowedDraft(
  auth: AuthContext,
  db: ScopedClient,
  id: string
): Promise<{ error: NextResponse } | { draft: DraftRow }> {
  const { data } = await db.from("sequence_step_drafts").select("id, subject, status, assigned_to").eq("id", id).maybeSingle();
  if (!data) return { error: apiNotFound("Draft") };
  const draft = data as unknown as DraftRow;
  const isAdminTier = auth.role === "owner" || auth.role === "admin";
  if (!isAdminTier && draft.assigned_to !== auth.userId) return { error: apiForbidden() };
  return { draft };
}

// POST /api/v1/outreach/drafts/[id]/schedule { send_at } — schedule one pending draft to be sent by
// EdgeX at that time (education only, same gates as Send now). Re-scheduling replaces the old time.
export async function POST(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const log = createRequestLogger({ requestId: crypto.randomUUID(), method: "POST", path: "/api/v1/outreach/drafts/[id]/schedule" });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.OUTREACH)) return apiForbidden();
  if (auth.industryId !== INDUSTRIES.EDUCATION_CONSULTANCY) return apiForbidden();

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ send_at: ["A date and time is required"] });
  }
  const sendAt = typeof body.send_at === "string" ? new Date(body.send_at) : null;
  if (!sendAt || Number.isNaN(sendAt.getTime())) return apiValidationError({ send_at: ["A valid date and time is required"] });

  const delta = sendAt.getTime() - Date.now();
  if (delta < MIN_LEAD_MS) return apiError("SCHEDULE_TOO_SOON", "Pick a time at least 5 minutes from now.", 422);
  if (delta > MAX_LEAD_MS) return apiError("SCHEDULE_TOO_FAR", "Pick a time within the next 90 days.", 422);

  const db = await scopedClient(auth);
  const loaded = await loadAllowedDraft(auth, db, id);
  if ("error" in loaded) return loaded.error;
  const { draft } = loaded;

  if (!(await isBulkEmailEnabledForTenant(auth.tenantId))) {
    return apiConflict("Sending from EdgeX isn't turned on for your account, so a send can't be scheduled.");
  }
  if (draft.status !== "pending") return apiConflict("This step was already sent or skipped.");
  if (!draft.subject?.trim()) return apiError("SUBJECT_REQUIRED", "Add a subject before scheduling.", 422);

  await db
    .from("sequence_step_drafts")
    .update({ scheduled_send_at: sendAt.toISOString(), scheduled_by: auth.userId, scheduled_error: null })
    .eq("id", id);

  log.info({ draftId: id, sendAt: sendAt.toISOString() }, "Sequence draft scheduled");
  return apiSuccess({ scheduled_send_at: sendAt.toISOString(), scheduled_by: auth.userId, scheduled_error: null });
}

// DELETE /api/v1/outreach/drafts/[id]/schedule — cancel a schedule (also clears a failed-send note).
export async function DELETE(_request: NextRequest, { params }: Props) {
  const { id } = await params;

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.OUTREACH)) return apiForbidden();
  if (auth.industryId !== INDUSTRIES.EDUCATION_CONSULTANCY) return apiForbidden();

  const db = await scopedClient(auth);
  const loaded = await loadAllowedDraft(auth, db, id);
  if ("error" in loaded) return loaded.error;
  if (loaded.draft.status !== "pending") return apiConflict("This step was already sent or skipped.");

  await db
    .from("sequence_step_drafts")
    .update({ scheduled_send_at: null, scheduled_by: null, scheduled_error: null })
    .eq("id", id);

  return apiSuccess({ scheduled_send_at: null, scheduled_by: null, scheduled_error: null });
}
