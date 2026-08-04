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
import { ensureApplicationPipelineForCountry } from "@/lib/applications/pipeline-resolution";

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.APPLICATION_TRACKING)) return apiForbidden();

  const { searchParams } = new URL(request.url);
  const includeInactive = searchParams.get("all") === "true";

  const db = await scopedClient(auth);
  let query = db
    .from("countries")
    .select("id, name, description, is_active, created_at")
    .order("name", { ascending: true });
  if (!includeInactive) query = query.eq("is_active", true);

  const { data, error } = await query;
  if (error) return apiError("DB_ERROR", "Failed to fetch countries", 500);
  return apiSuccess(data ?? []);
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: "/api/v1/countries" });

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
    .from("countries")
    .insert({
      name: String(body.name).trim(),
      description: body.description ? String(body.description).trim() : null,
    })
    .select("id, name, description, is_active, created_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      return apiValidationError({ name: ["A country with this name already exists"] });
    }
    log.error({ error }, "Failed to create country");
    return apiError("DB_ERROR", "Failed to create country", 500);
  }

  const countryRow = data as { id: string; name: string };
  log.info({ countryId: countryRow.id }, "Country created");

  // Best-effort: auto-create a matching application pipeline (cloning the
  // Default pipeline's stages) so a new destination country is immediately
  // usable without an admin manually hitting "+ Create Pipeline" first.
  // Never fails the country-creation request — the country is already
  // created; a missing pipeline is recoverable via the UI.
  try {
    await ensureApplicationPipelineForCountry(db, auth.tenantId, countryRow.name);
  } catch (pipelineErr) {
    log.error({ error: pipelineErr, countryId: countryRow.id }, "Failed to auto-create application pipeline for new country");
  }

  return apiSuccess(data, 201);
}
