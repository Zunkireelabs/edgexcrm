import { redirect, notFound } from "next/navigation";
import {
  getCurrentUserTenant,
  getLeadUtmRows,
  getTeamMembers,
  getPipelineStages,
  getLeadListsByTenant,
  getFormConfigsForTenant,
} from "@/lib/supabase/queries";
import { getLeadAggregates, resolveSourceCounts } from "@/lib/leads/aggregates";
import { createServiceClient } from "@/lib/supabase/server";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { canAccessList, canSeeNav, leadQueryScope } from "@/lib/api/permissions";
import { DashboardView } from "@/industries/_shared/features/insights/pages/dashboard-view";
import { resolveDateRangeFrom } from "@/industries/_shared/features/insights/lib/date-range-presets";
import type { Dashboard } from "@/types/database";

export default async function InsightsDashboardViewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { id } = await params;
  const { from } = await searchParams;
  const now = new Date();

  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");

  const createdAfter = resolveDateRangeFrom(from, now, tenantData.tenant.timezone);
  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.INSIGHTS)) notFound();
  if (!canSeeNav(tenantData.permissions, "/insights/dashboards")) redirect("/dashboard");

  const { permissions, positionId, userId } = tenantData;
  const isAdmin = permissions.baseTier === "owner" || permissions.baseTier === "admin";

  const supabase = await createServiceClient();

  const [dashboardResult, allDashboardsResult, tenantUserResult] = await Promise.all([
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
    supabase
      .from("tenant_users")
      .select("id")
      .eq("tenant_id", tenantData.tenant.id)
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  const currentTenantUserId = tenantUserResult.data?.id ?? null;

  if (!dashboardResult.data) notFound();
  const dashboard = dashboardResult.data as Dashboard;

  // Grant check: members must be in granted_position_ids.
  const grantedIds = Array.isArray(dashboard.granted_position_ids) ? dashboard.granted_position_ids : [];
  if (!isAdmin && (positionId === null || !grantedIds.includes(positionId))) {
    notFound();
  }

  const allDashboards = (allDashboardsResult.data ?? []) as Dashboard[];
  const visibleDashboards = isAdmin
    ? allDashboards
    : allDashboards.filter((d) =>
        positionId !== null &&
        (Array.isArray(d.granted_position_ids) ? d.granted_position_ids : []).includes(positionId)
      );

  const scope = leadQueryScope(permissions, userId);
  // UTM is the one widget that still needs row-level data (interactive cross-filter,
  // not a pre-aggregated count) — only fetch it when this dashboard actually uses it,
  // so tenants without the widget (Zunkiree/Mobilise, it_agency) pay nothing for it.
  const needsUtmRows = dashboard.widgets.includes("utm");
  const hasLeadLists = getFeatureAccess(tenantData.tenant.industry_id, FEATURES.LEAD_LISTS);
  const [aggregates, utmRows, teamMembers, stages, allLists, formConfigs] = await Promise.all([
    getLeadAggregates(tenantData.tenant.id, { ...scope, createdAfter }, now),
    needsUtmRows ? getLeadUtmRows(tenantData.tenant.id, scope) : Promise.resolve([]),
    getTeamMembers(tenantData.tenant.id),
    getPipelineStages(tenantData.tenant.id),
    hasLeadLists ? getLeadListsByTenant(tenantData.tenant.id) : Promise.resolve([]),
    getFormConfigsForTenant(tenantData.tenant.id),
  ]);

  // Same access filter as the leads page's stage dropdowns — admin-only lists are
  // simply absent from the chart, not rendered-then-hidden.
  const lists = allLists.filter(
    (l) => !l.is_archive && canAccessList(permissions, l.access, positionId, l.id)
  );

  const memberMap = Object.fromEntries(teamMembers.map((m) => [m.user_id, m.email]));
  const memberNames = Object.fromEntries(teamMembers.map((m) => [m.user_id, m.name]));
  const formMap = Object.fromEntries(formConfigs.map((f) => [f.id, f.name]));
  const sourceCounts = resolveSourceCounts(aggregates.sourceCombos, formMap);

  return (
    <DashboardView
      dashboard={dashboard}
      aggregates={aggregates}
      sourceCounts={sourceCounts}
      utmRows={utmRows}
      lists={lists}
      stages={stages}
      memberMap={memberMap}
      memberNames={memberNames}
      visibleDashboards={visibleDashboards}
      canManage={isAdmin}
      industryId={tenantData.tenant.industry_id}
      currentUserId={userId}
      currentTenantUserId={currentTenantUserId}
      dateFilterActive={createdAfter !== null}
    />
  );
}
