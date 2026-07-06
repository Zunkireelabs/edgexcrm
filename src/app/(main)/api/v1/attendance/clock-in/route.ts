import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiError } from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { createAuditLog, emitEvent } from "@/lib/api/audit";
import { getSelfTenantUserId } from "@/lib/api/hr-scope";
import { todayInTz } from "@/lib/hr/dates";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function POST(_request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: "/api/v1/attendance/clock-in" });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const db = await scopedClient(auth);
  const selfId = await getSelfTenantUserId(db, auth);
  if (!selfId) return apiError("NOT_FOUND", "No tenant membership found for the current user", 404);

  const { data: tenantRow } = await db.raw().from("tenants").select("timezone").eq("id", auth.tenantId).single();
  const timezone = (tenantRow as { timezone: string } | null)?.timezone ?? "Asia/Kathmandu";
  const today = todayInTz(timezone);

  const { data: existing } = await db
    .from("attendance_records")
    .select("*")
    .eq("tenant_user_id", selfId)
    .eq("work_date", today)
    .maybeSingle();
  const existingRow = existing as { id: string; clock_in_at: string | null; source: string } | null;

  // Idempotent: already clocked in today.
  if (existingRow?.clock_in_at) {
    return apiSuccess(existing, 200);
  }

  const now = new Date().toISOString();
  // A manual HR-set record (e.g. remote/half_day/absent) must not be
  // silently overwritten by a self clock-in — only stamp clock_in_at.
  const result = existingRow
    ? await db
        .from("attendance_records")
        .update(
          existingRow.source === "manual"
            ? { clock_in_at: now }
            : { clock_in_at: now, status: "present", source: "self_clock" },
        )
        .eq("id", existingRow.id)
        .select()
        .single()
    : await db
        .from("attendance_records")
        .insert({
          tenant_user_id: selfId,
          user_id: auth.userId,
          work_date: today,
          clock_in_at: now,
          status: "present",
          source: "self_clock",
        })
        .select()
        .single();

  if (result.error) {
    // Concurrent clock-in: two requests both saw "no row" and both INSERTed;
    // the loser hits UNIQUE(tenant_id, tenant_user_id, work_date). Treat as
    // "already clocked in" rather than a hard failure.
    if (!existingRow && result.error.code === "23505") {
      const { data: reRead } = await db
        .from("attendance_records")
        .select("*")
        .eq("tenant_user_id", selfId)
        .eq("work_date", today)
        .maybeSingle();
      if (reRead) return apiSuccess(reRead, 200);
    }
    log.error({ error: result.error }, "Failed to clock in");
    return apiError("DB_ERROR", "Failed to clock in", 500);
  }

  const row = result.data as { id: string };

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "attendance.clocked_in",
      entityType: "attendance_record",
      entityId: row.id,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "attendance.clocked_in",
      entityType: "attendance_record",
      entityId: row.id,
      requestId,
    }),
  ]);

  log.info({ attendanceRecordId: row.id }, "Clocked in");
  return apiSuccess(result.data, 201);
}
