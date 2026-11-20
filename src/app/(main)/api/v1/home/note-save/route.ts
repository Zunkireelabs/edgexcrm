import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { apiError, apiForbidden, apiNotFound, apiSuccess, apiUnauthorized, apiValidationError } from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { applyLeadPatch } from "@/lib/leads/apply-lead-patch";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { buildFieldPatch, captureUndo, NOTE_FIELDS, type NoteField } from "@/industries/education-consultancy/features/home/lib/note-extract";
import { loadVisibleLead } from "@/industries/education-consultancy/features/home/server/visible-lead";

// POST /api/v1/home/note-save  { leadId, draftId?, fields:[{field,to}], proposedFields?:string[], callbackAt?, nextListId? }
// The lead-update step of the call log when the person ticked Orca's suggestions. It runs AFTER the call and note inserts (the
// touch-signals trigger would otherwise overwrite callback_due_at, see call-log.ts). Everything goes through applyLeadPatch, so it
// is a normal edit as the user, stamped `ai_suggested` on its audit row, and Undo (POST /home/note-undo) puts back just those fields.
// If the stage move alone is refused (the Prospects rule), everything else still saves and `stageBlocked` carries the reason.
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

  // F9: what each ticked field held BEFORE and what we write, kept on the draft row so Undo can put back exactly that.
  const undoItems = captureUndo(ticked, lead as unknown as Parameters<typeof captureUndo>[1], patch);

  const opts = { requestId: crypto.randomUUID(), ip: request.headers.get("x-forwarded-for"), userAgent: request.headers.get("user-agent"), aiSuggested: ticked.length > 0 };
  let stageBlocked: string | null = null;
  if (Object.keys(patch).length > 0) {
    let outcome = await applyLeadPatch(auth, leadId, patch, opts);
    // F1: the stage rule (e.g. Prospects needs the highest qualification) must never cost the person every ticked field.
    // If only the stage is refused, save the rest and say why.
    if (patch.list_id && (outcome.kind === "forbidden" || (outcome.kind === "validation" && ("academic" in outcome.errors || "list_id" in outcome.errors)))) {
      stageBlocked = outcome.kind === "validation" ? Object.values(outcome.errors).flat()[0] ?? "That stage move isn't allowed yet." : outcome.message ?? "You can't move this lead to that stage.";
      const { list_id: _blocked, ...rest } = patch;
      void _blocked;
      outcome = Object.keys(rest).length > 0 ? await applyLeadPatch(auth, leadId, rest, opts) : { kind: "ok", lead: lead as never, changes: {}, previousValues: {} };
    }
    if (outcome.kind === "not_found") return apiNotFound("Lead");
    if (outcome.kind === "forbidden") return apiForbidden();
    if (outcome.kind === "validation") return apiValidationError(outcome.errors);
    if (outcome.kind === "db_error") return apiError("DB_ERROR", "Failed to save", 500);
  }

  // Record what was proposed vs kept. Best effort: the lead is already saved, so a failure here never fails the save.
  let undoDraftId: string | null = null;
  if (typeof body.draftId === "string" && body.draftId) {
    const db = await scopedClient(auth);
    const { error } = await db
      .from("ai_drafts")
      .update({ kept: { fields: ticked.map((t) => t.field), undo: undoItems }, outcome: "fields_saved", resolved_at: new Date().toISOString() })
      .eq("id", body.draftId)
      .eq("user_id", auth.userId);
    if (!error && undoItems.length > 0) undoDraftId = body.draftId;
  }
  return apiSuccess({ saved: Object.keys(patch).filter((k) => k !== "list_id" || !stageBlocked), stageBlocked, leadId, undoDraftId });
}
