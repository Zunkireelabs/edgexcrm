import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import {
  getCurrentUserTenant,
  getPipelineStages,
  getLeadsPage,
  getTeamMembers,
  getPipelines,
  getLeadListsByTenant,
  getLeads,
  getBranchIds,
} from "@/lib/supabase/queries";
import { getLeadAggregates, type AggregateScope } from "@/lib/leads/aggregates";
import { createServiceClient } from "@/lib/supabase/server";
import { KanbanBoard } from "@/components/pipeline/KanbanBoard";
import { PipelineSelector } from "@/components/pipeline/PipelineSelector";
import { ListFunnelBoard } from "@/components/pipeline/ListFunnelBoard";
import { canSeeNav, leadQueryScope, resolveEffectiveBranch } from "@/lib/api/permissions";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { isOffFunnelLeadList } from "@/lib/leads/list-funnel";
import type { UserRole, TenantEntity, Industry, LeadList, PipelineLead } from "@/types/database";

// SSR-seeded page 1 (20 cards) + true count per column, keyed by stage.id — same
// shape as ListKanbanView's initialColumns (KANBAN-PAGINATION-BRIEF §3.1), computed
// here via getLeadAggregates()'s `stage` dimension (migration 194) + one getLeadsPage
// per stage (each scoped by the Phase 1 stage_id filter, mirrored server-side via
// getLeadsPage's `stageId` option) instead of the old capped-at-500 getLeadsForPipeline.
const KANBAN_PAGE_SIZE = 20;

interface PipelinePageProps {
  searchParams: Promise<{ pipeline?: string }>;
}

