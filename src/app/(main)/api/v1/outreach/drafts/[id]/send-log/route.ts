import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiNotFound } from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { markDraftSent } from "@/industries/_shared/features/outreach/lib/engine";

type Props = { params: Promise<{ id: string }> };

// POST /api/v1/outreach/drafts/[id]/send-log — log a manual send (human sent
// from their own inbox; this call only records it). Never sends an email.
export async function POST(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: "/api/v1/outreach/drafts/[id]/send-log" });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.OUTREACH)) return apiForbidden();

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    // No body / empty body is fine — `edited` defaults to false.
  }

  const db = await scopedClient(auth);

  const { data: draft } = await db.from("sequence_step_drafts").select("assigned_to").eq("id", id).maybeSingle();
  if (!draft) return apiNotFound("Draft");
  const draftRow = draft as unknown as { assigned_to: string | null };
  const isAdminTier = auth.role === "owner" || auth.role === "admin";
  if (!isAdminTier && draftRow.assigned_to !== auth.userId) return apiForbidden();

  const result = await markDraftSent(db, auth, id, { edited: Boolean(body.edited) });
  if (!result) return apiNotFound("Draft");

  log.info({ draftId: id, activityId: result.activityId }, "Sequence draft marked sent");
  return apiSuccess(result);
}
