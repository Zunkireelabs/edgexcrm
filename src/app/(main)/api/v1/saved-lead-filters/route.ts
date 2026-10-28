import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiError, apiValidationError, apiConflict } from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import {
  createSavedFilterSchema,
  MAX_SAVED_FILTERS_PER_USER,
  zodDetails,
} from "@/industries/education-consultancy/features/saved-lead-filters/lib/saved-filter-schema";

// /api/v1/saved-lead-filters (migration 279) — a user's own named Leads filters. Private: every query is
// scoped to the signed-in user as well as the tenant, so nobody sees or edits another person's filters.
//   GET   → the caller's saved filters, oldest first
//   POST  { name, filter_tree } → save the current filter under a name (unique per user, case-insensitive)

const COLUMNS = "id, name, filter_tree, created_at";

export async function GET() {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.SAVED_LEAD_FILTERS)) return apiForbidden();

  const db = await scopedClient(auth);
  const { data, error } = await db
    .from("saved_lead_filters")
    .select(COLUMNS)
    .eq("user_id", auth.userId)
    .order("created_at", { ascending: true });
  if (error) return apiError("DB_ERROR", "Failed to load saved filters", 500);
  return apiSuccess(data ?? []);
}

export async function POST(request: NextRequest) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.SAVED_LEAD_FILTERS)) return apiForbidden();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }
  const parsed = createSavedFilterSchema.safeParse(body);
  if (!parsed.success) return apiValidationError(zodDetails(parsed.error));

  const db = await scopedClient(auth);

  const { count, error: countError } = await db
    .from("saved_lead_filters")
    .select("id", { count: "exact", head: true })
    .eq("user_id", auth.userId);
  if (countError) return apiError("DB_ERROR", "Failed to save the filter", 500);
  if ((count ?? 0) >= MAX_SAVED_FILTERS_PER_USER) {
    return apiConflict(`You can keep up to ${MAX_SAVED_FILTERS_PER_USER} saved filters. Delete one to save another.`);
  }

  const { data, error } = await db
    .from("saved_lead_filters")
    .insert({ user_id: auth.userId, name: parsed.data.name, filter_tree: parsed.data.filter_tree })
    .select(COLUMNS)
    .single();
  if (error) {
    // 23505 = the per-user unique name index.
    if (error.code === "23505") return apiConflict("You already have a saved filter with that name.");
    return apiError("DB_ERROR", "Failed to save the filter", 500);
  }
  return apiSuccess(data, 201);
}
