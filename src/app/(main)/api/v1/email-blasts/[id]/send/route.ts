import { NextRequest } from "next/server";
import { requireEmailCampaignsAccess } from "@/lib/email/outbound/api-guard";
import { apiSuccess, apiNotFound, apiConflict, apiError, apiValidationError } from "@/lib/api/response";
import { leadQueryScope } from "@/lib/api/permissions";
import { POSITION_ROUTE_MAP } from "@/industries/education-consultancy/features/new-leads-triage/position-routing";
import { inngest } from "@/lib/inngest/client";
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

// POST /api/v1/email-blasts/[id]/send — the ONLY thing this route does now is
// validate + hand off. Everything that used to run here synchronously
// (re-resolving the audience, the recipient-cap check, and materializing
// every email_messages row) now runs as steps inside the Inngest worker
// (materializeBlastAudience, src/lib/inngest/functions/email-blast-send.ts) —
// moved there specifically so a client that disconnects (navigates away,
// closes the tab, a proxy timeout) the instant after clicking Send can never
// interrupt anything. Before this change, that slow work sat BEFORE the
// Inngest handoff, inside the HTTP request itself — the exact window where a
// dropped connection could leave a blast never actually queued. Now the
// handoff is the first thing that happens after these cheap, synchronous
// checks, so there is no such window regardless of audience size.
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

  // Hand off to the background FIRST — before any slow work — then flip the
  // blast out of 'draft' so the UI switches from the composer to the (now
  // live-polling) blast detail view. Order matters: emitting the event before
  // the status update means a crash between the two still leaves a 'draft'
  // blast an Inngest event was already sent for, which is a safe, re-visible
  // failure (nothing silently lost) rather than the reverse (a 'queued' blast
  // no event was ever sent for, which would hang forever with no worker
  // coming to claim it).
  // senderId: the person actually clicking Send right now, not necessarily
  // who drafted the blast — materializeBlastAudience resolves permissions
  // against THIS id, never blast.created_by (nullable, wiped on account
  // deletion; also just the wrong person when someone other than the
  // drafter is the one sending). See that function's header comment.
  await inngest.send({ name: "email/blast.send", data: { tenantId: auth.tenantId, blastId: id, senderId: auth.userId } });

  const { data: updated, error: updateError } = await db
    .from("email_blasts")
    .update({ status: "queued", started_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();

  if (updateError) {
    log.error({ err: updateError, blastId: id }, "Failed to update blast status after handing off to the background worker");
    return apiError(
      "SERVICE_UNAVAILABLE",
      `Blast was queued for background send but its status could not be updated — check email_blasts directly (ref: ${requestId})`,
      503
    );
  }

  log.info({ blastId: id }, "email blast handed off to the background worker");

  return apiSuccess({ blast: updated });
}
