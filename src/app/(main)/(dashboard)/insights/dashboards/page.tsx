import { redirect, notFound } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { createServiceClient } from "@/lib/supabase/server";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { canSeeNav } from "@/lib/api/permissions";
import { DashboardsEmpty } from "@/industries/education-consultancy/features/insights/pages/dashboards-empty";
import type { Dashboard } from "@/types/database";

export default async function InsightsDashboardsPage() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.INSIGHTS)) notFound();
  if (!canSeeNav(tenantData.permissions, "/insights/dashboards")) redirect("/dashboard");

  const { permissions, positionId } = tenantData;
  const isAdmin = permissions.baseTier === "owner" || permissions.baseTier === "admin";

  const supabase = await createServiceClient();
  const { data } = await supabase
    .from("dashboards")
    .select("*")
    .eq("tenant_id", tenantData.tenant.id)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  const allDashboards = (data ?? []) as Dashboard[];

  const visibleDashboards = isAdmin
    ? allDashboards
    : allDashboards.filter((d) =>
        positionId !== null && d.granted_position_ids.includes(positionId)
      );

  if (visibleDashboards.length > 0) {
    redirect(`/insights/dashboards/${visibleDashboards[0].id}`);
  }

  return <DashboardsEmpty canManage={isAdmin} />;
}