export default async function PipelinePage({ searchParams }: PipelinePageProps) {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!canSeeNav(tenantData.permissions, "/pipeline")) redirect("/dashboard");

  const params = await searchParams;
  const [serviceClient, cookieStore] = await Promise.all([
    createServiceClient(),
    cookies(),
  ]);
  const branchCookieVal = cookieStore.get("edgex_branch")?.value ?? null;
  const validBranchIds =
    tenantData.entitlements.maxBranches > 1 ? await getBranchIds(tenantData.tenant.id) : [];
  const effectiveBranch = resolveEffectiveBranch(branchCookieVal, validBranchIds);

  const pipelineScope = leadQueryScope(tenantData.permissions, tenantData.userId, tenantData.branchId);
  // Admin cookie override: all-scope users can filter by a specific branch from the header
  if (tenantData.permissions.leadScope === "all" && effectiveBranch) {
    pipelineScope.branchId = effectiveBranch;
  }

  // Tenants with the Lead Lists feature get a read-only Kanban keyed off list
  // membership (Pre-qualified → Qualified → Prospects → Applications, plus the
  // intake/staging list for owner/admin only) instead of the classic single-
  // pipeline board below. No drag-and-drop — view only, by design.
  const hasLeadLists = getFeatureAccess(tenantData.tenant.industry_id, FEATURES.LEAD_LISTS);
  if (hasLeadLists) {
    const isAdminOrOwner = tenantData.role === "owner" || tenantData.role === "admin";
    const allLists = (await getLeadListsByTenant(tenantData.tenant.id)) as LeadList[];
    const funnelLists = allLists
      .filter((l) => !isOffFunnelLeadList(l) && !l.is_staging)
      .sort((a, b) => a.sort_order - b.sort_order);
    const intakeStagingList = isAdminOrOwner
      ? allLists.find((l) => l.is_staging && l.is_intake) ?? null
      : null;
    const visibleLists = intakeStagingList ? [intakeStagingList, ...funnelLists] : funnelLists;

    const excludeOtherType = tenantData.tenant.industry_id === "education_consultancy";

    // Card loading stays as-is (getLeads, capped at its default 1,000/list) — per-column
    // card pagination is the follow-up brief (merges with the Kanban item at
    // leads/page.tsx:184). The column HEADER count and status chips below come from
    // lead_aggregates() instead — exact, uncapped — so a column can show a true count
    // above a partial card list. That is a known, accepted, temporary state; see the
    // PR report.
    const [leadsPerList, teamMembers, aggregates] = await Promise.all([
      Promise.all(
        visibleLists.map((list) =>
          getLeads(tenantData.tenant.id, {
            ...pipelineScope,
            listId: list.id,
            excludeOtherType,
          })
        )
      ),
      getTeamMembers(tenantData.tenant.id),
      getLeadAggregates(tenantData.tenant.id, { ...pipelineScope, excludeOtherType }, new Date()),
    ]);

    const leadsByListId: Record<string, (typeof leadsPerList)[number]> = {};
    visibleLists.forEach((list, i) => {
      leadsByListId[list.id] = leadsPerList[i];
    });

    const memberNames = teamMembers.reduce<Record<string, string>>((acc, m) => {
      acc[m.user_id] = m.name || m.email?.split("@")[0] || "Unknown";
      return acc;
    }, {});

    return (
      <div className="flex flex-col h-[calc(100vh-90px)]">
        <div className="flex items-center justify-between shrink-0 mb-4">
          <h1 className="text-lg font-bold">Pipeline</h1>
        </div>
        <ListFunnelBoard
          lists={visibleLists}
          leadsByListId={leadsByListId}
          memberNames={memberNames}
          listCounts={aggregates.list}
          listStatuses={aggregates.listStatuses}
        />
      </div>
    );
  }

  // Fetch all pipelines first
  const pipelines = await getPipelines(tenantData.tenant.id);

  // Determine selected pipeline
  let selectedPipelineId = params.pipeline;

  // If no pipeline selected or invalid, use default
  if (!selectedPipelineId || !pipelines.find((p) => p.id === selectedPipelineId)) {
    const defaultPipeline = pipelines.find((p) => p.is_default) || pipelines[0];
    selectedPipelineId = defaultPipeline?.id;
  }

  // If still no pipeline (shouldn't happen), show empty state
  if (!selectedPipelineId) {
    return (
      <div className="flex flex-col h-[calc(100vh-90px)]">
        <div className="flex items-center gap-3 shrink-0 mb-4">
          <h1 className="text-lg font-bold">Pipeline</h1>
        </div>
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          No pipelines found. Create your first pipeline to get started.
        </div>
      </div>
    );
  }

  const excludeOtherType = tenantData.tenant.industry_id === "education_consultancy";

  const [stages, teamMembers, industryResult, entitiesResult] = await Promise.all([
    getPipelineStages(tenantData.tenant.id, selectedPipelineId),
    getTeamMembers(tenantData.tenant.id),
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

  // Per-column first pages (20 cards) + exact per-stage totals from lead_aggregates()
  // (migration 194's `stage` dimension) — replaces getLeadsForPipeline's capped-at-500
  // full board load (KANBAN-PAGINATION-BRIEF-style fix, applied to the classic
  // single-pipeline board). Each stage.id is unique to this pipeline (stages are
  // fetched scoped to selectedPipelineId above), so no extra pipeline_id filter is
  // needed alongside the per-stage getLeadsPage call.
  const aggScope: AggregateScope = {
    restrictToSelf: pipelineScope.restrictToSelf,
    userId: pipelineScope.userId,
    branchId: pipelineScope.branchId,
    userBranchId: pipelineScope.userBranchId,
    crossBranchPoolListSlug: pipelineScope.crossBranchPoolListSlug,
    pipelineIds: pipelineScope.pipelineIds,
    excludeOtherType,
  };
  const [aggregates, columnPages] = await Promise.all([
    getLeadAggregates(tenantData.tenant.id, aggScope, new Date()),
    Promise.all(
      stages.map((stage) =>
        getLeadsPage(
          tenantData.tenant.id,
          { ...pipelineScope, stageId: stage.id, excludeOtherType },
          1,
          KANBAN_PAGE_SIZE,
          { skipCount: true },
        ).then((r) => [stage.id, r.leads] as const),
      ),
    ),
  ]);
  const initialColumns: Record<string, { cards: PipelineLead[]; total: number }> = {};
  for (const [stageId, cards] of columnPages) {
    initialColumns[stageId] = {
      // Same PipelineLead-shaped cast as ListKanbanView's initialColumns — /api/v1/
      // leads' (and getLeadsPage's) column projection doesn't carry
      // checklist_total/checklist_completed, which LeadCard treats as optional.
      cards: cards as unknown as PipelineLead[],
      total: aggregates.stage[stageId]?.all ?? 0,
    };
  }

  const industry = industryResult.data as Industry | null;
  const entities = (entitiesResult.data || []) as TenantEntity[];

  return (
    <div className="flex flex-col h-[calc(100vh-90px)]">
      {/* Header with Pipeline Selector */}
      <div className="flex items-center justify-between shrink-0 mb-4">
        <h1 className="text-lg font-bold">Pipeline</h1>
        <PipelineSelector
          pipelines={pipelines}
          selectedPipelineId={selectedPipelineId}
          role={tenantData.role as UserRole}
          tenantId={tenantData.tenant.id}
        />
      </div>

      {/* Pipeline Board — keyed on pipeline so switching pipelines remounts and
          re-seeds the board's columns from the correct leads (fixes stale-view F8) */}
      <KanbanBoard
        key={selectedPipelineId}
        mode="stage"
        stages={stages}
        initialColumns={initialColumns}
        role={tenantData.role as UserRole}
        userId={tenantData.userId}
        tenantId={tenantData.tenant.id}
        pipelineId={selectedPipelineId}
        teamMembersData={teamMembers}
        entities={entities}
        entityLabel={industry?.entity_type_label}
        industryId={tenantData.tenant.industry_id}
        canEditLeads={tenantData.permissions.canEditLeads}
        restrictToSelf={tenantData.permissions.leadScope === "own"}
        isTeamScoped={tenantData.permissions.leadScope === "team"}
      />
    </div>
  );
}
