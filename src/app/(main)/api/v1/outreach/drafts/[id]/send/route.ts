import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiNotFound, apiError, apiConflict } from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES, INDUSTRIES } from "@/industries/_registry";
import { isBulkEmailEnabledForTenant } from "@/lib/email/outbound/flag";
import { sendDraftViaEdgeX } from "@/industries/_shared/features/outreach/lib/send-draft";

type Props = { params: Promise<{ id: string }> };

interface DraftRow {
  id: string;
  lead_id: string;
  subject: string;
  body_html: string;
  status: string;
  assigned_to: string | null;
  leads: { deleted_at: string | null } | null;
  sequence_enrollments: { status: string } | null;
}

// POST /api/v1/outreach/drafts/[id]/send — send one pending sequence draft through the EdgeX
// outbound spine (the same code the auto-send cron uses), then mark it sent via EdgeX. Unlike
// /send-log this DOES send an email, so it is gated four ways: the outreach feature, education
// only, the tenant's bulk-email grant (which itself requires the env kill switch), and the
// spine's own sandbox/transport guards.
export async function POST(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: "/api/v1/outreach/drafts/[id]/send" });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.OUTREACH)) return apiForbidden();
  if (auth.industryId !== INDUSTRIES.EDUCATION_CONSULTANCY) return apiForbidden();

  const db = await scopedClient(auth);

  const { data } = await db
    .from("sequence_step_drafts")
    .select("id, lead_id, subject, body_html, status, assigned_to, leads!inner(deleted_at), sequence_enrollments!inner(status)")
    .eq("id", id)
    .maybeSingle();
  if (!data) return apiNotFound("Draft");
  const draft = data as unknown as DraftRow;

  const isAdminTier = auth.role === "owner" || auth.role === "admin";
  if (!isAdminTier && draft.assigned_to !== auth.userId) return apiForbidden();

  if (!(await isBulkEmailEnabledForTenant(auth.tenantId))) {
    return apiConflict("Sending from EdgeX isn't turned on for your account. Use Copy body and Mark sent instead.");
  }
  if (draft.status !== "pending") return apiConflict("This step was already sent or skipped.");
  // Same eligibility as the Today list: a deleted lead or a paused/completed/unenrolled enrollment never sends.
  if (draft.leads?.deleted_at || draft.sequence_enrollments?.status !== "active") {
    return apiConflict("This lead's sequence isn't active, so this email can't be sent.");
  }
  if (!draft.subject?.trim()) return apiError("SUBJECT_REQUIRED", "Add a subject before sending.", 422);

  const result = await sendDraftViaEdgeX(db, auth.tenantId, draft, { sentBy: auth.userId });

  switch (result.status) {
    case "sent":
      log.info({ draftId: id, emailMessageId: result.emailMessageId }, "Sequence draft sent via EdgeX");
      return apiSuccess({ sent: true, email_message_id: result.emailMessageId });
    case "already_sent":
      return apiConflict("This email was already sent.");
    case "in_progress":
      return apiConflict("This email is already being sent. Refresh in a moment.");
    case "no_email":
      return apiError("NO_EMAIL", "This lead has no email address, so it can't be sent.", 422);
    case "throttled":
      return apiError(
        "DAILY_CAP_REACHED",
        "Today's sending limit is reached. The step stays pending and can be sent tomorrow.",
        429
      );
    case "already_handled":
      return apiError(
        "SEND_ALREADY_FAILED",
        result.errorMessage ?? `A previous send attempt ended as "${result.messageStatus}". Skip this step or send it manually.`,
        409,
        { error_code: result.errorCode }
      );
    case "failed":
      log.warn({ draftId: id, errorCode: result.errorCode, suppressed: result.suppressed }, "Sequence draft send failed");
      return apiError(
        result.suppressed ? "RECIPIENT_SUPPRESSED" : "SEND_FAILED",
        result.suppressed
          ? "This address has unsubscribed or bounced, so EdgeX won't send to it. Skip the step or send it manually."
          : (result.errorMessage ?? "The email couldn't be sent. Try again, skip the step, or send it manually."),
        422,
        { error_code: result.errorCode }
      );
  }
}
