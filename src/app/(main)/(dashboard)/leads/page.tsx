import { redirect } from "next/navigation";
import { getCurrentUserTenant, getLeads, getTeamMembers, getPipelineStages, getFormConfigsForTenant, getBranches } from "@/lib/supabase/queries";
import { createServiceClient } from "@/lib/supabase/server";
import { LeadsTable } from "@/components/dashboard/leads-table";
import { canSeeNav, leadQueryScope } from "@/lib/api/permissions";
import type { TenantEntity, Industry } from "@/types/database";

interface LeadsPageProps {
  searchParams: Promise<{ branch_id?: string }>;
}

export default async function LeadsPage({ searchParams }: LeadsPageProps) {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!canSeeNav(tenantData.permissions, "/leads")) redirect("/dashboard");

  const params = await searchParams;
  const serviceClient = await createServiceClient();

  // Build base scope; for all-scope admins apply the URL ?branch_id= switcher
  const scope = leadQueryScope(tenantData.permissions, tenantData.userId, tenantData.branchId);
  if (tenantData.permissions.leadScope === "all" && params.branch_id) {
    scope.branchId = params.branch_id;
  }

  const [leads, teamMembers, stages, formConfigs, industryResult, entitiesResult, branches] =
    await Promise.all([
      getLeads(tenantData.tenant.id, scope),
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
      // Fetch branches (empty array for single-branch tenants)
      tenantData.entitlements.maxBranches > 1
        ? getBranches(tenantData.tenant.id)
        : Promise.resolve([]),
    ]);

  const memberMap = Object.fromEntries(teamMembers.map((m) => [m.user_id, m.email]));
  const formMap = Object.fromEntries(formConfigs.map((f) => [f.id, f.name]));

  const industry = industryResult.data as Industry | null;
  const entities = (entitiesResult.data || []) as TenantEntity[];

  return (
    <div className="flex flex-col h-full min-h-0">
      <h1 className="shrink-0 text-lg font-bold mb-4 pr-6">All Leads</h1>
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
        industryId={tenantData.tenant.industry_id}
        branches={branches}
        maxBranches={tenantData.entitlements.maxBranches}
        activeBranchId={params.branch_id ?? null}
      />
    </div>
  );
}
