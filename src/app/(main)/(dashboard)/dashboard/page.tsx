import { redirect } from "next/navigation";
import { getCurrentUserTenant, getLeads, getTeamMembers, getPipelineStages, getFormConfigsForTenant } from "@/lib/supabase/queries";
import { StatsCards } from "@/components/dashboard/stats-cards";
import { LeadsTable } from "@/components/dashboard/leads-table";
import { LeadsByStageChart, LeadsBySourceChart, LeadsByCounselorChart } from "@/components/dashboard/charts";

export default async function DashboardPage() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");

  const [leads, teamMembers, stages, formConfigs] = await Promise.all([
    getLeads(tenantData.tenant.id, {
      role: tenantData.role,
      userId: tenantData.userId,
    }),
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

  // Check if user is admin/owner (can see team workload)
  const canSeeTeamStats = tenantData.role === "owner" || tenantData.role === "admin";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">
          Overview of your leads pipeline
        </p>
      </div>

      {/* Stats Cards */}
      <StatsCards leads={leads} />

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
        <LeadsByStageChart leads={leads} stages={stages} />
        <LeadsBySourceChart leads={leads} formMap={formMap} />
        {canSeeTeamStats && (
          <LeadsByCounselorChart leads={leads} memberMap={memberMap} />
        )}
      </div>

      {/* Leads Table */}
      <LeadsTable leads={leads} memberMap={memberMap} stages={stages} formMap={formMap} />
    </div>
  );
}
