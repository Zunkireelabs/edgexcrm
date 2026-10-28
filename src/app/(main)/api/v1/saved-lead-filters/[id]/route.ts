import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiNotFound, apiError, apiValidationError, apiConflict } from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { renameSavedFilterSchema, zodDetails } from "@/industries/education-consultancy/features/saved-lead-filters/lib/saved-filter-schema";

// /api/v1/saved-lead-filters/[id] — rename or delete ONE of the caller's own saved filters.
// Both filter on user_id (not just tenant_id): the tenant filter alone would let a user touch a colleague's filter.

interface Props {
  params: Promise<{ id: string }>;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.SAVED_LEAD_FILTERS)) return apiForbidden();
  if (!UUID_REGEX.test(id)) return apiValidationError({ id: ["Invalid filter id"] });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }
  const parsed = renameSavedFilterSchema.safeParse(body);
  if (!parsed.success) return apiValidationError(zodDetails(parsed.error));

  const db = await scopedClient(auth);
  const { data, error } = await db
    .from("saved_lead_filters")
    .update({ name: parsed.data.name, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", auth.userId)
    .select("id, name, filter_tree, created_at")
    .maybeSingle();
  if (error) {
    if (error.code === "23505") return apiConflict("You already have a saved filter with that name.");
    return apiError("DB_ERROR", "Failed to rename the filter", 500);
  }
  if (!data) return apiNotFound("Saved filter");
  return apiSuccess(data);
}

export async function DELETE(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.SAVED_LEAD_FILTERS)) return apiForbidden();
  if (!UUID_REGEX.test(id)) return apiValidationError({ id: ["Invalid filter id"] });

  const db = await scopedClient(auth);
  const { data, error } = await db
    .from("saved_lead_filters")
    .delete()
    .eq("id", id)
    .eq("user_id", auth.userId)
    .select("id")
    .maybeSingle();
  if (error) return apiError("DB_ERROR", "Failed to delete the filter", 500);
  if (!data) return apiNotFound("Saved filter");
  return apiSuccess({ id: data.id, deleted: true });
}
