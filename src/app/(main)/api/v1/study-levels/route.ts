import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiError,
  apiValidationError,
} from "@/lib/api/response";
import { validate, required, maxLength } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.APPLICATION_TRACKING)) return apiForbidden();

  const { searchParams } = new URL(request.url);
  const includeInactive = searchParams.get("all") === "true";

  const db = await scopedClient(auth);
  let query = db
    .from("study_levels")
    .select("id, name, sort_order, is_active, created_at")
    .order("sort_order", { ascending: true });
  if (!includeInactive) query = query.eq("is_active", true);

  const { data, error } = await query;
  if (error) return apiError("DB_ERROR", "Failed to fetch study levels", 500);
  return apiSuccess(data ?? []);
}

// Admin-only, unlike countries/courses' any-member insert — Study Level has no
// inline-create UI, so the write path stays admin-only end to end.
export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: "/api/v1/study-levels" });

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

  const { valid, errors } = validate(body, {
    name: [required("name"), maxLength(255)],
  });
  if (!valid) return apiValidationError(errors);

  const db = await scopedClient(auth);

  let sortOrder = Number(body.sort_order);
  if (!Number.isFinite(sortOrder)) {
    const { count } = await db
      .from("study_levels")
      .select("id", { count: "exact", head: true });
    sortOrder = count ?? 0;
  }

  const { data, error } = await db
    .from("study_levels")
    .insert({
      name: String(body.name).trim(),
      sort_order: sortOrder,
    })
    .select("id, name, sort_order, is_active, created_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      return apiValidationError({ name: ["A study level with this name already exists"] });
    }
    log.error({ error }, "Failed to create study level");
    return apiError("DB_ERROR", "Failed to create study level", 500);
  }

  log.info({ studyLevelId: (data as { id: string }).id }, "Study level created");
  return apiSuccess(data, 201);
}
