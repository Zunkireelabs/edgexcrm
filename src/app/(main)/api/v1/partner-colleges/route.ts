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
    .from("partner_colleges")
    .select("id, name, description, is_active, created_at")
    .order("name", { ascending: true });
  if (!includeInactive) query = query.eq("is_active", true);

  const { data, error } = await query;
  if (error) return apiError("DB_ERROR", "Failed to fetch partner colleges", 500);
  return apiSuccess(data ?? []);
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: "/api/v1/partner-colleges" });

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
    name: [required("name"), maxLength(255)],
  });
  if (!valid) return apiValidationError(errors);

  const db = await scopedClient(auth);
  const { data, error } = await db
    .from("partner_colleges")
    .insert({
      name: String(body.name).trim(),
      description: body.description ? String(body.description).trim() : null,
    })
    .select("id, name, description, is_active, created_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      return apiValidationError({ name: ["A college with this name already exists"] });
    }
    log.error({ error }, "Failed to create partner college");
    return apiError("DB_ERROR", "Failed to create partner college", 500);
  }

  log.info({ collegeId: (data as { id: string }).id }, "Partner college created");
  return apiSuccess(data, 201);
}
