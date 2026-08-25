import { NextRequest } from "next/server";
import { requireEmailCampaignsAccess } from "@/lib/email/outbound/api-guard";
import { apiSuccess, apiNotFound, apiConflict, apiError, apiValidationError, apiServiceUnavailable } from "@/lib/api/response";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { resolveAudience, type AudienceRow } from "@/lib/email/outbound/audience";
import { composeRecipientEmail } from "@/lib/email/outbound/compose";
import { inngest } from "@/lib/inngest/client";
import { EMPTY_TREE, type FilterTree } from "@/lib/filters/types";
import { createRequestLogger } from "@/lib/logger";

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface BlastRow {
  id: string;
  subject_template: string;
  body_template: string;
  from_name_override: string | null;
  audience_filter: FilterTree | null;
  status: string;
}

// POST /api/v1/email-blasts/[id]/send — OUTREACH-PHASE1-BRIEF.md §5. Order is
// fixed and load-bearing, mirroring sms/blasts/[id]/send: re-resolve ->
// materialize rows -> emit event. Do not reorder.
//
// Unlike SMS, materialization uses a plain upsert with
// onConflict: "source_id,lead_id" — email_messages.uq_email_message_source_lead
// is NOT partial (migration 211's deliberate amendment, precisely so this
// route can rely on ON CONFLICT DO NOTHING instead of SMS's "check existing
// rows, insert only the delta" workaround its partial index forces).
export async function POST(_request: NextRequest, { params }: RouteParams) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: "/api/v1/email-blasts/[id]/send" });

  const guard = await requireEmailCampaignsAccess();
  if (!guard.ok) return guard.response;
  const { auth, db } = guard;
  const { id } = await params;

  const { data: blast, error: fetchError } = await db
    .from("email_blasts")
    .select("id, subject_template, body_template, from_name_override, audience_filter, status")
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

  // 1. Re-resolve the audience server-side. Never trust a client-supplied count.
  const userClient = await createClient();
  const service = await createServiceClient();
  const audienceResult = await resolveAudience(auth, blastRow.audience_filter ?? EMPTY_TREE, { user: userClient, service, db });
  if (!audienceResult.ok) {
    return apiError("VALIDATION_ERROR", "Audience filter is no longer valid", 422, audienceResult.errors);
  }
  const { audience } = audienceResult;

  if (audience.sendable.length === 0 && audience.suppressed.length === 0) {
    return apiError("EMPTY_AUDIENCE", "No sendable recipients matched this blast's audience filter", 422);
  }

  // tenants has no tenant_id column (it IS the tenant) — see the identical
  // comment in the /preview route.
  const { data: tenantRow } = await db.raw().from("tenants").select("name").eq("id", auth.tenantId).maybeSingle();
  const tenantName = (tenantRow as { name?: string } | null)?.name;

  // 2. Materialize ALL intended email_messages rows up front — queued for
  // sendable, suppressed for the DNC-list rows (an auditable record of who
  // was NOT emailed, not a silent skip). ignoreDuplicates makes a retried
  // call a safe no-op per lead.
  function toRow(row: AudienceRow, status: "queued" | "suppressed") {
    const composed = composeRecipientEmail(blastRow.subject_template, blastRow.body_template, row.lead, tenantName);
    return {
      lead_id: row.leadId,
      source: "blast" as const,
      source_id: id,
      to_email: row.email,
      to_email_stored: row.lead.email != null ? String(row.lead.email) : null,
      subject: composed.subject,
      body_html: composed.bodyHtml,
      status,
    };
  }

  const newRows = [...audience.sendable.map((r) => toRow(r, "queued")), ...audience.suppressed.map((r) => toRow(r, "suppressed"))];

  if (newRows.length > 0) {
    const { error: upsertError } = await db
      .from("email_messages")
      .upsert(newRows, { onConflict: "source_id,lead_id", ignoreDuplicates: true });
    if (upsertError) {
      log.error({ err: upsertError, blastId: id }, "Failed to materialize email_messages rows");
      return apiServiceUnavailable("Failed to materialize recipient rows");
    }
  }

  // 3. Emit the Inngest event, set status='queued'. sendQueuedEmailBatch
  // (Phase 0) enforces tenant_email_settings.daily_send_cap on its own — the
  // worker (email-blast-send.ts) is what turns a blown cap into 'throttled'
  // and resumes automatically; this route never rejects for being over cap.
  await inngest.send({ name: "email/blast.send", data: { tenantId: auth.tenantId, blastId: id } });

  const { data: updated, error: updateError } = await db
    .from("email_blasts")
    .update({
      status: "queued",
      recipients_total: audience.sendable.length + audience.suppressed.length,
      recipients_suppressed: audience.suppressed.length,
      started_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*")
    .single();

  if (updateError) {
    log.error({ err: updateError, blastId: id }, "Failed to update blast status after send");
    return apiServiceUnavailable("Blast was queued but its status could not be updated — check email_blasts directly");
  }

  log.info({ blastId: id, sendable: audience.sendable.length, suppressed: audience.suppressed.length }, "email blast queued for send");

  return apiSuccess({ blast: updated, queued: audience.sendable.length, suppressed: audience.suppressed.length });
}
