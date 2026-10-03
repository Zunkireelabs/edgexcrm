import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiError, apiConflict, apiValidationError } from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES, INDUSTRIES } from "@/industries/_registry";
import { isBulkEmailEnabledForTenant, isEmailOutboundSandbox } from "@/lib/email/outbound/flag";
import { skipDraft } from "@/industries/_shared/features/outreach/lib/engine";
import {
  BULK_DRAFT_CONFIRM_FROM,
  BULK_DRAFT_MAX,
  SKIP_BATCH,
  parseBulkDraftBody,
  resolveEligibleDrafts,
  scheduleDrafts,
} from "@/industries/_shared/features/outreach/lib/bulk-drafts";

// POST /api/v1/outreach/drafts/bulk — Send now / Schedule / Skip for MANY drafts (Outreach -> Today).
// Body: { action: "send"|"schedule"|"skip",
//         selection: { mode: "ids", ids } | { mode: "all", due: "today"|"all", assigned_to? },
//         send_at? (schedule), confirm? (required from BULK_DRAFT_CONFIRM_FROM drafts up) }
//
// Which drafts is decided by lib/draft-scope.ts — the same rules as the Today list — so a counselor can only ever act on
// their own and "all matching" is exactly what the list shows. send / schedule need the same gates as Send now (Outreach,
// education only, the tenant's bulk-email grant) and only SET the send time: the scheduled-send timer does the sending
// (cap-aware, restart-safe), so a thousand sends never hold a request open. skip works in batches of SKIP_BATCH — each skip
// creates the next step's draft — and answers `remaining`; the screen repeats the request until it is 0.
export async function POST(request: NextRequest) {
  const log = createRequestLogger({ requestId: crypto.randomUUID(), method: "POST", path: "/api/v1/outreach/drafts/bulk" });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.OUTREACH)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }
  const parsed = parseBulkDraftBody(body);
  if (!parsed.ok) {
    return parsed.errors ? apiValidationError(parsed.errors) : apiError(parsed.code, parsed.message, parsed.status);
  }
  const { action, selection, sendAt, confirm } = parsed.value;

  const sending = action !== "skip";
  if (sending) {
    if (auth.industryId !== INDUSTRIES.EDUCATION_CONSULTANCY) return apiForbidden();
    if (!(await isBulkEmailEnabledForTenant(auth.tenantId))) {
      return apiConflict("Sending from EdgeX isn't turned on for your account, so these can't be sent.");
    }
  }

  const db = await scopedClient(auth);
  const limit = sending ? BULK_DRAFT_MAX : SKIP_BATCH;
  const found = await resolveEligibleDrafts(db, auth, selection, { forSending: sending, limit });

  const skipped = { no_subject: found.skipped.noSubject, no_email: found.skipped.noEmail, not_available: found.notAvailable };

  if (found.eligible.length === 0) {
    return apiError("NOTHING_TO_DO", "None of these drafts can be used — they may be sent already, not yours, paused, or missing a subject or email.", 422);
  }
  if (sending && found.truncated) {
    return apiError("TOO_MANY", `That is more than ${BULK_DRAFT_MAX.toLocaleString()} drafts — narrow it (for example "Show due today") and run it again.`, 422);
  }

  // The size of the whole job decides whether it needs an explicit confirmation (skip runs in batches, so use the total).
  const jobSize = sending ? found.eligible.length : found.matched;
  if (jobSize >= BULK_DRAFT_CONFIRM_FROM && !confirm) {
    return apiValidationError({ confirm: [`Acting on ${BULK_DRAFT_CONFIRM_FROM} or more drafts needs an explicit confirmation.`] });
  }

  const ids = found.eligible.map((d) => d.id);

  if (sending) {
    const when = action === "send" ? new Date() : sendAt!;
    const applied = await scheduleDrafts(db, auth, ids, when);
    log.info({ action, applied, eligible: ids.length }, "Bulk draft send/schedule");
    return apiSuccess({
      action,
      matched: found.matched,
      applied,
      remaining: 0,
      skipped,
      send_at: when.toISOString(),
      sandbox: isEmailOutboundSandbox(),
    });
  }

  // skip: one at a time (each advances its enrollment), a short batch per request
  let applied = 0;
  let failed = 0;
  for (const id of ids) {
    try {
      if (await skipDraft(db, auth, id)) applied++;
      else failed++;
    } catch (err) {
      failed++;
      log.error({ err, draftId: id }, "Bulk skip: a draft could not be skipped");
    }
  }
  const remaining = Math.max(0, found.matched - ids.length);
  log.info({ applied, failed, remaining }, "Bulk draft skip batch");
  return apiSuccess({ action, matched: found.matched, applied, failed, remaining, skipped });
}
