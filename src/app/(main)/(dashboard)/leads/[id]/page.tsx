import { redirect, notFound } from "next/navigation";
import {
  getCurrentUserTenant,
  getLead,
  getLeadNotes,
  getLeadChecklists,
  getLeadActivity,
  getPipelineStages,
  getLeadListsByTenant,
  getListPipeline,
  getTeamMembers,
} from "@/lib/supabase/queries";
import { createServiceClient } from "@/lib/supabase/server";
import { LeadDetailV2 } from "@/components/dashboard/lead/lead-detail-v2";
import { canSeeNav, canAccessList, leadQueryScope, canEnrollStudents } from "@/lib/api/permissions";
import { isOffFunnelLeadList } from "@/lib/leads/list-funnel";
import { filterAssignableMembersByChain } from "@/lib/leads/assignable";
import { nextPositionSlug, ASSIGN_CHAIN_POSITIONS } from "@/industries/education-consultancy/lead-assignment-chain";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import type { TenantEntity, Industry, LeadList } from "@/types/database";

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!canSeeNav(tenantData.permissions, "/leads")) redirect("/dashboard");

  const lead = await getLead(id, tenantData.tenant.id, leadQueryScope(tenantData.permissions, tenantData.userId, tenantData.branchId));
  if (!lead) notFound();

  const serviceClient = await createServiceClient();

  const hasLeadLists = getFeatureAccess(tenantData.tenant.industry_id, FEATURES.LEAD_LISTS);
  const hasClasses = getFeatureAccess(tenantData.tenant.industry_id, FEATURES.CLASSES);
  const checkInActive = getFeatureAccess(tenantData.tenant.industry_id, FEATURES.CHECK_IN);

  const leadListId = (lead as unknown as { list_id?: string | null }).list_id ?? null;
  const [notes, checklists, activities, listPipelineResult, fallbackStages, entityResult, industryResult, allLists] = await Promise.all([
    getLeadNotes(lead.id),
    getLeadChecklists(lead.id),
    getLeadActivity(lead.id, tenantData.tenant.id),
    // Load this lead's list-pipeline stages (preferred); fallback to all tenant stages
    leadListId ? getListPipeline(leadListId, tenantData.tenant.id) : Promise.resolve(null),
    getPipelineStages(tenantData.tenant.id),
    // Fetch entity if lead has one
    lead.entity_id
      ? serviceClient
          .from("tenant_entities")
          .select("*")
          .eq("id", lead.entity_id)
          .single()
      : Promise.resolve({ data: null }),
    // Fetch industry if tenant has one
    tenantData.tenant.industry_id
      ? serviceClient
          .from("industries")
          .select("*")
          .eq("id", tenantData.tenant.industry_id)
          .single()
      : Promise.resolve({ data: null }),
    // Fetch lists when either feature is enabled (both rely on list positions)
    (hasLeadLists || hasClasses) ? getLeadListsByTenant(tenantData.tenant.id) : Promise.resolve([] as LeadList[]),
  ]);

  const entity = entityResult.data as TenantEntity | null;
  const industry = industryResult.data as Industry | null;
  // Use list-scoped stages when available; fall back to all tenant stages for leads without a list
  const stages = listPipelineResult?.stages ?? fallbackStages;

  const accessibleLists = hasLeadLists
    ? (allLists as LeadList[]).filter((l) =>
        canAccessList(
          tenantData.permissions,
          l.access as { mode: string; positionIds?: string[] },
          tenantData.positionId,
          l.id,
        )
      )
    : [];

  // Full active funnel (excludes archive + staging lists) so the list stepper
  // can compute true neighbours and show their names even when a step is
  // outside the caller's accessible lists.
  const activeLeadLists = hasLeadLists
    ? (allLists as LeadList[]).filter(
        (l) =>
          !isOffFunnelLeadList(l) &&
          !(l as unknown as { is_staging?: boolean }).is_staging
      )
    : [];

  // Compute list-position gates for Classes and Applications cards (education only)
  const allListsTyped = allLists as LeadList[];
  const qualifiedList = allListsTyped.find((l) => (l as unknown as { slug: string }).slug === "qualified");
  const prospectsListItem = allListsTyped.find((l) => (l as unknown as { slug: string }).slug === "prospects");
  const currentList = leadListId ? allListsTyped.find((l) => l.id === leadListId) : null;

  const currentSortOrder = currentList ? (currentList as unknown as { sort_order: number; is_archive: boolean }).sort_order : null;
  const currentIsArchive = currentList ? (currentList as unknown as { is_archive: boolean }).is_archive : false;

  const qualifiedSortOrder = qualifiedList ? (qualifiedList as unknown as { sort_order: number }).sort_order : null;
  const prospectsSortOrder = prospectsListItem ? (prospectsListItem as unknown as { sort_order: number }).sort_order : null;

  // classesActive: non-archive list AND sort_order >= qualified's sort_order
  const classesActive =
    hasClasses &&
    leadListId !== null &&
    currentSortOrder !== null &&
    qualifiedSortOrder !== null &&
    !currentIsArchive &&
    currentSortOrder >= qualifiedSortOrder;

  // applicationsActive: non-archive list AND sort_order >= prospects, OR legacy lead_type=prospect
  const applicationsActive =
    getFeatureAccess(tenantData.tenant.industry_id, FEATURES.APPLICATION_TRACKING) &&
    (
      (
        leadListId !== null &&
        currentSortOrder !== null &&
        prospectsSortOrder !== null &&
        !currentIsArchive &&
        currentSortOrder >= prospectsSortOrder
      ) ||
      (lead as unknown as { lead_type?: string | null }).lead_type === "prospect"
    );

  // Consent props — only query when applicationsActive to avoid extra DB calls
  let consentEnabled = false;
  let consentSigned = false;
  if (applicationsActive) {
    const [tplRes, signedRes] = await Promise.all([
      serviceClient
        .from("consent_templates")
        .select("is_active")
        .eq("tenant_id", tenantData.tenant.id)
        .maybeSingle(),
      serviceClient
        .from("lead_consents")
        .select("id")
        .eq("tenant_id", tenantData.tenant.id)
        .eq("lead_id", lead.id)
        .eq("status", "signed")
        .is("deleted_at", null)
        .limit(1)
        .maybeSingle(),
    ]);
    consentEnabled = (tplRes.data as { is_active: boolean } | null)?.is_active === true;
    consentSigned = !!signedRes.data;
  }

  // Full-roster user_id → display name map for the activity feed. Resolved
  // server-side so it works for non-admins (who can't call /api/v1/team).
  const roster = await getTeamMembers(tenantData.tenant.id);
  const memberNames = roster.reduce<Record<string, string>>((acc, m) => {
    acc[m.user_id] = m.name || m.email?.split("@")[0] || "Unknown";
    return acc;
  }, {});
  const assignableMembers = filterAssignableMembersByChain(roster, {
    baseTier: tenantData.permissions.baseTier,
    leadScope: tenantData.permissions.leadScope,
    branchId: tenantData.branchId,
    positionSlug: tenantData.positionSlug,
    industryId: tenantData.tenant.industry_id,
    selfUserId: tenantData.userId,
  });

  // Next-position members for "Send to next" assignment picker
  // Only computed for chain-position members in education_consultancy
  const isChainMember =
    tenantData.tenant.industry_id === "education_consultancy" &&
    tenantData.positionSlug != null &&
    ASSIGN_CHAIN_POSITIONS.has(tenantData.positionSlug) &&
    tenantData.permissions.baseTier === "member";
  const nextSlug = isChainMember ? nextPositionSlug(tenantData.positionSlug) : null;
  const nextPositionMembers = nextSlug
    ? roster.filter(
        (m) =>
          m.position_slug === nextSlug &&
          (tenantData.branchId == null || m.branch_id === tenantData.branchId),
      )
    : [];

  return (
    <LeadDetailV2
      lead={lead}
      memberNames={memberNames}
      notes={notes}
      checklists={checklists}
      activities={activities}
      stages={stages}
      tenant={tenantData.tenant}
      role={tenantData.role}
      userId={tenantData.userId}
      entity={entity}
      industry={industry}
      userBranchId={tenantData.branchId}
      leadScope={tenantData.permissions.leadScope}
      canAssign={tenantData.permissions.canAssignLeads}
      canEditLeads={tenantData.permissions.canEditLeads}
      assignableMembers={assignableMembers}
      nextPositionMembers={nextPositionMembers}
      canManageApplications={tenantData.permissions.canManageApplications}
      canEnroll={canEnrollStudents(tenantData.permissions, tenantData.positionSlug)}
      leadLists={accessibleLists}
      activeLeadLists={activeLeadLists}
      classesActive={classesActive}
      applicationsActive={applicationsActive}
      checkInActive={checkInActive}
      consentEnabled={consentEnabled}
      consentSigned={consentSigned}
    />
  );
}
