import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { apiError, apiForbidden, apiSuccess, apiUnauthorized, apiValidationError } from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { ASSIGNMENT_MODES, type AssignmentMode } from "@/industries/education-consultancy/features/home/lib/assignment/outcome";
import { loadAssignmentSettings } from "@/industries/education-consultancy/features/home/server/assignment/settings";

// GET/PUT /api/v1/settings/lead-assignment — owner / admin of an education tenant. { mode, first_touch_positions }.
// Default is "off". Shadow computes and stores picks but assigns nothing; auto assigns new leads as they arrive.
async function gate() {
  const auth = await authenticateRequest();
  if (!auth) return { res: apiUnauthorized() } as const;
  if (!getFeatureAccess(auth.industryId, FEATURES.EDU_HOME)) return { res: apiForbidden() } as const;
  if (auth.role !== "owner" && auth.role !== "admin") return { res: apiForbidden() } as const;
  return { auth } as const;
}

export async function GET() {
  const g = await gate();
  if ("res" in g) return g.res;
  const db = await scopedClient(g.auth);
  const s = await loadAssignmentSettings(db);
  return apiSuccess({ mode: s.mode, first_touch_positions: s.firstTouchPositions });
}

export async function PUT(request: NextRequest) {
  const g = await gate();
  if ("res" in g) return g.res;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ body: ["Invalid JSON body"] });
  }
  const errors: Record<string, string[]> = {};
  if (typeof body.mode !== "string" || !ASSIGNMENT_MODES.includes(body.mode as AssignmentMode)) errors.mode = ["Must be off, shadow or auto"];
  const positions = body.first_touch_positions;
  if (positions !== undefined && (!Array.isArray(positions) || positions.length === 0 || positions.some((p) => typeof p !== "string" || !/^[a-z0-9_-]{1,60}$/.test(p)))) {
    errors.first_touch_positions = ["Must be a non-empty list of position slugs"];
  }
  if (Object.keys(errors).length) return apiValidationError(errors);

  const db = await scopedClient(g.auth);
  const current = await loadAssignmentSettings(db);
  const { error } = await db.from("lead_assignment_settings").upsert(
    {
      mode: body.mode,
      first_touch_positions: (positions as string[] | undefined) ?? current.firstTouchPositions,
      updated_by: g.auth.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id" },
  );
  if (error) return apiError("DB_ERROR", "Failed to save", 500);
  return apiSuccess({ mode: body.mode, first_touch_positions: (positions as string[] | undefined) ?? current.firstTouchPositions });
}
