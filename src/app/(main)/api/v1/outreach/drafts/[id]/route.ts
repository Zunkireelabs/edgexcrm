import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiNotFound, apiError, apiValidationError } from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

type Props = { params: Promise<{ id: string }> };

// PATCH /api/v1/outreach/drafts/[id] — edit subject/body (assignee or admin, pending only)
export async function PATCH(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.OUTREACH)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const db = await scopedClient(auth);
  const { data: draft } = await db.from("sequence_step_drafts").select("*").eq("id", id).maybeSingle();
  if (!draft) return apiNotFound("Draft");
  const draftRow = draft as unknown as { assigned_to: string | null; status: string };

  const isAdminTier = auth.role === "owner" || auth.role === "admin";
  if (!isAdminTier && draftRow.assigned_to !== auth.userId) return apiForbidden();
  if (draftRow.status !== "pending") {
    return apiValidationError({ status: ["Only pending drafts can be edited"] });
  }

  const updates: Record<string, unknown> = { edited: true };
  if (body.subject !== undefined) updates.subject = String(body.subject);
  if (body.body_html !== undefined) updates.body_html = String(body.body_html);

  const { data: updated, error } = await db
    .from("sequence_step_drafts")
    .update(updates)
    .eq("id", id)
    .select("*")
    .single();

  if (error) return apiError("DB_ERROR", "Failed to update draft", 500);
  return apiSuccess(updated);
}
