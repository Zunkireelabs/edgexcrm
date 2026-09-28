import { NextRequest, after } from "next/server";
import { requireEmailCampaignsAccess } from "@/lib/email/outbound/api-guard";
import { apiSuccess, apiNotFound, apiConflict, apiError, apiValidationError } from "@/lib/api/response";
import { leadQueryScope } from "@/lib/api/permissions";
import { POSITION_ROUTE_MAP } from "@/industries/education-consultancy/features/new-leads-triage/position-routing";
import { processOneBlast } from "@/lib/email/outbound/blast-runner";
import { createRequestLogger } from "@/lib/logger";

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface BlastRow {
  id: string;
  subject_template: string;
  body_template: string;
  status: string;
}

// POST /api/v1/email-blasts/[id]/send — the ONLY thing this route does
// synchronously is validate + flip status. Everything slow (re-resolving the
// audience, the recipient-cap check, materializing every email_messages row,
// and driving the actual send loop) runs in the background via
// processOneBlast (src/lib/email/outbound/blast-runner.ts), scheduled with
// Next's after() below — after() is guaranteed to keep running even if the
// client disconnects (navigates away, closes the tab, a proxy timeout) the
// instant after clicking Send, which is what makes "click Send, then leave
// the page" safe regardless of audience size. This used to hand off to an
// Inngest event instead (see git history / docs/SESSION-LOG.md's 2026-09-28
// entry) — moved off Inngest because the shared Inngest account's execution
// quota being exhausted was silently blocking every blast from ever starting.
// The in-process timer in src/instrumentation.ts is the safety net if this
// after() call never completes (e.g. the server process itself crashes in
// that narrow window) — see blast-runner.ts's header comment.
//
// One synchronous check intentionally stays here rather than moving to the
// background: whether the sender has full (unrestricted) lead-visibility
// scope. resolveAudience's own/branch-scope branch requires a real
// user-authenticated (RLS) Supabase client to call the
// leads_visible_to_user() SECURITY DEFINER RPC — that RPC fails CLOSED
// (silently returns zero rows) if called with a service-role client instead,
// which is all a background job has (no live session/cookies to rebuild a
// real user client from). Rather than risk a background job silently
// resolving "0 recipients" for a branch/own-scoped sender, this check rejects
// instantly at click time — the same instant-error UX the empty-audience and
// over-cap checks used to have — and only unrestricted (owner/admin-typical)
// senders proceed. Today's UI only allows owner/admin to reach Send at all
// (canSendEmail), so in practice this never fires; it exists as a safety net
// for whenever the Positions/RBAC "leadScope" a position lower than that.
export async function POST(_request: NextRequest, { params }: RouteParams) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: "/api/v1/email-blasts/[id]/send" });

  const guard = await requireEmailCampaignsAccess();
  if (!guard.ok) return guard.response;
  const { auth, db } = guard;
  const { id } = await params;

  const { data: blast, error: fetchError } = await db
    .from("email_blasts")
    .select("id, subject_template, body_template, status")
    .eq("id", id)
    .maybeSingle();
  if (fetchError || !blast) return apiNotFound("Email blast");
  const blastRow = blast as unknown as BlastRow;

  if (blastRow.status !== "draft") {
    return apiConflict(`Blast is "${blastRow.status}" — only a draft blast can be sent`);
  }
  if (!blastRow.subject_template.trim() || !blastRow.body_template.trim()) {
    return apiValidationError({ body: ["Blast subject and body must not be empty before sending"] });
  }

  const poolSlug =
    auth.industryId === "education_consultancy" && auth.positionSlug && auth.branchId
      ? (POSITION_ROUTE_MAP[auth.positionSlug] ?? null)
      : null;
  const scope = leadQueryScope(auth.permissions, auth.userId, auth.branchId, poolSlug);
  if (scope.restrictToSelf || scope.branchId) {
    return apiError(
      "RESTRICTED_SENDER_SCOPE",
      "Only a sender with full (unrestricted) lead access can send a blast — this account's lead visibility is scoped.",
      422
    );
  }

  // Flip status FIRST (awaited), then schedule the background send via
  // after() — unlike the old Inngest handoff, there's no separate async event
  // to race against: this single request does the status write itself, so by
  // the time after() fires, the row is guaranteed to already be 'queued'.
  const { data: updated, error: updateError } = await db
    .from("email_blasts")
    .update({ status: "queued", started_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "draft")
    .select("*")
    .maybeSingle();

  if (updateError) {
    log.error({ err: updateError, blastId: id }, "Failed to update blast status when handing off to the background sender");
    return apiError(
      "SERVICE_UNAVAILABLE",
      `Blast could not be queued for background send — check email_blasts directly (ref: ${requestId})`,
      503
    );
  }

  if (!updated) {
    return apiConflict(`Blast is "${blastRow.status}" — only a draft blast can be sent`);
  }

  // senderId: the person actually clicking Send right now, not necessarily
  // who drafted the blast — materializeBlastAudience resolves permissions
  // against THIS id, never blast.created_by (nullable, wiped on account
  // deletion; also just the wrong person when someone other than the drafter
  // is the one sending). See that function's header comment.
  //
  // after() keeps running even if this response's client disconnects —
  // that's the whole point (see this route's header comment).
  after(() => {
    processOneBlast(auth.tenantId, id, auth.userId).catch((err) => {
      log.error({ err, blastId: id }, "background email-blast send threw");
    });
  });

  log.info({ blastId: id }, "email blast queued and handed off to the background sender");

  return apiSuccess({ blast: updated });
}
