import { redirect, notFound } from "next/navigation";
import { cookies } from "next/headers";
import { getCurrentUserTenant, getLeads, getLeadListsByTenant, getTeamMembers, getPipelineStages, getFormConfigsForTenant, getBranches, getListPipeline, getOpenTaskLeadIds } from "@/lib/supabase/queries";
import { getLeadCollaboratorsMap } from "@/lib/leads/collaborators";
import { createServiceClient } from "@/lib/supabase/server";
import { LeadsTable } from "@/components/dashboard/leads-table";
import { ListKanbanView } from "@/components/dashboard/leads/list-kanban-view";
import { FunnelKanbanBoard } from "@/components/dashboard/leads/funnel-kanban-board";
import { canSeeNav, canAccessList, leadQueryScope, isSharedPoolList, resolveEffectiveBranch } from "@/lib/api/permissions";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { POSITION_ROUTE_MAP as POSITION_HOME_LIST } from "@/industries/education-consultancy/features/new-leads-triage/position-routing";
import { filterAssignableMembersByChain } from "@/lib/leads/assignable";
import { canBypassProspectQualification } from "@/lib/leads/prospect-qualification";
import type { TenantEntity, Industry, LeadList, PipelineWithCounts } from "@/types/database";

const FUNNEL_LABELS: Record<string, string> = {
  lead_processing: "Lead Processing",
  sales_leads: "Sales Leads",
};

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ list?: string; view?: string; funnel?: string }>;
}) {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!canSeeNav(tenantData.permissions, "/leads")) redirect("/dashboard");

  const { list: listSlug, view, funnel: funnelParam } = await searchParams;
  const viewMode2 = view === "kanban" ? "kanban" : "list";

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

  // Build base scope; for all-scope admins apply the validated branch filter from the header switcher
  const poolSlug = tenantData.tenant.industry_id === "education_consultancy" && tenantData.positionSlug
    ? (POSITION_HOME_LIST[tenantData.positionSlug] ?? null)
    : null;
  const scope = leadQueryScope(tenantData.permissions, tenantData.userId, tenantData.branchId, poolSlug);
  if (tenantData.permissions.leadScope === "all" && effectiveBranch) {
    scope.branchId = effectiveBranch;
  }

  const hasLeadLists = getFeatureAccess(tenantData.tenant.industry_id, FEATURES.LEAD_LISTS);
  const isAdminOrOwner = tenantData.role === "owner" || tenantData.role === "admin";

  // Resolve list slug → list object (and archive exclusion for master view)
  let activeList: LeadList | null = null;
  let allLists: LeadList[] = [];
  let activeFunnelLists: LeadList[] = [];
  if (hasLeadLists) {
    allLists = await getLeadListsByTenant(tenantData.tenant.id);

    // it_agency funnel workspace (?funnel=lead_processing|sales_leads, no ?list=): all
    // of the funnel's stage-lists at once. Access-filtered same as any other list.
    if (!listSlug && funnelParam) {
      activeFunnelLists = allLists
        .filter((l) => l.funnel_key === funnelParam)
        .filter((l) =>
          canAccessList(
            tenantData.permissions,
            l.access as { mode: string; positionIds?: string[] },
            tenantData.positionId,
            l.id,
          ),
        )
        .sort((a, b) => a.sort_order - b.sort_order);
    }

    if (listSlug) {
      const found = allLists.find((l) => l.slug === listSlug);
      if (found) {
        // Staging lists (e.g. New Leads) are admin/owner only — block direct ?list= URL bypass.
        if (found.is_staging && !isAdminOrOwner) notFound();
        const accessible = canAccessList(
          tenantData.permissions,
          found.access as { mode: string; positionIds?: string[] },
          tenantData.positionId,
          found.id,
        );
        if (!accessible) notFound(); // bar URL bypass: forbidden list → 404, not master view
        activeList = found;
      }
    }
    // "All Leads" (no ?list=): admin/owner see the global view; everyone else lands
    // on their position's home list. Falls back to first accessible list if no mapping.
    // Skipped when a valid funnel workspace is requested — that's a deliberate view choice.
    if (!listSlug && activeFunnelLists.length === 0) {
      if (!isAdminOrOwner) {
        const homeSlug = tenantData.positionSlug ? POSITION_HOME_LIST[tenantData.positionSlug] : null;
        const homeList = homeSlug
          ? allLists.find((l) => l.slug === homeSlug && !l.is_archive && !l.is_staging)
          : null;
        if (homeList && canAccessList(
          tenantData.permissions,
          homeList.access as { mode: string; positionIds?: string[] },
          tenantData.positionId,
          homeList.id,
        )) {
          redirect(`/leads?list=${homeList.slug}`);
        }
        // Fallback: first accessible funnel list (for users with no position mapping)
        const firstFunnel = allLists
          .filter((l) => !l.is_archive && !l.is_staging)
          .filter((l) =>
            canAccessList(
              tenantData.permissions,
              l.access as { mode: string; positionIds?: string[] },
              tenantData.positionId,
              l.id,
            ),
          )
          .sort((a, b) => a.sort_order - b.sort_order)[0];
        if (firstFunnel) redirect(`/leads?list=${firstFunnel.slug}`);
      }
    }

    const excludeIds = allLists.filter((l) => l.is_archive || l.is_staging).map((l) => l.id);
    if (activeList?.slug === "delete") {
      scope.onlyDeleted = true; // Delete view = recycle bin of soft-deleted leads
    } else if (activeList) {
      scope.listId = activeList.id;
      // Shared-pool override: for own-scope holders, this list is a branch-wide pool.
      // Widen from own-only to their whole branch (reuses the branch-scope path in getLeads).
      // Guard: no branch ⇒ don't widen (stays own-scope), mirroring the §4.1 NULL-branch rule.
      if (isSharedPoolList(tenantData.permissions, activeList.id) && tenantData.branchId) {
        scope.restrictToSelf = false;
        scope.branchId = tenantData.branchId;
      }
    } else if (activeFunnelLists.length > 0) {
      scope.listIds = activeFunnelLists.map((l) => l.id);
    } else {
      scope.excludeListIds = excludeIds;
    }
  }

  // View mode for the leads table: "trash" (recycle bin), "archived", or "normal".
  const tableViewMode: "trash" | "archived" | "normal" =
    activeList?.slug === "delete" ? "trash" : activeList?.is_archive ? "archived" : "normal";
  const intakeListId = allLists.find((l) => l.is_intake)?.id ?? null;

  // Kanban is only available for normal (non-trash, non-archive) lists that have a pipeline
  const canShowKanban =
    viewMode2 === "kanban" &&
    activeList !== null &&
    tableViewMode === "normal";

  // Funnel-level kanban: columns are the funnel's stages (lists), not one list's statuses.
  const canShowFunnelKanban = viewMode2 === "kanban" && activeList === null && activeFunnelLists.length > 0;

  // Load the list's pipeline when kanban is requested
  const listPipelineResult =
    canShowKanban && activeList
      ? await getListPipeline(activeList.id, tenantData.tenant.id)
      : null;

  const [leads, teamMembers, stages, formConfigs, industryResult, entitiesResult, leadCollaboratorsMap] =
    await Promise.all([
      getLeads(tenantData.tenant.id, { ...scope, limit: 50000, excludeOtherType: tenantData.tenant.industry_id === "education_consultancy" }),
      getTeamMembers(tenantData.tenant.id),
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
      getLeadCollaboratorsMap(serviceClient, tenantData.tenant.id),
    ]);

  const memberMap = Object.fromEntries(teamMembers.map((m) => [m.user_id, m.email]));
  const memberNames = Object.fromEntries(teamMembers.map((m) => [m.user_id, m.name]));
  const memberBranchMap = Object.fromEntries(
    teamMembers.filter((m) => m.branch_id).map((m) => [m.user_id, m.branch_id as string])
  );
  const formMap = Object.fromEntries(formConfigs.map((f) => [f.id, f.name]));
  const roleMap = Object.fromEntries(
    teamMembers.map((m) => [m.user_id, m.position_name ?? m.role])
  );
  const positionSlugMap = Object.fromEntries(
    teamMembers.map((m) => [m.user_id, m.position_slug])
  );

  const industry = industryResult.data as Industry | null;
  const entities = (entitiesResult.data || []) as TenantEntity[];

  const pageHeading = activeList
    ? activeList.name
    : activeFunnelLists.length > 0
    ? FUNNEL_LABELS[funnelParam as string] ?? "All Leads"
    : "All Leads";

  // Pass lead lists (accessible ones) for the move-to-list selector
  const accessibleLists = hasLeadLists
    ? allLists.filter((l) =>
        canAccessList(
          tenantData.permissions,
          l.access as { mode: string; positionIds?: string[] },
          tenantData.positionId,
          l.id,
        )
      )
    : [];

  const isAdmin = tenantData.role === "owner" || tenantData.role === "admin";
  const assignableMembers = filterAssignableMembersByChain(teamMembers, {
    baseTier: tenantData.permissions.baseTier,
    leadScope: tenantData.permissions.leadScope,
    branchId: tenantData.branchId,
    positionSlug: tenantData.positionSlug,
    industryId: tenantData.tenant.industry_id,
    selfUserId: tenantData.userId,
  });

  // Render kanban board when requested and list has a pipeline
  if (canShowKanban && listPipelineResult && activeList) {
    const pipeline: PipelineWithCounts = {
      ...listPipelineResult.pipeline,
      stage_count: listPipelineResult.stages.length,
      lead_count: leads.length,
    };

    return (
      <div className="flex flex-col h-full min-h-0">
        <h1 className="shrink-0 text-lg font-bold pl-4 pt-4 mb-2 pr-6">{pageHeading}</h1>
        <ListKanbanView
          listSlug={activeList.slug}
          pipeline={pipeline}
          stages={listPipelineResult.stages}
          leads={leads}
          role={tenantData.role as "owner" | "admin" | "viewer" | "counselor"}
          userId={tenantData.userId}
          tenantId={tenantData.tenant.id}
          teamMembers={teamMembers}
          entities={entities}
          entityLabel={industry?.entity_type_label}
          industryId={tenantData.tenant.industry_id}
          isAdmin={isAdmin}
          canEditLeads={tenantData.permissions.canEditLeads}
          restrictToSelf={tenantData.permissions.leadScope === "own"}
        />
      </div>
    );
  }

  // Funnel-level kanban: columns = the funnel's stages (lists)
  if (canShowFunnelKanban) {
    return (
      <div className="flex flex-col h-full min-h-0">
        <h1 className="shrink-0 text-lg font-bold pl-4 pt-4 mb-2 pr-6">{pageHeading}</h1>
        <FunnelKanbanBoard
          lists={activeFunnelLists}
          leads={leads}
          canEdit={tenantData.permissions.canEditLeads ?? tenantData.role !== "viewer"}
          restrictToSelf={tenantData.permissions.leadScope === "own"}
          userId={tenantData.userId}
          industryId={tenantData.tenant.industry_id}
          bypassQualification={canBypassProspectQualification(
            tenantData.permissions.baseTier, tenantData.positionSlug
          )}
        />
      </div>
    );
  }

  // Default: list view
  const hasListPipeline = !!(activeList && activeList.pipeline_id) || activeFunnelLists.length > 0;

  // it_agency "no next task" signal (Sales Leads) — cheap at today's volumes; scoped to
  // this render's lead set, not the whole tenant.
  const openTaskLeadIds =
    tenantData.tenant.industry_id === "it_agency" && leads.length > 0
      ? await getOpenTaskLeadIds(tenantData.tenant.id, leads.map((l) => l.id))
      : undefined;

  return (
    <div className="flex flex-col h-full min-h-0">
      <LeadsTable
        pageHeading={pageHeading}
        pageHeadingClassName="shrink-0 text-lg font-bold pl-4 pt-4 mb-4 pr-6"
        leads={leads}
        openTaskLeadIds={openTaskLeadIds}
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
        leadLists={accessibleLists}
        viewMode={tableViewMode}
        {...(tableViewMode === "archived"
          ? { extraDefaultVisibleKeys: ["archived_from_stage", "archived_from_status", "archived_by", "archived_at"] }
          : {})}
        intakeListId={intakeListId}
        canExport={tenantData.permissions.canExport}
        canEditLeads={tenantData.permissions.canEditLeads}
        assignableMembers={assignableMembers}
        memberBranchMap={memberBranchMap}
        defaultListId={activeList && !activeList.is_staging && !activeList.is_archive ? activeList.id : undefined}
        lockedList={
          activeList && activeList.slug !== "delete"
            ? { id: activeList.id, name: activeList.name, is_archive: activeList.is_archive }
            : undefined
        }
        activeListSlug={activeList?.slug ?? null}
        activeFunnelKey={activeFunnelLists.length > 0 ? funnelParam ?? null : null}
        hasListPipeline={hasListPipeline}
        isTeamScoped={tenantData.permissions.leadScope === "team"}
        roleMap={roleMap}
        positionSlugMap={positionSlugMap}
        allLeadLists={allLists.filter((l) => !l.is_archive && !l.is_staging)}
        currentUserPositionSlug={tenantData.positionSlug}
      />
    </div>
  );
}
