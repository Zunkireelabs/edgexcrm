import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiError, apiConflict, apiValidationError } from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES, INDUSTRIES } from "@/industries/_registry";
import { isBulkEmailEnabledForTenant, isEmailOutboundSandbox } from "@/lib/email/outbound/flag";
import { sendQueuedEmailBatch } from "@/lib/email/outbound/send";
import { normalizeEmail } from "@/lib/email/outbound/suppression";
import { buildTestEmail, validateTestInput } from "@/industries/_shared/features/outreach/lib/test-send";

// POST /api/v1/outreach/sequences/test-send — "Send me a test" from the sequence editor. Sends ONE step, rendered with
// sample data, to the signed-in person's own address, through the normal outbound spine (unsubscribe footer, suppression,
// daily cap, sandbox + transport guards). Takes the subject / body from the request, not from a saved sequence, so an
// unsaved edit can be tested. Same gates as Send now (Outreach, education only, the tenant's bulk-email grant) plus admin:
// only people who can edit sequences can send tests. Limited to 10 an hour per address.
// Body: { subject_template, body_template, step_label? }

const MAX_TESTS_PER_HOUR = 10;

export async function POST(request: NextRequest) {
  const log = createRequestLogger({ requestId: crypto.randomUUID(), method: "POST", path: "/api/v1/outreach/sequences/test-send" });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.OUTREACH)) return apiForbidden();
  if (auth.industryId !== INDUSTRIES.EDUCATION_CONSULTANCY) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }
  const input = validateTestInput(body.subject_template, body.body_template);
  if (!input.ok) return apiValidationError(input.errors);

  if (!auth.email) return apiError("NO_EMAIL", "Your account has no email address to send the test to.", 422);
  if (!(await isBulkEmailEnabledForTenant(auth.tenantId))) {
    return apiConflict("Sending from EdgeX isn't turned on for your account, so a test can't be sent.");
  }

  const db = await scopedClient(auth);
  const to = normalizeEmail(auth.email);

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count: recent } = await db
    .from("email_messages")
    .select("id", { count: "exact", head: true })
    .eq("source", "manual")
    .eq("to_email", to)
    .gte("created_at", hourAgo);
  if ((recent ?? 0) >= MAX_TESTS_PER_HOUR) {
    return apiError("RATE_LIMITED", `You've sent ${MAX_TESTS_PER_HOUR} tests in the last hour — try again later.`, 429);
  }

  const { data: tenant } = await db.fromGlobal("tenants").select("name").eq("id", auth.tenantId).maybeSingle();
  const email = buildTestEmail({
    subject: input.subject,
    body: input.body,
    tenantName: (tenant as { name?: string } | null)?.name ?? "",
    toEmail: to,
    stepLabel: typeof body.step_label === "string" ? body.step_label.slice(0, 80) : undefined,
  });

  const { data: row, error } = await db
    .from("email_messages")
    .insert({ source: "manual", to_email: to, to_email_stored: auth.email, subject: email.subject, body_html: email.body_html, status: "queued" })
    .select("id")
    .single();
  if (error || !row) {
    log.error({ err: error }, "test-send: failed to queue the test email");
    return apiError("QUEUE_ERROR", "Couldn't queue the test email.", 500);
  }
  const messageId = (row as { id: string }).id;

  const result = await sendQueuedEmailBatch(auth.tenantId, [messageId]);
  if (result.sent === 1) {
    log.info({ messageId }, "Sequence test email sent");
    // In sandbox the spine redirects it to the configured test address instead of the person's own — say so.
    return apiSuccess({ sent: true, to: auth.email, sandbox: isEmailOutboundSandbox() });
  }
  if (result.throttled === 1) {
    return apiError("DAILY_CAP", "The daily send limit has been reached — the test can't go out until tomorrow.", 429);
  }
  if (result.suppressed === 1) {
    return apiError("SUPPRESSED", "Your own address is on the do-not-contact list (you unsubscribed or it bounced), so no test can be sent to it.", 422);
  }
  return apiError("SEND_FAILED", "The test email couldn't be sent. Check the sending settings and try again.", 422);
}
