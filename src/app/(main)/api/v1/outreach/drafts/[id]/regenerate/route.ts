import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiNotFound, apiValidationError, apiError } from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { isOutreachDraftEnabledForTenant } from "@/lib/ai/flag";
import { draftSequenceEmail } from "@/lib/ai/draft-email";
import { logger } from "@/lib/logger";
import type { LeadTemplateContext } from "@/industries/_shared/features/outreach/lib/engine";

type Props = { params: Promise<{ id: string }> };

// POST /api/v1/outreach/drafts/[id]/regenerate — on-demand "Draft with AI".
// Explicitly requests an AI draft for this lead/step (unlike fire-time
// generation, which only uses AI when the step itself is opted into auto-AI).
export async function POST(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.OUTREACH)) return apiForbidden();
  // Defense-in-depth — the UI hides the button when the gate is off.
  if (!(await isOutreachDraftEnabledForTenant(auth.tenantId))) return apiForbidden();

  const db = await scopedClient(auth);

  const { data: draft } = await db
    .from("sequence_step_drafts")
    .select("*, sequence_enrollments!inner(sequence_id)")
    .eq("id", id)
    .maybeSingle();
  if (!draft) return apiNotFound("Draft");
  const draftRow = draft as unknown as {
    id: string;
    lead_id: string;
    step_id: string | null;
    step_order: number;
    assigned_to: string | null;
    status: string;
    sequence_enrollments: { sequence_id: string } | null;
  };

  const isAdminTier = auth.role === "owner" || auth.role === "admin";
  if (!isAdminTier && draftRow.assigned_to !== auth.userId) return apiForbidden();
  if (draftRow.status !== "pending") {
    return apiValidationError({ status: ["Only pending drafts can be regenerated"] });
  }
  if (!draftRow.step_id || !draftRow.sequence_enrollments) {
    return apiError("STEP_MISSING", "This draft's step no longer exists", 409);
  }
  const sequenceId = draftRow.sequence_enrollments.sequence_id;
  const stepId = draftRow.step_id;

  const [{ data: step }, { data: lead }, { data: sequence }, { count: totalSteps }, { data: tenantRow }] = await Promise.all([
    db.from("email_sequence_steps").select("ai_instructions").eq("id", stepId).maybeSingle(),
    db
      .from("leads")
      .select("first_name, last_name, email, phone, city, country, custom_fields")
      .eq("id", draftRow.lead_id)
      .maybeSingle(),
    db.from("email_sequences").select("name, description").eq("id", sequenceId).maybeSingle(),
    db.from("email_sequence_steps").select("id", { count: "exact", head: true }).eq("sequence_id", sequenceId),
    db.fromGlobal("tenants").select("name").eq("id", auth.tenantId).maybeSingle(),
  ]);

  if (!lead || !sequence) return apiNotFound("Draft");

  try {
    const result = await draftSequenceEmail({
      tenantId: auth.tenantId,
      tenantName: (tenantRow as { name: string } | null)?.name ?? "",
      lead: lead as unknown as LeadTemplateContext,
      sequence: sequence as unknown as { name: string; description: string | null },
      step: {
        stepOrder: draftRow.step_order,
        totalSteps: totalSteps ?? draftRow.step_order,
        instructions: (step as { ai_instructions: string | null } | null)?.ai_instructions ?? null,
      },
    });

    const { data: updated, error } = await db
      .from("sequence_step_drafts")
      .update({ subject: result.subject, body_html: result.body_html, draft_source: "ai", edited: false })
      .eq("id", id)
      .select("*")
      .single();
    if (error) return apiError("DB_ERROR", "Failed to save the regenerated draft", 500);

    return apiSuccess(updated);
  } catch (err) {
    logger.error({ err, draftId: id }, "outreach draft regeneration failed");
    return apiError("DRAFT_FAILED", "AI drafting failed. Try again or write the draft manually.", 502);
  }
}
