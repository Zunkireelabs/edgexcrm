import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { canManageHR } from "@/lib/api/permissions";
import { apiSuccess, apiUnauthorized, apiForbidden, apiError, apiValidationError } from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { getSelfTenantUserId, canReadEmployee } from "@/lib/api/hr-scope";
import { todayInTz } from "@/lib/hr/dates";

interface LeaveTypeRow {
  id: string;
  name: string;
  code: string | null;
  color: string | null;
  is_paid: boolean;
  annual_allotment_days: number;
  allow_half_day: boolean;
  carry_forward: boolean;
}

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const db = await scopedClient(auth);
  const selfId = await getSelfTenantUserId(db, auth);
  const { searchParams } = new URL(request.url);

  const targetTenantUserId = searchParams.get("tenant_user_id") ?? selfId;
  if (!targetTenantUserId) return apiError("NOT_FOUND", "No tenant membership found for the current user", 404);

  const yearParam = searchParams.get("year");
  let year: number;
  if (yearParam) {
    year = Number(yearParam);
  } else {
    const { data: tenantRow } = await db.raw().from("tenants").select("timezone").eq("id", auth.tenantId).single();
    const tenantTimezone = (tenantRow as unknown as { timezone: string } | null)?.timezone ?? "UTC";
    year = Number(todayInTz(tenantTimezone).slice(0, 4));
  }
  if (!Number.isInteger(year)) return apiValidationError({ year: ["Must be an integer year"] });

  const hasManageHR = canManageHR(auth.permissions);
  const allowed = await canReadEmployee(db, selfId, hasManageHR, targetTenantUserId);
  if (!allowed) return apiForbidden();

  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;

  const [typesRes, adjustmentsRes, requestsRes] = await Promise.all([
    db.from("leave_types").select("*").eq("is_active", true).order("sort_order", { ascending: true }),
    db
      .from("leave_adjustments")
      .select("leave_type_id, delta_days")
      .eq("tenant_user_id", targetTenantUserId)
      .eq("year", year),
    db
      .from("leave_requests")
      .select("leave_type_id, total_days")
      .eq("tenant_user_id", targetTenantUserId)
      .eq("approval_status", "approved")
      .gte("start_date", yearStart)
      .lte("start_date", yearEnd),
  ]);

  if (typesRes.error) return apiError("DB_ERROR", "Failed to fetch leave types", 500);
  if (adjustmentsRes.error) return apiError("DB_ERROR", "Failed to fetch leave adjustments", 500);
  if (requestsRes.error) return apiError("DB_ERROR", "Failed to fetch leave requests", 500);

  const adjustmentsByType = new Map<string, number>();
  for (const a of (adjustmentsRes.data ?? []) as unknown as { leave_type_id: string; delta_days: number }[]) {
    adjustmentsByType.set(a.leave_type_id, (adjustmentsByType.get(a.leave_type_id) ?? 0) + Number(a.delta_days));
  }

  const approvedByType = new Map<string, number>();
  for (const r of (requestsRes.data ?? []) as unknown as { leave_type_id: string; total_days: number }[]) {
    approvedByType.set(r.leave_type_id, (approvedByType.get(r.leave_type_id) ?? 0) + Number(r.total_days));
  }

  const result = ((typesRes.data ?? []) as unknown as LeaveTypeRow[]).map((t) => {
    const adjustments = adjustmentsByType.get(t.id) ?? 0;
    const approvedDays = approvedByType.get(t.id) ?? 0;
    const balance = t.annual_allotment_days + adjustments - approvedDays;
    return {
      leave_type_id: t.id,
      name: t.name,
      code: t.code,
      color: t.color,
      is_paid: t.is_paid,
      allow_half_day: t.allow_half_day,
      carry_forward: t.carry_forward,
      annual_allotment_days: t.annual_allotment_days,
      adjustments,
      approved_days: approvedDays,
      balance,
      year,
    };
  });

  return apiSuccess(result);
}
