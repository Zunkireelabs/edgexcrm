import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiError,
  apiValidationError,
} from "@/lib/api/response";
import { validate, required } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { createAuditLog, emitEvent } from "@/lib/api/audit";

interface ClassManagerRow {
  tenant_id: string;
  user_id: string;
  enroll_students: boolean;
  mark_attendance: boolean;
  view_roster: boolean;
  granted_by: string | null;
  created_at: string;
  updated_at: string;
}

// GET /api/v1/class-managers — list all class_managers grants for the tenant,
// enriched with user email/display name for the settings table. Owner/admin only.
export async function GET() {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.CLASSES)) return apiForbidden();
  if (auth.role !== "owner" && auth.role !== "admin") return apiForbidden();

  const db = await scopedClient(auth);

  const { data: grants, error } = await db
    .from("class_managers")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) return apiError("DB_ERROR", "Failed to fetch class managers", 500);

  const rows = (grants ?? []) as unknown as ClassManagerRow[];

  // Enrich with user email/name via auth.admin — same pattern as /api/v1/team.
  const { data: authData } = await db.raw().auth.admin.listUsers({ perPage: 1000 });
  const userMap = new Map<string, string>();
  const nameMap = new Map<string, string | null>();
  for (const u of authData?.users || []) {
    userMap.set(u.id, u.email || "");
    const meta = u.user_metadata as Record<string, unknown> | undefined;
    nameMap.set(u.id, (meta?.name ?? meta?.full_name ?? null) as string | null);
  }

  const enriched = rows.map((r) => ({
    userId: r.user_id,
    email: userMap.get(r.user_id) || "Unknown",
    name: nameMap.get(r.user_id) ?? null,
    enrollStudents: r.enroll_students,
    markAttendance: r.mark_attendance,
    viewRoster: r.view_roster,
    grantedBy: r.granted_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));

  return apiSuccess(enriched);
}

// PATCH /api/v1/class-managers — upsert a single user's grant.
// Body: { userId, enrollStudents, markAttendance, viewRoster }. Owner/admin only.
export async function PATCH(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "PATCH", path: "/api/v1/class-managers" });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.CLASSES)) return apiForbidden();
  if (auth.role !== "owner" && auth.role !== "admin") return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const { valid, errors } = validate(body, {
    userId: [required("userId")],
  });
  if (!valid) return apiValidationError(errors);

  const userId = String(body.userId);
  const enrollStudents = Boolean(body.enrollStudents);
  const markAttendance = Boolean(body.markAttendance);
  const viewRoster = Boolean(body.viewRoster);

  const db = await scopedClient(auth);

  // Confirm the target user belongs to this tenant before granting.
  const { data: member } = await db
    .from("tenant_users")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!member) return apiError("NOT_FOUND", "User is not a member of this tenant", 404);

  const { data: existing } = await db
    .from("class_managers")
    .select("enroll_students, mark_attendance, view_roster")
    .eq("user_id", userId)
    .maybeSingle() as { data: Pick<ClassManagerRow, "enroll_students" | "mark_attendance" | "view_roster"> | null };

  const { data: upserted, error } = await db
    .from("class_managers")
    .upsert(
      {
        user_id: userId,
        enroll_students: enrollStudents,
        mark_attendance: markAttendance,
        view_roster: viewRoster,
        granted_by: auth.userId,
      },
      { onConflict: "tenant_id,user_id" }
    )
    .select("*")
    .single();

  if (error) {
    log.error({ error }, "Failed to upsert class manager grant");
    return apiError("DB_ERROR", "Failed to update class manager grant", 500);
  }

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "class_manager.updated",
      entityType: "class_manager",
      entityId: userId,
      changes: {
        grant: {
          old: existing
            ? {
                enrollStudents: existing.enroll_students,
                markAttendance: existing.mark_attendance,
                viewRoster: existing.view_roster,
              }
            : null,
          new: { enrollStudents, markAttendance, viewRoster },
        },
      },
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "class_manager.updated",
      entityType: "class_manager",
      entityId: userId,
      requestId,
      payload: { enrollStudents, markAttendance, viewRoster },
    }),
  ]);

  log.info({ userId }, "Class manager grant updated");
  return apiSuccess(upserted);
}
