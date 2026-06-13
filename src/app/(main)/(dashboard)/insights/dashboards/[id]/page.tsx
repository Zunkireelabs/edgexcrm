import { redirect, notFound } from "next/navigation";
import {
  getCurrentUserTenant,
  getLeads,
  getTeamMembers,
  getPipelineStages,
  getFormConfigsForTenant,
} from "@/lib/supabase/queries";
import { createServiceClient } from "@/lib/supabase/server";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { canSeeNav, leadQueryScope } from "@/lib/api/permissions";
import { DashboardView } from "@/industries/education-consultancy/features/insights/pages/dashboard-view";
import type { Dashboard } from "@/types/database";

export default async function InsightsDashboardViewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.INSIGHTS)) notFound();
  if (!canSeeNav(tenantData.permissions, "/insights/dashboards")) redirect("/dashboard");

  const { permissions, positionId, userId } = tenantData;
  const isAdmin = permissions.baseTier === "owner" || permissions.baseTier === "admin";

  const supabase = await createServiceClient();

  const [dashboardResult, allDashboardsResult] = await Promise.all([
    supabase
      .from("dashboards")
      .select("*")
      .eq("tenant_id", tenantData.tenant.id)
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("dashboards")
      .select("*")
      .eq("tenant_id", tenantData.tenant.id)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
  ]);

  if (!dashboardResult.data) notFound();
  const dashboard = dashboardResult.data as Dashboard;

  // Grant check: members must be in granted_position_ids.
  if (!isAdmin && (positionId === null || !dashboard.granted_position_ids.includes(positionId))) {
    notFound();
  }

  const allDashboards = (allDashboardsResult.data ?? []) as Dashboard[];
  const visibleDashboards = isAdmin
    ? allDashboards
    : allDashboards.filter((d) =>
        positionId !== null && d.granted_position_ids.includes(positionId)
      );

  const scope = leadQueryScope(permissions, userId);
  const [leads, teamMembers, stages, formConfigs] = await Promise.all([
    getLeads(tenantData.tenant.id, scope),
    getTeamMembers(tenantData.tenant.id),
    getPipelineStages(tenantData.tenant.id),
    getFormConfigsForTenant(tenantData.tenant.id),
  ]);

  const memberMap = Object.fromEntries(teamMembers.map((m) => [m.user_id, m.email]));
  const formMap = Object.fromEntries(formConfigs.map((f) => [f.id, f.name]));

  return (
    <DashboardView
      dashboard={dashboard}
      leads={leads}
      stages={stages}
      memberMap={memberMap}
      formMap={formMap}
      visibleDashboards={visibleDashboards}
      canManage={isAdmin}
    />
  );
}
