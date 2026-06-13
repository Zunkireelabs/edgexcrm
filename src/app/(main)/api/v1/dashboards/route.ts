import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import {
  apiSuccess,
  apiForbidden,
  apiUnauthorized,
  apiError,
  apiValidationError,
} from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { WIDGET_KEYS } from "@/industries/education-consultancy/features/insights/lib/widget-catalog";
import type { Dashboard } from "@/types/database";

// GET /api/v1/dashboards
// Returns dashboards visible to the caller:
//   admin/owner  → all tenant dashboards
//   member       → only dashboards granted to their position
export async function GET() {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.INSIGHTS)) return apiForbidden();

  const isAdmin = requireAdmin(auth);
  const db = await scopedClient(auth);

  const { data, error } = await db
    .from("dashboards")
    .select("*")
    .order("sort_order", { ascending: true });

  if (error) return apiError("DB_ERROR", "Failed to fetch dashboards", 500);

  const allDashboards = ((data ?? []) as unknown as Dashboard[]);

  const visible = isAdmin
    ? allDashboards
    : allDashboards.filter(
        (d) =>
          auth.positionId !== null &&
          d.granted_position_ids.includes(auth.positionId)
      );

  return apiSuccess(visible);
}

// POST /api/v1/dashboards (admin only)
// Body: { name, description?, widgets: string[], granted_position_ids: string[] }
export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: "/api/v1/dashboards" });

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

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return apiValidationError({ name: ["Name is required"] });

  const widgets = body.widgets;
  if (!Array.isArray(widgets) || widgets.some((k) => typeof k !== "string")) {
    return apiValidationError({ widgets: ["widgets must be an array of strings"] });
  }
  const invalidWidgets = (widgets as string[]).filter((k) => !WIDGET_KEYS.includes(k));
  if (invalidWidgets.length > 0) {
    return apiValidationError({ widgets: [`Unknown widget keys: ${invalidWidgets.join(", ")}`] });
  }

  const grantedIds = body.granted_position_ids;
  if (!Array.isArray(grantedIds) || grantedIds.some((k) => typeof k !== "string")) {
    return apiValidationError({ granted_position_ids: ["must be an array of strings"] });
  }

  const db = await scopedClient(auth);

  // Validate that each position id belongs to this tenant
  if ((grantedIds as string[]).length > 0) {
    const { data: existing } = await db
      .from("positions")
      .select("id");
    const validPositionIds = new Set(((existing ?? []) as unknown as Array<{ id: string }>).map((p) => p.id));
    const invalid = (grantedIds as string[]).filter((id) => !validPositionIds.has(id));
    if (invalid.length > 0) {
      return apiValidationError({ granted_position_ids: [`Unknown position ids: ${invalid.join(", ")}`] });
    }
  }

  const description =
    typeof body.description === "string" && body.description.trim()
      ? body.description.trim()
      : null;

  const { data: created, error } = await db
    .from("dashboards")
    .insert({
      name,
      description,
      widgets,
      granted_position_ids: grantedIds,
      sort_order: 0,
      created_by: auth.userId,
    })
    .select()
    .single();

  if (error) {
    log.error({ error }, "Failed to create dashboard");
    return apiError("DB_ERROR", "Failed to create dashboard", 500);
  }

  log.info({ dashboardId: (created as unknown as Dashboard).id }, "Dashboard created");
  return apiSuccess(created, 201);
}
