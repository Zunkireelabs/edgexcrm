import { redirect } from "next/navigation";
import { getCurrentUserTenant, getLeads, getTeamMembers, getPipelineStages, getFormConfigsForTenant } from "@/lib/supabase/queries";
import { StatsCards } from "@/components/dashboard/stats-cards";
import { LeadsByStageChart, LeadsBySourceChart, LeadsByCounselorChart } from "@/components/dashboard/charts";
import { canSeeWidget, leadQueryScope } from "@/lib/api/permissions";

export default async function DashboardPage() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");

  // Education tenants have their own Insights → Dashboards surface.
  if (tenantData.tenant.industry_id === "education_consultancy") {
    redirect("/insights/dashboards");
  }

  const { permissions } = tenantData;

  const [leads, teamMembers, stages, formConfigs] = await Promise.all([
    getLeads(tenantData.tenant.id, leadQueryScope(permissions, tenantData.userId)),
    getTeamMembers(tenantData.tenant.id),
    getPipelineStages(tenantData.tenant.id),
    getFormConfigsForTenant(tenantData.tenant.id),
  ]);

  const memberMap = Object.fromEntries(
    teamMembers.map((m) => [m.user_id, m.email])
  );

  const formMap = Object.fromEntries(
    formConfigs.map((f) => [f.id, f.name])
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <h1 className="text-lg font-bold">Dashboard</h1>

      {/* Stats Cards */}
      {canSeeWidget(permissions, "stats") && <StatsCards leads={leads} />}

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
        {canSeeWidget(permissions, "leads-by-stage") && (
          <LeadsByStageChart leads={leads} stages={stages} />
        )}
        {canSeeWidget(permissions, "leads-by-source") && (
          <LeadsBySourceChart leads={leads} formMap={formMap} />
        )}
        {canSeeWidget(permissions, "leads-by-counselor") && (
          <LeadsByCounselorChart leads={leads} memberMap={memberMap} />
        )}
      </div>

    </div>
  );
}
