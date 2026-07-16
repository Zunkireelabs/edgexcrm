import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiError,
  apiValidationError,
} from "@/lib/api/response";
import { validate, required, maxLength, isUUID } from "@/lib/api/validation";
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
  const universityId = searchParams.get("university_id");

  // The manager (?all=true) lists every program across universities, optionally
  // scoped to one; the picker always scopes to one — no university_id there means
  // "nothing to show yet" rather than leaking every tenant's programs.
  if (!includeInactive && !universityId) return apiSuccess([]);

  const db = await scopedClient(auth);
  let query = db
    .from("study_programs")
    .select("id, university_id, name, is_active, created_at")
    .order("name", { ascending: true });
  if (!includeInactive) query = query.eq("is_active", true);
  if (universityId) query = query.eq("university_id", universityId);

  const { data, error } = await query;
  if (error) return apiError("DB_ERROR", "Failed to fetch study programs", 500);
  return apiSuccess(data ?? []);
}

// Any tenant member may create — this is the inline "Create '<program>'" path from
// Add-Application, mirroring partner-colleges' any-member insert.
export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: "/api/v1/study-programs" });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.APPLICATION_TRACKING)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const { valid, errors } = validate(body, {
    university_id: [required("university_id"), isUUID()],
    name: [required("name"), maxLength(255)],
  });
  if (!valid) return apiValidationError(errors);

  const db = await scopedClient(auth);

  // university_id must belong to this tenant (scopedClient tenant-filters the check).
  const { data: university } = await db
    .from("partner_colleges")
    .select("id")
    .eq("id", body.university_id as string)
    .maybeSingle();
  if (!university) {
    return apiValidationError({ university_id: ["University not found in this tenant"] });
  }

  const trimmedName = String(body.name).trim();

  const { data, error } = await db
    .from("study_programs")
    .insert({
      university_id: body.university_id as string,
      name: trimmedName,
    })
    .select("id, university_id, name, is_active, created_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      // Idempotent create-if-missing: return the existing row instead of erroring.
      const { data: existing } = await db
        .from("study_programs")
        .select("id, university_id, name, is_active, created_at")
        .eq("university_id", body.university_id as string)
        .ilike("name", trimmedName)
        .maybeSingle();
      if (existing) return apiSuccess(existing, 200);
      return apiValidationError({ name: ["A program with this name already exists for this university"] });
    }
    log.error({ error }, "Failed to create study program");
    return apiError("DB_ERROR", "Failed to create study program", 500);
  }

  log.info({ programId: (data as { id: string }).id }, "Study program created");
  return apiSuccess(data, 201);
}
