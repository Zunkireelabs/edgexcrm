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
import { getLeadCollaboratorsMapForLeads } from "@/lib/leads/collaborators";
import { createServiceClient } from "@/lib/supabase/server";
import { LeadsTable } from "@/components/dashboard/leads-table";
import { ReconciliationPanel } from "@/components/dashboard/leads-organise/reconciliation-panel";
import { canAccessList, leadQueryScope, resolveEffectiveBranch } from "@/lib/api/permissions";
import { POSITION_ROUTE_MAP } from "@/industries/education-consultancy/features/new-leads-triage/position-routing";
import { filterAssignableMembersByChain } from "@/lib/leads/assignable";
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

  // Fetch branches up front (also reused below for the table's branch picker) so the
  // stale/invalid edgex_branch cookie can be validated before it's applied to scope.
  const branches =
    tenantData.entitlements.maxBranches > 1 ? await getBranches(tenantData.tenant.id) : [];
  const effectiveBranch = resolveEffectiveBranch(
    branchCookieVal,
    branches.map((b) => b.id),
  );
  const selectedBranchId = effectiveBranch;

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
  const poolSlug = tenantData.tenant.industry_id === "education_consultancy" && tenantData.positionSlug
    ? (POSITION_ROUTE_MAP[tenantData.positionSlug] ?? null)
    : null;
  const scope = leadQueryScope(tenantData.permissions, tenantData.userId, tenantData.branchId, poolSlug);
  if (tenantData.permissions.leadScope === "all" && effectiveBranch) {
    scope.branchId = effectiveBranch;
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

  const [
    leads,
    teamMembers,
    teamMembersWithPositions,
    reconciliationRows,
    stages,
    formConfigs,
    industryResult,
    entitiesResult,
  ] = await Promise.all([
    getLeads(tenantData.tenant.id, { ...scope, limit: 50000, excludeOtherType: tenantData.tenant.industry_id === "education_consultancy" }),
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
  ]);

  const leadCollaboratorsMap = await getLeadCollaboratorsMapForLeads(
    serviceClient, tenantData.tenant.id, leads.map((l) => l.id),
  );

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
  const positionSlugMap = Object.fromEntries(
    teamMembersWithPositions.map((m) => [m.user_id, m.position_slug])
  );
  const memberRoleMap = Object.fromEntries(
    teamMembers.map((m) => [m.user_id, m.role])
  );

  const industry = industryResult.data as Industry | null;
  const entities = (entitiesResult.data || []) as TenantEntity[];

  const assignableMembers = filterAssignableMembersByChain(teamMembers, {
    baseTier: tenantData.permissions.baseTier,
    leadScope: tenantData.permissions.leadScope,
    branchId: tenantData.branchId,
    positionSlug: tenantData.positionSlug,
    industryId: tenantData.tenant.industry_id,
    selfUserId: tenantData.userId,
  });

  return (
    <div className="flex flex-col h-full min-h-0">
      <LeadsTable
        pageHeading={stagingList.name}
        beforeTable={<ReconciliationPanel rows={reconciliationRows} />}
        leads={leads}
        leadCollaborators={leadCollaboratorsMap}
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
        leadLists={pipelineLists}
        roleMap={roleMap}
        memberRoleMap={memberRoleMap}
        positionSlugMap={positionSlugMap}
        extraDefaultVisibleKeys={["assigned_role"]}
        isStagingView
        canExport={tenantData.permissions.canExport}
        canEditLeads={tenantData.permissions.canEditLeads}
        assignableMembers={assignableMembers}
        memberBranchMap={memberBranchMap}
      />
    </div>
  );
}
