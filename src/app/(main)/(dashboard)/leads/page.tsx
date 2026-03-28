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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">All Leads</h1>
        <p className="text-muted-foreground">
          View and manage all lead submissions
        </p>
      </div>
      <LeadsTable leads={leads} memberMap={memberMap} stages={stages} formMap={formMap} role={tenantData.role as "owner" | "admin" | "viewer" | "counselor"} />
    </div>
  );
}
