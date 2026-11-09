import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { apiError, apiForbidden, apiNotFound, apiSuccess, apiUnauthorized, apiValidationError } from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { createLeadNote } from "@/lib/leads/create-lead-note";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { outcomeOf, whatsappTimelineNote } from "@/industries/education-consultancy/features/home/lib/draft";
import { loadVisibleLead } from "@/industries/education-consultancy/features/home/server/visible-lead";

// POST /api/v1/home/draft-resolve  { draftId, action: "sent" | "opened" | "discarded", channel?, finalText? }
//   sent       the person sent it. Records sent_as_is vs edited (whitespace-insensitive). For WhatsApp, which we cannot confirm, this is
//              only ever called after the person pressed "Yes" on "Did you send it?": it logs "WhatsApp message (sent from your phone)"
//              with the text on the lead's timeline. Email is logged by /api/v1/email/send itself, so nothing is written here for it.
//   opened     WhatsApp was opened and the person said "No": records `opened` on the draft and writes NOTHING to the timeline.
//   discarded  the panel closed without sending.
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
  const action = body.action === "sent" || body.action === "opened" || body.action === "discarded" ? body.action : "";
  if (!draftId) return apiValidationError({ draftId: ["Required"] });
  if (!action) return apiValidationError({ action: ["Must be sent, opened or discarded"] });
  const finalText = typeof body.finalText === "string" ? body.finalText : "";
  if (action === "sent" && !finalText.trim()) return apiValidationError({ finalText: ["Required"] });

  const db = await scopedClient(auth);
  const { data } = await db.from("ai_drafts").select("lead_id, draft_text, channel, outcome").eq("id", draftId).eq("user_id", auth.userId).maybeSingle();
  const draft = data as unknown as { lead_id: string | null; draft_text: string | null; channel: string | null; outcome: string | null } | null;
  if (!draft || !draft.lead_id) return apiNotFound("Draft");
  if (draft.outcome === "sent_as_is" || draft.outcome === "edited") return apiSuccess({ already: true }); // a double click never logs twice

  const channel = body.channel === "whatsapp" || body.channel === "email" ? body.channel : draft.channel;
  const patch: Record<string, unknown> = { resolved_at: new Date().toISOString() };
  if (action === "discarded") patch.outcome = "discarded";
  else if (action === "opened") patch.outcome = "opened";
  else {
    patch.outcome = outcomeOf(draft.draft_text ?? "", finalText);
    patch.final_text = finalText;
    patch.channel = channel;
    if (channel === "whatsapp") {
      const lead = await loadVisibleLead(auth, draft.lead_id);
      if (!lead) return apiNotFound("Lead");
      const r = await createLeadNote(auth, draft.lead_id, { content: whatsappTimelineNote(finalText) }, { requestId: crypto.randomUUID() });
      if (r.kind !== "ok") return apiError("NOTE_FAILED", "Couldn't log the message on the timeline", 500);
    }
  }
  const { error } = await db.from("ai_drafts").update(patch).eq("id", draftId).eq("user_id", auth.userId);
  if (error) return apiError("DB_ERROR", "Failed to save", 500);
  return apiSuccess({ outcome: patch.outcome });
}
