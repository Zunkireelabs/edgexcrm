import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { apiError, apiForbidden, apiNotFound, apiSuccess, apiUnauthorized, apiValidationError } from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { applyLeadPatch } from "@/lib/leads/apply-lead-patch";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { buildFieldPatch, NOTE_FIELDS, type NoteField } from "@/industries/education-consultancy/features/home/lib/note-extract";
import { loadVisibleLead } from "@/industries/education-consultancy/features/home/server/visible-lead";

// POST /api/v1/home/note-save  { leadId, draftId?, fields:[{field,to}], proposedFields?:string[], callbackAt?, nextListId? }
// The lead-update step of the call log when the person ticked Orca's suggestions. It runs AFTER the call and note inserts (the
// touch-signals trigger would otherwise overwrite callback_due_at, see call-log.ts). Everything goes through applyLeadPatch, so it
// is a normal edit as the user, undoable from the timeline, stamped `ai_suggested` on its audit row.
export async function POST(request: NextRequest) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.EDU_HOME)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ body: ["Invalid JSON body"] });
  }
  const leadId = typeof body.leadId === "string" ? body.leadId : "";
  if (!leadId) return apiValidationError({ leadId: ["Required"] });

  const rawFields = Array.isArray(body.fields) ? body.fields : [];
  const ticked: Array<{ field: NoteField; to: string }> = [];
  for (const f of rawFields) {
    const r = f as { field?: unknown; to?: unknown };
    if (typeof r.field !== "string" || !(r.field in NOTE_FIELDS) || r.field === "stage" || typeof r.to !== "string") {
      return apiValidationError({ fields: ["Unknown field"] });
    }
    ticked.push({ field: r.field as NoteField, to: r.to });
  }

  const lead = await loadVisibleLead(auth, leadId);
  if (!lead) return apiNotFound("Lead");

  const patch = buildFieldPatch(ticked, { custom_fields: lead.custom_fields, destinations: lead.destinations });
  if (typeof body.callbackAt === "string" && body.callbackAt) patch.callback_due_at = body.callbackAt;
  if (typeof body.nextListId === "string" && body.nextListId) patch.list_id = body.nextListId;

  if (Object.keys(patch).length > 0) {
    const outcome = await applyLeadPatch(auth, leadId, patch, {
      requestId: crypto.randomUUID(),
      ip: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
      aiSuggested: ticked.length > 0,
    });
    if (outcome.kind === "not_found") return apiNotFound("Lead");
    if (outcome.kind === "forbidden") return apiForbidden();
    if (outcome.kind === "validation") return apiValidationError(outcome.errors);
    if (outcome.kind === "db_error") return apiError("DB_ERROR", "Failed to save", 500);
  }

  // Record what was proposed vs kept. Best effort: the lead is already saved, so a failure here never fails the save.
  if (typeof body.draftId === "string" && body.draftId) {
    const db = await scopedClient(auth);
    await db
      .from("ai_drafts")
      .update({ kept: { fields: ticked.map((t) => t.field) }, outcome: "fields_saved", resolved_at: new Date().toISOString() })
      .eq("id", body.draftId)
      .eq("user_id", auth.userId);
  }
  return apiSuccess({ saved: Object.keys(patch) });
}
