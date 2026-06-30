import { redirect, notFound } from "next/navigation";
import { cookies } from "next/headers";
import {
  getCurrentUserTenant,
  getLeads,
  getLeadListsByTenant,
  getTeamMembers,
  getPipelineStages,
  getFormConfigsForTenant,
  getBranches,
  getImportSourceReconciliation,
  getTeamMembersWithPositions,
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
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

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
    stagingList.id,
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
        l.id,
      )
  );

  // New Leads triage: only allow moving to Pre-qualified
  const moveTargets = stagingList.slug === "new-leads"
    ? pipelineLists.filter((l) => l.slug === "pre-qualified")
    : pipelineLists;

  const [
    leads,
    teamMembers,
    teamMembersWithPositions,
    reconciliationRows,
    stages,
    formConfigs,
    industryResult,
    entitiesResult,
    branches,
  ] = await Promise.all([
    getLeads(tenantData.tenant.id, { ...scope, limit: 50000 }),
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
  const memberNames = Object.fromEntries(teamMembers.map((m) => [m.user_id, m.name]));
  const memberBranchMap = Object.fromEntries(
    teamMembers.filter((m) => m.branch_id).map((m) => [m.user_id, m.branch_id as string])
  );
  const formMap = Object.fromEntries(formConfigs.map((f) => [f.id, f.name]));
  const roleMap = Object.fromEntries(
    teamMembersWithPositions.map((m) => [
      m.user_id,
      m.position_name ? `${m.display} (${m.position_name})` : m.display,
    ]),
  );

  const industry = industryResult.data as Industry | null;
  const entities = (entitiesResult.data || []) as TenantEntity[];

  return (
    <div className="flex flex-col h-full min-h-0">
      <h1 className="shrink-0 text-lg font-bold mb-4 pr-6">{stagingList.name}</h1>
      <ReconciliationPanel rows={reconciliationRows} />
      <LeadsTable
        leads={leads}
        memberMap={memberMap}
        memberNames={memberNames}
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
        leadLists={moveTargets}
        roleMap={roleMap}
        extraDefaultVisibleKeys={["assigned_role"]}
        isStagingView
        canExport={tenantData.permissions.canExport}
        canEditLeads={tenantData.permissions.canEditLeads}
        memberBranchMap={memberBranchMap}
      />
    </div>
  );
}
