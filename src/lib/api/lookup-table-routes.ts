import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiError,
  apiValidationError,
} from "@/lib/api/response";
import { validate, required, maxLength } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

interface LookupTableConfig {
  /** DB table name, e.g. "intake_months" */
  table: string;
  /** Singular, lowercase, used in error messages: "an intake month" */
  itemLabel: string;
  /** For request-logger path tags, e.g. "/api/v1/intake-months" */
  routePath: string;
  /** Extra sort column applied before name, e.g. "sort_order" (intake_months only) */
  sortColumn?: string;
}

interface RouteParams {
  params: Promise<{ id: string }>;
}

// Simple admin-managed name/description/is_active lookup tables (intake
// months, intake years, ...) all share the exact same CRUD shape. This
// factory is the single implementation both intake-months and intake-years
// routes delegate to, so a fix to one applies to both automatically.
export function createLookupTableListRoutes({ table, itemLabel, routePath, sortColumn }: LookupTableConfig) {
  async function GET(request: NextRequest) {
    const auth = await authenticateRequest();
    if (!auth) return apiUnauthorized();
    if (!getFeatureAccess(auth.industryId, FEATURES.APPLICATION_TRACKING)) return apiForbidden();

    const { searchParams } = new URL(request.url);
    const includeInactive = searchParams.get("all") === "true";

    const db = await scopedClient(auth);
    let query = db.from(table).select("id, name, description, is_active, created_at");
    if (sortColumn) query = query.order(sortColumn, { ascending: true, nullsFirst: false });
    query = query.order("name", { ascending: true });
    if (!includeInactive) query = query.eq("is_active", true);

    const { data, error } = await query;
    if (error) return apiError("DB_ERROR", `Failed to fetch ${itemLabel}s`, 500);
    return apiSuccess(data ?? []);
  }

  async function POST(request: NextRequest) {
    const requestId = crypto.randomUUID();
    const log = createRequestLogger({ requestId, method: "POST", path: routePath });

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
      .from(table)
      .insert({
        name: String(body.name).trim(),
        description: body.description ? String(body.description).trim() : null,
      })
      .select("id, name, description, is_active, created_at")
      .single();

    if (error) {
      if (error.code === "23505") {
        return apiValidationError({ name: [`An ${itemLabel} with this name already exists`] });
      }
      log.error({ error }, `Failed to create ${itemLabel}`);
      return apiError("DB_ERROR", `Failed to create ${itemLabel}`, 500);
    }

    log.info({ id: (data as { id: string }).id }, `${itemLabel} created`);
    return apiSuccess(data, 201);
  }

  return { GET, POST };
}

export function createLookupTableItemRoutes({ table, itemLabel, routePath }: LookupTableConfig) {
  async function PATCH(request: NextRequest, { params }: RouteParams) {
    const { id } = await params;
    const requestId = crypto.randomUUID();
    const log = createRequestLogger({ requestId, method: "PATCH", path: `${routePath}/${id}` });

    const auth = await authenticateRequest();
    if (!auth) return apiUnauthorized();
    if (!getFeatureAccess(auth.industryId, FEATURES.APPLICATION_TRACKING)) return apiForbidden();
    if (!requireAdmin(auth)) return apiForbidden();

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
    }

    const db = await scopedClient(auth);
    const { data: existing } = await db.from(table).select("id").eq("id", id).maybeSingle();
    if (!existing) return apiNotFound(itemLabel);

    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) {
      const trimmed = String(body.name ?? "").trim();
      if (!trimmed) return apiValidationError({ name: ["name is required"] });
      patch.name = trimmed;
    }
    if (body.description !== undefined) patch.description = body.description ? String(body.description).trim() : null;
    if (body.is_active !== undefined) patch.is_active = Boolean(body.is_active);

    if (Object.keys(patch).length === 0) {
      const { data: unchanged } = await db
        .from(table)
        .select("id, name, description, is_active, created_at")
        .eq("id", id)
        .maybeSingle();
      return apiSuccess(unchanged);
    }

    const { data, error } = await db
      .from(table)
      .update(patch)
      .eq("id", id)
      .select("id, name, description, is_active, created_at")
      .single();

    if (error) {
      if (error.code === "23505") {
        return apiValidationError({ name: [`An ${itemLabel} with this name already exists`] });
      }
      log.error({ error }, `Failed to update ${itemLabel}`);
      return apiError("DB_ERROR", `Failed to update ${itemLabel}`, 500);
    }

    log.info({ id }, `${itemLabel} updated`);
    return apiSuccess(data);
  }

  async function DELETE(_request: NextRequest, { params }: RouteParams) {
    const { id } = await params;
    const requestId = crypto.randomUUID();
    const log = createRequestLogger({ requestId, method: "DELETE", path: `${routePath}/${id}` });

    const auth = await authenticateRequest();
    if (!auth) return apiUnauthorized();
    if (!getFeatureAccess(auth.industryId, FEATURES.APPLICATION_TRACKING)) return apiForbidden();
    if (!requireAdmin(auth)) return apiForbidden();

    const db = await scopedClient(auth);
    const { data: existing } = await db.from(table).select("id").eq("id", id).maybeSingle();
    if (!existing) return apiNotFound(itemLabel);

    const { error } = await db.from(table).delete().eq("id", id);
    if (error) {
      log.error({ error }, `Failed to delete ${itemLabel}`);
      return apiError("DB_ERROR", `Failed to delete ${itemLabel}`, 500);
    }

    log.info({ id }, `${itemLabel} deleted`);
    return apiSuccess({ id });
  }

  return { PATCH, DELETE };
}
