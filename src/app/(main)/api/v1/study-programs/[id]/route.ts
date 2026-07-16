import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiError,
  apiValidationError,
} from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

interface Props {
  params: Promise<{ id: string }>;
}

// Admin-only, unlike POST — cleanup/reassignment is a Settings-manager operation.
export async function PATCH(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "PATCH", path: `/api/v1/study-programs/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.APPLICATION_TRACKING)) return apiForbidden();
  if (auth.role !== "owner" && auth.role !== "admin") return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const db = await scopedClient(auth);
  const { data: existing } = await db.from("study_programs").select("id").eq("id", id).maybeSingle();
  if (!existing) return apiNotFound("Study program");

  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const trimmed = String(body.name ?? "").trim();
    if (!trimmed) return apiValidationError({ name: ["name is required"] });
    patch.name = trimmed;
  }
  if (body.university_id !== undefined) {
    const { data: university } = await db
      .from("partner_colleges")
      .select("id")
      .eq("id", body.university_id as string)
      .maybeSingle();
    if (!university) return apiValidationError({ university_id: ["University not found in this tenant"] });
    patch.university_id = body.university_id;
  }
  if (body.is_active !== undefined) patch.is_active = Boolean(body.is_active);

  if (Object.keys(patch).length === 0) {
    const { data: unchanged } = await db.from("study_programs").select("id, university_id, name, is_active, created_at").eq("id", id).maybeSingle();
    return apiSuccess(unchanged);
  }

  const { data, error } = await db
    .from("study_programs")
    .update(patch)
    .eq("id", id)
    .select("id, university_id, name, is_active, created_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      return apiValidationError({ name: ["A program with this name already exists for this university"] });
    }
    log.error({ error }, "Failed to update study program");
    return apiError("DB_ERROR", "Failed to update study program", 500);
  }

  log.info({ programId: id }, "Study program updated");
  return apiSuccess(data);
}

export async function DELETE(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "DELETE", path: `/api/v1/study-programs/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.APPLICATION_TRACKING)) return apiForbidden();
  if (auth.role !== "owner" && auth.role !== "admin") return apiForbidden();

  const db = await scopedClient(auth);
  const { data: existing } = await db.from("study_programs").select("id").eq("id", id).maybeSingle();
  if (!existing) return apiNotFound("Study program");

  const { error } = await db.from("study_programs").delete().eq("id", id);
  if (error) {
    log.error({ error }, "Failed to delete study program");
    return apiError("DB_ERROR", "Failed to delete study program", 500);
  }

  log.info({ programId: id }, "Study program deleted");
  return apiSuccess({ id });
}
