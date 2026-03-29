import { redirect } from "next/navigation";
import { getCurrentUserTenant, getLeads, getTeamMembers, getPipelineStages, getFormConfigsForTenant } from "@/lib/supabase/queries";
import { LeadsTable } from "@/components/dashboard/leads-table";

export default async function LeadsPage() {
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

  return (
    <div className="flex flex-col h-[calc(100vh-90px)]">
      <h1 className="shrink-0 text-lg font-bold mb-4">All Leads</h1>
      <LeadsTable leads={leads} memberMap={memberMap} stages={stages} formMap={formMap} role={tenantData.role as "owner" | "admin" | "viewer" | "counselor"} />
    </div>
  );
}
