import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiNotFound, apiError, apiValidationError } from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { unenrollLead } from "@/industries/_shared/features/outreach/lib/engine";

const VALID_ACTIONS = ["pause", "resume", "unenroll"] as const;
type Action = (typeof VALID_ACTIONS)[number];

type Props = { params: Promise<{ id: string }> };

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

  const action = body.action;
  if (typeof action !== "string" || !VALID_ACTIONS.includes(action as Action)) {
    return apiValidationError({ action: ["Must be one of: pause, resume, unenroll"] });
  }

  const db = await scopedClient(auth);
  const { data: enrollment } = await db.from("sequence_enrollments").select("*").eq("id", id).maybeSingle();
  if (!enrollment) return apiNotFound("Enrollment");
  const enrollmentRow = enrollment as unknown as { assigned_to: string | null };

  const isAdminTier = auth.role === "owner" || auth.role === "admin";
  if (!isAdminTier && enrollmentRow.assigned_to !== auth.userId) return apiForbidden();

  if (action === "unenroll") {
    await unenrollLead(db, id);
  } else {
    const status = action === "pause" ? "paused" : "active";
    const { error } = await db.from("sequence_enrollments").update({ status }).eq("id", id);
    if (error) return apiError("DB_ERROR", "Failed to update enrollment", 500);
  }

  const { data: updated } = await db.from("sequence_enrollments").select("*").eq("id", id).maybeSingle();
  return apiSuccess(updated);
}
