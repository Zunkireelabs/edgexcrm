import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { canManageHR } from "@/lib/api/permissions";
import { AttendanceWorkspace } from "@/components/dashboard/hr/attendance/attendance-workspace";

export default async function AttendancePage() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");

  const { userId, permissions } = tenantData;
  const supabase = await createClient();

  const { data: membership } = await supabase
    .from("tenant_users")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  const selfTenantUserId = (membership as { id: string } | null)?.id ?? null;

  let isManager = false;
  if (selfTenantUserId) {
    const { count } = await supabase
      .from("employee_profiles")
      .select("id", { count: "exact", head: true })
      .eq("manager_tenant_user_id", selfTenantUserId);
    isManager = (count ?? 0) > 0;
  }

  return <AttendanceWorkspace canManageHR={canManageHR(permissions)} isManager={isManager} />;
}
