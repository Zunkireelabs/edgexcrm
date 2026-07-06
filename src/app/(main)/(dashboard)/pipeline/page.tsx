import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import {
  getCurrentUserTenant,
  getPipelineStages,
  getLeadsForPipeline,
  getTeamMembers,
  getPipelines,
  getLeadListsByTenant,
  getLeads,
} from "@/lib/supabase/queries";
import { createServiceClient } from "@/lib/supabase/server";
import { PipelineBoard } from "@/components/pipeline/PipelineBoard";
import { PipelineSelector } from "@/components/pipeline/PipelineSelector";
import { ListFunnelBoard } from "@/components/pipeline/ListFunnelBoard";
import { canSeeNav, leadQueryScope } from "@/lib/api/permissions";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { isOffFunnelLeadList } from "@/lib/leads/list-funnel";
import type { UserRole, TenantEntity, Industry, LeadList } from "@/types/database";

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

  const pipelineScope = leadQueryScope(tenantData.permissions, tenantData.userId, tenantData.branchId);
  // Admin cookie override: all-scope users can filter by a specific branch from the header
  if (tenantData.permissions.leadScope === "all" && branchCookieVal && branchCookieVal !== "all") {
    pipelineScope.branchId = branchCookieVal;
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

    const [leadsPerList, teamMembers] = await Promise.all([
      Promise.all(
        visibleLists.map((list) =>
          getLeads(tenantData.tenant.id, { ...pipelineScope, listId: list.id })
        )
      ),
      getTeamMembers(tenantData.tenant.id),
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
        <ListFunnelBoard lists={visibleLists} leadsByListId={leadsByListId} memberNames={memberNames} />
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

  const [stages, leads, teamMembers, industryResult, entitiesResult] = await Promise.all([
    getPipelineStages(tenantData.tenant.id, selectedPipelineId),
    getLeadsForPipeline(tenantData.tenant.id, {
      ...pipelineScope,
      pipelineId: selectedPipelineId,
    }),
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
      <PipelineBoard
        key={selectedPipelineId}
        stages={stages}
        leads={leads}
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
      />
    </div>
  );
}
