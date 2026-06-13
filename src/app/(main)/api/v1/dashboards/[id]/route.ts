import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import {
  apiSuccess,
  apiForbidden,
  apiUnauthorized,
  apiNotFound,
  apiError,
  apiValidationError,
} from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { WIDGET_KEYS } from "@/industries/education-consultancy/features/insights/lib/widget-catalog";
import type { Dashboard } from "@/types/database";

// GET /api/v1/dashboards/[id]
// Members must be in granted_position_ids (or admin).
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.INSIGHTS)) return apiForbidden();

  const isAdmin = requireAdmin(auth);
  const db = await scopedClient(auth);

  const { data, error } = await db
    .from("dashboards")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) return apiError("DB_ERROR", "Failed to fetch dashboard", 500);
  if (!data) return apiNotFound("Dashboard");

  const dashboard = data as unknown as Dashboard;

  if (
    !isAdmin &&
    (auth.positionId === null || !dashboard.granted_position_ids.includes(auth.positionId))
  ) {
    return apiNotFound("Dashboard");
  }

  return apiSuccess(dashboard);
}

// PATCH /api/v1/dashboards/[id] (admin only)
// Partial update: name, description, widgets, granted_position_ids, sort_order
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "PATCH", path: `/api/v1/dashboards/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.INSIGHTS)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ body: ["Invalid JSON body"] });
  }

  const updates: Record<string, unknown> = {};

  if ("name" in body) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return apiValidationError({ name: ["Name must not be empty"] });
    updates.name = name;
  }

  if ("description" in body) {
    updates.description =
      typeof body.description === "string" && body.description.trim()
        ? body.description.trim()
        : null;
  }

  if ("widgets" in body) {
    const widgets = body.widgets;
    if (!Array.isArray(widgets) || widgets.some((k) => typeof k !== "string")) {
      return apiValidationError({ widgets: ["widgets must be an array of strings"] });
    }
    const invalid = (widgets as string[]).filter((k) => !WIDGET_KEYS.includes(k));
    if (invalid.length > 0) {
      return apiValidationError({ widgets: [`Unknown widget keys: ${invalid.join(", ")}`] });
    }
    updates.widgets = widgets;
  }

  if ("granted_position_ids" in body) {
    const grantedIds = body.granted_position_ids;
    if (!Array.isArray(grantedIds) || grantedIds.some((k) => typeof k !== "string")) {
      return apiValidationError({ granted_position_ids: ["must be an array of strings"] });
    }
    if ((grantedIds as string[]).length > 0) {
      const db = await scopedClient(auth);
      const { data: existing } = await db.from("positions").select("id");
      const validIds = new Set(((existing ?? []) as unknown as Array<{ id: string }>).map((p) => p.id));
      const invalid = (grantedIds as string[]).filter((pid) => !validIds.has(pid));
      if (invalid.length > 0) {
        return apiValidationError({ granted_position_ids: [`Unknown position ids: ${invalid.join(", ")}`] });
      }
    }
    updates.granted_position_ids = grantedIds;
  }

  if ("sort_order" in body) {
    if (typeof body.sort_order !== "number") {
      return apiValidationError({ sort_order: ["sort_order must be a number"] });
    }
    updates.sort_order = body.sort_order;
  }

  if (Object.keys(updates).length === 0) {
    return apiValidationError({ body: ["No updatable fields provided"] });
  }

  updates.updated_at = new Date().toISOString();

  const db = await scopedClient(auth);
  const { data: updated, error } = await db
    .from("dashboards")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    log.error({ error }, "Failed to update dashboard");
    return apiError("DB_ERROR", "Failed to update dashboard", 500);
  }
  if (!updated) return apiNotFound("Dashboard");

  log.info({ dashboardId: id }, "Dashboard updated");
  return apiSuccess(updated);
}

// DELETE /api/v1/dashboards/[id] (admin only)
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "DELETE", path: `/api/v1/dashboards/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.INSIGHTS)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  const db = await scopedClient(auth);
  const { error } = await db
    .from("dashboards")
    .delete()
    .eq("id", id);

  if (error) {
    log.error({ error }, "Failed to delete dashboard");
    return apiError("DB_ERROR", "Failed to delete dashboard", 500);
  }

  log.info({ dashboardId: id }, "Dashboard deleted");
  return apiSuccess({ deleted: true });
}
