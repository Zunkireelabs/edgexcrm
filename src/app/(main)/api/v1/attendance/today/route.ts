import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { canManageHR } from "@/lib/api/permissions";
import { apiSuccess, apiUnauthorized, apiForbidden, apiError } from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { getSelfTenantUserId, getDirectReportIds } from "@/lib/api/hr-scope";
import { todayInTz } from "@/lib/hr/dates";

interface TenantUserRow {
  id: string;
  user_id: string;
}

interface AttendanceRecordRow {
  tenant_user_id: string;
  clock_in_at: string | null;
  clock_out_at: string | null;
  status: string;
}

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const db = await scopedClient(auth);
  const hasManageHR = canManageHR(auth.permissions);
  const selfId = await getSelfTenantUserId(db, auth);
  if (!selfId) return apiError("NOT_FOUND", "No tenant membership found for the current user", 404);

  const { searchParams } = new URL(request.url);
  const scope = searchParams.get("scope") ?? "team";

  let memberIds: string[];
  if (scope === "all") {
    if (!hasManageHR) return apiForbidden();
    const { data } = await db.from("tenant_users").select("id");
    memberIds = ((data ?? []) as unknown as { id: string }[]).map((r) => r.id);
  } else {
    memberIds = await getDirectReportIds(db, selfId);
  }
  if (memberIds.length === 0) return apiSuccess({ date: todayInTz("Asia/Kathmandu"), members: [] });

  const { data: membersData } = await db.from("tenant_users").select("id, user_id").in("id", memberIds);
  const members = (membersData ?? []) as unknown as TenantUserRow[];

  const { data: tenantRow } = await db.raw().from("tenants").select("timezone").eq("id", auth.tenantId).single();
  const timezone = (tenantRow as { timezone: string } | null)?.timezone ?? "Asia/Kathmandu";
  const today = todayInTz(timezone);

  const { data: recordsData } = await db
    .from("attendance_records")
    .select("tenant_user_id, clock_in_at, clock_out_at, status")
    .in("tenant_user_id", memberIds)
    .eq("work_date", today);
  const recordByMember = new Map<string, AttendanceRecordRow>();
  for (const r of (recordsData ?? []) as unknown as AttendanceRecordRow[]) {
    recordByMember.set(r.tenant_user_id, r);
  }

  const { data: authData } = await db.raw().auth.admin.listUsers({ perPage: 1000 });
  const nameMap = new Map<string, string | null>();
  const emailMap = new Map<string, string>();
  for (const u of authData?.users || []) {
    emailMap.set(u.id, u.email || "");
    const meta = u.user_metadata as Record<string, unknown> | undefined;
    nameMap.set(u.id, (meta?.name ?? meta?.full_name ?? null) as string | null);
  }

  const result = members.map((m) => {
    const record = recordByMember.get(m.id);
    return {
      tenant_user_id: m.id,
      user_id: m.user_id,
      name: nameMap.get(m.user_id) ?? null,
      email: emailMap.get(m.user_id) || "Unknown",
      clock_in_at: record?.clock_in_at ?? null,
      clock_out_at: record?.clock_out_at ?? null,
      status: record?.status ?? "not_marked",
    };
  });

  return apiSuccess({ date: today, members: result });
}
