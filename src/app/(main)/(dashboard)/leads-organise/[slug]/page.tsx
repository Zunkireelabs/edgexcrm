import { redirect, notFound } from "next/navigation";
import { cookies } from "next/headers";
import {
  getCurrentUserTenant,
  getLeadsPage,
  getLeadListsByTenant,
  getTeamMembers,
  getPipelineStages,
  getFormConfigsForTenant,
  getBranches,
  getImportSourceReconciliation,
  getTeamMembersWithPositions,
  type StagingLeadFilters,
} from "@/lib/supabase/queries";
import { createServiceClient } from "@/lib/supabase/server";
import { LeadsTable } from "@/components/dashboard/leads-table";
import { ReconciliationPanel } from "@/components/dashboard/leads-organise/reconciliation-panel";
import { canAccessList, leadQueryScope } from "@/lib/api/permissions";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import type { TenantEntity, Industry, LeadList } from "@/types/database";

export default async function LeadsOrganiseCockpitPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);

  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const rawPageSize = parseInt(sp.pageSize ?? "25", 10);
  const pageSize = [10, 25, 50, 100].includes(rawPageSize) ? rawPageSize : 25;
  const serverFilters: StagingLeadFilters = {
    search: sp.search || undefined,
    statusFilter: sp.statusFilter || "all",
    formFilter: sp.formFilter || "all",
    counselorFilter: sp.counselorFilter || "all",
    sourceFilter: sp.sourceFilter || "all",
    tagFilter: sp.tagFilter || "all",
    prospectIndustryFilter: sp.prospectIndustryFilter || "all",
    createdFilter: sp.createdFilter || "all",
    sortField: (sp.sortField as StagingLeadFilters["sortField"]) || "activity",
    sortDirection: (sp.sortDirection as StagingLeadFilters["sortDirection"]) || "desc",
  };

  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");

  // Admin/manager only
  const isAdmin = tenantData.role === "owner" || tenantData.role === "admin";
  if (!isAdmin) redirect("/dashboard");

  const hasLeadLists = getFeatureAccess(tenantData.tenant.industry_id, FEATURES.LEAD_LISTS);
  if (!hasLeadLists) notFound();

  const [serviceClient, cookieStore] = await Promise.all([
    createServiceClient(),
    cookies(),
  ]);

  const branchCookieVal = cookieStore.get("edgex_branch")?.value ?? null;
  const selectedBranchId = branchCookieVal && branchCookieVal !== "all" ? branchCookieVal : null;

  const allLists = await getLeadListsByTenant(tenantData.tenant.id);

  // Resolve the staging list by slug
  const stagingList = (allLists as LeadList[]).find(
    (l) => l.slug === slug && !!l.is_staging
  );
  if (!stagingList) notFound();

  // Check caller can access it
  const accessible = canAccessList(
    tenantData.permissions,
    stagingList.access as { mode: string; positionIds?: string[] },
    tenantData.positionId,
  );
  if (!accessible) notFound();

  // Build scope for this staging list's leads
  const scope = leadQueryScope(tenantData.permissions, tenantData.userId, tenantData.branchId);
  if (tenantData.permissions.leadScope === "all" && branchCookieVal && branchCookieVal !== "all") {
    scope.branchId = branchCookieVal;
  }
  scope.listId = stagingList.id;

  // Pipeline lists are the non-staging ones (move targets for the bulk bar)
  const pipelineLists = (allLists as LeadList[]).filter(
    (l) =>
      !l.is_staging &&
      canAccessList(
        tenantData.permissions,
        l.access as { mode: string; positionIds?: string[] },
        tenantData.positionId,
      )
  );

  const [
    leadsPage,
    teamMembers,
    teamMembersWithPositions,
    reconciliationRows,
    stages,
    formConfigs,
    industryResult,
    entitiesResult,
    branches,
  ] = await Promise.all([
    getLeadsPage(
      tenantData.tenant.id,
      { listId: stagingList.id, branchId: scope.branchId ?? null },
      serverFilters,
      { page, pageSize },
    ),
    getTeamMembers(tenantData.tenant.id),
    getTeamMembersWithPositions(tenantData.tenant.id),
    getImportSourceReconciliation(tenantData.tenant.id, stagingList.id),
    getPipelineStages(tenantData.tenant.id),
    getFormConfigsForTenant(tenantData.tenant.id),
    tenantData.tenant.industry_id
      ? serviceClient
          .from("industries")
          .select("*")
          .eq("id", tenantData.tenant.industry_id)
          .single()
      : Promise.resolve({ data: null }),
    serviceClient
      .from("tenant_entities")
      .select("*")
      .eq("tenant_id", tenantData.tenant.id)
      .eq("is_active", true)
      .order("position", { ascending: true }),
    tenantData.entitlements.maxBranches > 1
      ? getBranches(tenantData.tenant.id)
      : Promise.resolve([]),
  ]);

  const memberMap = Object.fromEntries(teamMembers.map((m) => [m.user_id, m.email]));
  const formMap = Object.fromEntries(formConfigs.map((f) => [f.id, f.name]));
  const roleMap = Object.fromEntries(
    teamMembersWithPositions.map((m) => [
      m.user_id,
      m.position_name ? `${m.display} (${m.position_name})` : m.display,
    ]),
  );

  const industry = industryResult.data as Industry | null;
  const entities = (entitiesResult.data || []) as TenantEntity[];
  const { rows: leads, totalCount } = leadsPage;

  return (
    <div className="flex flex-col h-full min-h-0">
      <h1 className="shrink-0 text-lg font-bold mb-4 pr-6">{stagingList.name}</h1>
      <ReconciliationPanel rows={reconciliationRows} />
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
        selectedBranchId={selectedBranchId}
        userBranchId={tenantData.branchId}
        leadLists={pipelineLists}
        roleMap={roleMap}
        extraDefaultVisibleKeys={["assigned_role"]}
        isStagingView
        serverPaginated
        serverTotalCount={totalCount}
        serverPage={page}
        serverPageSize={pageSize}
        serverFilters={serverFilters}
        stagingListId={stagingList.id}
      />
    </div>
  );
}
