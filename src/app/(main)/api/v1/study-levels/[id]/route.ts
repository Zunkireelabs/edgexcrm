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

export async function PATCH(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "PATCH", path: `/api/v1/study-levels/${id}` });

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
  const { data: existing } = await db.from("study_levels").select("id").eq("id", id).maybeSingle();
  if (!existing) return apiNotFound("Study level");

  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const trimmed = String(body.name ?? "").trim();
    if (!trimmed) return apiValidationError({ name: ["name is required"] });
    patch.name = trimmed;
  }
  if (body.sort_order !== undefined) {
    const n = Number(body.sort_order);
    if (Number.isFinite(n)) patch.sort_order = n;
  }
  if (body.is_active !== undefined) patch.is_active = Boolean(body.is_active);

  if (Object.keys(patch).length === 0) {
    const { data: unchanged } = await db.from("study_levels").select("id, name, sort_order, is_active, created_at").eq("id", id).maybeSingle();
    return apiSuccess(unchanged);
  }

  const { data, error } = await db
    .from("study_levels")
    .update(patch)
    .eq("id", id)
    .select("id, name, sort_order, is_active, created_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      return apiValidationError({ name: ["A study level with this name already exists"] });
    }
    log.error({ error }, "Failed to update study level");
    return apiError("DB_ERROR", "Failed to update study level", 500);
  }

  log.info({ studyLevelId: id }, "Study level updated");
  return apiSuccess(data);
}

export async function DELETE(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "DELETE", path: `/api/v1/study-levels/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.APPLICATION_TRACKING)) return apiForbidden();
  if (auth.role !== "owner" && auth.role !== "admin") return apiForbidden();

  const db = await scopedClient(auth);
  const { data: existing } = await db.from("study_levels").select("id").eq("id", id).maybeSingle();
  if (!existing) return apiNotFound("Study level");

  const { error } = await db.from("study_levels").delete().eq("id", id);
  if (error) {
    log.error({ error }, "Failed to delete study level");
    return apiError("DB_ERROR", "Failed to delete study level", 500);
  }

  log.info({ studyLevelId: id }, "Study level deleted");
  return apiSuccess({ id });
}
