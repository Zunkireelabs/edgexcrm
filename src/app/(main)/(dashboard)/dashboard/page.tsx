import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getCurrentUserTenant, getLeads, getTeamMembers, getPipelineStages, getFormConfigsForTenant, getBranchIds } from "@/lib/supabase/queries";
import { StatsCards } from "@/components/dashboard/stats-cards";
import { LeadsByStageChart, LeadsBySourceChart, LeadsByCounselorChart } from "@/components/dashboard/charts";
import { canSeeNav, canSeeWidget, leadQueryScope, resolveEffectiveBranch } from "@/lib/api/permissions";
import { CapitalRaiseDashboard } from "@/industries/real-estate/features/capital-raise/capital-raise-dashboard";

export default async function DashboardPage() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");

  // real_estate (CRE capital-raise) lands here on /dashboard and gets its own
  // Capital-Raise Dashboard instead of the generic lead StatsCards/charts. This
  // is an additive early return ABOVE all existing logic — every education /
  // it_agency / generic path below is untouched and unreachable for real_estate.
  if (tenantData.tenant.industry_id === "real_estate") {
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

  const [leads, teamMembers, stages, formConfigs] = await Promise.all([
    getLeads(tenantData.tenant.id, scope),
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <h1 className="text-lg font-bold">Dashboard</h1>

      {/* Stats Cards */}
      {canSeeWidget(permissions, "stats") && <StatsCards leads={leads} stages={stages} />}

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
        {canSeeWidget(permissions, "leads-by-stage") && (
          <LeadsByStageChart leads={leads} stages={stages} />
        )}
        {canSeeWidget(permissions, "leads-by-source") && (
          <LeadsBySourceChart leads={leads} formMap={formMap} />
        )}
        {canSeeWidget(permissions, "leads-by-counselor") && (
          <LeadsByCounselorChart leads={leads} memberMap={memberMap} memberNames={memberNames} />
        )}
      </div>

    </div>
  );
}
