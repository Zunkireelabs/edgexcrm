import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { apiError, apiForbidden, apiNotFound, apiSuccess, apiUnauthorized, apiValidationError } from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { applyLeadPatch } from "@/lib/leads/apply-lead-patch";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { buildUndoPatch, type UndoItem } from "@/industries/education-consultancy/features/home/lib/note-extract";
import { loadVisibleLead } from "@/industries/education-consultancy/features/home/server/visible-lead";

// POST /api/v1/home/note-undo  { draftId }
// Puts back ONLY the fields Orca wrote from a note (never the call, the note, the call-back or the stage), and only a field that
// still holds what Orca wrote: a later human edit is left alone. The values come from the draft row, never from the client.
// An ordinary edit as the user, so it is audited like any other.
const UNDO_WINDOW_MS = 60 * 60_000;

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
  const draftId = typeof body.draftId === "string" ? body.draftId : "";
  if (!draftId) return apiValidationError({ draftId: ["Required"] });

  const db = await scopedClient(auth);
  const { data } = await db.from("ai_drafts").select("lead_id, kept, resolved_at").eq("id", draftId).eq("user_id", auth.userId).maybeSingle();
  const draft = data as unknown as { lead_id: string | null; kept: { undo?: UndoItem[]; undone_at?: string } | null; resolved_at: string | null } | null;
  if (!draft || !draft.lead_id || !draft.kept?.undo?.length) return apiNotFound("Draft");
  if (draft.kept.undone_at) return apiValidationError({ draftId: ["Already undone"] });
  if (!draft.resolved_at || Date.now() - Date.parse(draft.resolved_at) > UNDO_WINDOW_MS) return apiValidationError({ draftId: ["Too late to undo"] });

  const lead = await loadVisibleLead(auth, draft.lead_id);
  if (!lead) return apiNotFound("Lead");

  const { patch, restored, skipped } = buildUndoPatch(draft.kept.undo, lead as unknown as Parameters<typeof buildUndoPatch>[1]);
  if (Object.keys(patch).length > 0) {
    const outcome = await applyLeadPatch(auth, draft.lead_id, patch, { requestId: crypto.randomUUID(), ip: request.headers.get("x-forwarded-for"), userAgent: request.headers.get("user-agent") });
    if (outcome.kind === "not_found") return apiNotFound("Lead");
    if (outcome.kind === "forbidden") return apiForbidden();
    if (outcome.kind === "validation") return apiValidationError(outcome.errors);
    if (outcome.kind === "db_error") return apiError("DB_ERROR", "Failed to undo", 500);
  }
  await db.from("ai_drafts").update({ kept: { ...draft.kept, undone_at: new Date().toISOString(), restored, skipped } }).eq("id", draftId).eq("user_id", auth.userId);
  return apiSuccess({ restored, skipped });
}
