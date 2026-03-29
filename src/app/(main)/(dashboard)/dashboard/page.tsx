import { redirect } from "next/navigation";
import { getCurrentUserTenant, getLeads, getTeamMembers, getPipelineStages, getFormConfigsForTenant } from "@/lib/supabase/queries";
import { createServiceClient } from "@/lib/supabase/server";
import { StatsCards } from "@/components/dashboard/stats-cards";
import { LeadsTable } from "@/components/dashboard/leads-table";
import { LeadsByStageChart, LeadsBySourceChart, LeadsByCounselorChart } from "@/components/dashboard/charts";
import type { TenantEntity, Industry } from "@/types/database";

export default async function DashboardPage() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");

  const serviceClient = await createServiceClient();

  const [leads, teamMembers, stages, formConfigs, industryResult, entitiesResult] = await Promise.all([
    getLeads(tenantData.tenant.id, {
      role: tenantData.role,
      userId: tenantData.userId,
    }),
    getTeamMembers(tenantData.tenant.id),
    getPipelineStages(tenantData.tenant.id),
    getFormConfigsForTenant(tenantData.tenant.id),
    // Fetch industry if tenant has one
    tenantData.tenant.industry_id
      ? serviceClient
          .from("industries")
          .select("*")
          .eq("id", tenantData.tenant.industry_id)
          .single()
      : Promise.resolve({ data: null }),
    // Fetch tenant entities
    serviceClient
      .from("tenant_entities")
      .select("*")
      .eq("tenant_id", tenantData.tenant.id)
      .eq("is_active", true)
      .order("position", { ascending: true }),
  ]);

  const memberMap = Object.fromEntries(
    teamMembers.map((m) => [m.user_id, m.email])
  );

  const formMap = Object.fromEntries(
    formConfigs.map((f) => [f.id, f.name])
  );

  const industry = industryResult.data as Industry | null;
  const entities = (entitiesResult.data || []) as TenantEntity[];

  // Check if user is admin/owner (can see team workload)
  const canSeeTeamStats = tenantData.role === "owner" || tenantData.role === "admin";

  return (
    <div className="space-y-6">
      {/* Header */}
      <h1 className="text-lg font-bold">Dashboard</h1>

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
      <LeadsTable
        leads={leads}
        memberMap={memberMap}
        stages={stages}
        formMap={formMap}
        role={tenantData.role as "owner" | "admin" | "viewer" | "counselor"}
        tenantId={tenantData.tenant.id}
        teamMembers={teamMembers}
        entities={entities}
        entityLabel={industry?.entity_type_label}
        currentUserId={tenantData.userId}
      />
    </div>
  );
}
