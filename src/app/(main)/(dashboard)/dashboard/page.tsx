import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getCurrentUserTenant, getTeamMembers, getPipelineStages, getFormConfigsForTenant, getBranchIds } from "@/lib/supabase/queries";
import { getLeadAggregates, resolveSourceCounts } from "@/lib/leads/aggregates";
import { StatsCards } from "@/components/dashboard/stats-cards";
import { LeadsByStageChart, LeadsBySourceChart, LeadsByCounselorChart } from "@/components/dashboard/charts";
import { canSeeNav, canSeeWidget, leadQueryScope, resolveEffectiveBranch } from "@/lib/api/permissions";
import { CapitalRaiseDashboard } from "@/industries/real-estate/features/capital-raise/capital-raise-dashboard";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

export default async function DashboardPage() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");

  // Offerings-industry tenants (real_estate, home_moving) land here on
  // /dashboard and get the Capital-Raise Dashboard instead of the generic
  // lead StatsCards/charts. This is an additive early return ABOVE all
  // existing logic — every education / it_agency / generic path below is
  // untouched and unreachable for these tenants.
  if (getFeatureAccess(tenantData.tenant.industry_id, FEATURES.OFFERINGS)) {
    return <CapitalRaiseDashboard />;
  }

  // Education and IT-agency tenants have their own Insights → Dashboards surface —
  // but only send users who can actually see it. Redirecting a user without insights
  // nav access creates an infinite loop: /insights/dashboards bounces them straight
  // back here.
  if (
    (tenantData.tenant.industry_id === "education_consultancy" ||
      tenantData.tenant.industry_id === "it_agency") &&
    canSeeNav(tenantData.permissions, "/insights/dashboards")
  ) {
    redirect("/insights/dashboards");
  }

  const { permissions } = tenantData;

  const cookieStore = await cookies();
  const branchCookieVal = cookieStore.get("edgex_branch")?.value ?? null;
  const validBranchIds =
    tenantData.entitlements.maxBranches > 1 ? await getBranchIds(tenantData.tenant.id) : [];
  const effectiveBranch = resolveEffectiveBranch(branchCookieVal, validBranchIds);

  // Fix: pass branchId so branch managers (leadScope "team") are correctly scoped
  const scope = leadQueryScope(permissions, tenantData.userId, tenantData.branchId);
  // Admin cookie override: all-scope users can filter by a specific branch from the header
  if (permissions.leadScope === "all" && effectiveBranch) {
    scope.branchId = effectiveBranch;
  }

  const [aggregates, teamMembers, stages, formConfigs] = await Promise.all([
    getLeadAggregates(tenantData.tenant.id, scope, new Date()),
    getTeamMembers(tenantData.tenant.id),
    getPipelineStages(tenantData.tenant.id),
    getFormConfigsForTenant(tenantData.tenant.id),
  ]);

  const memberMap = Object.fromEntries(
    teamMembers.map((m) => [m.user_id, m.email])
  );
  const memberNames = Object.fromEntries(teamMembers.map((m) => [m.user_id, m.name]));

  const formMap = Object.fromEntries(
    formConfigs.map((f) => [f.id, f.name])
  );
  const sourceCounts = resolveSourceCounts(aggregates.sourceCombos, formMap);

  return (
    <div className="space-y-6">
      {/* Header */}
      <h1 className="text-lg font-bold">Dashboard</h1>

      {/* Stats Cards */}
      {canSeeWidget(permissions, "stats") && (
        <div className="bg-sidebar-bg border border-sidebar-border rounded-xl p-4">
          <StatsCards aggregates={aggregates} stages={stages} />
        </div>
      )}

      {/* Charts Row */}
      <div className="grid grid-cols-1 gap-6">
        {canSeeWidget(permissions, "leads-by-stage") && (
          <LeadsByStageChart status={aggregates.status} stages={stages} />
        )}
        {canSeeWidget(permissions, "leads-by-source") && (
          <LeadsBySourceChart sourceCounts={sourceCounts} />
        )}
        {canSeeWidget(permissions, "leads-by-counselor") && (
          <LeadsByCounselorChart assignedToCounts={aggregates.counselor} memberMap={memberMap} memberNames={memberNames} />
        )}
      </div>

    </div>
  );
}
