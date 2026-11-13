import { redirect, notFound } from "next/navigation";
import { getCurrentUserTenant, getTeamMembers } from "@/lib/supabase/queries";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { leadQueryScope } from "@/lib/api/permissions";
import { branchMemberIds } from "@/lib/leads/branch-membership";
import { visibleLeadsBase } from "@/lib/leads/visibility-query";
import { POSITION_ROUTE_MAP } from "@/industries/education-consultancy/features/new-leads-triage/position-routing";
import { runApplicationsQuery, APPLICATION_LIGHT_SELECT, type ApplicationsTab } from "@/industries/education-consultancy/features/application-tracking/lib/applications-query";
import { decodeApplicationParams, finishedStageIdSet } from "@/industries/education-consultancy/features/application-tracking/lib/applications-url";
import { assembleBoardTotals, isUnfilteredLoad, type BoardRow } from "@/industries/education-consultancy/features/application-tracking/lib/board-data";
import { resolvePipelineSelection } from "@/industries/education-consultancy/features/application-tracking/lib/pipeline-selection";
import { STUCK_DAYS } from "@/industries/education-consultancy/features/application-tracking/lib/card-metrics";
import { EMPTY_TREE, type CompileCtx } from "@/lib/filters/types";
import { fetchBoardCounts } from "@/industries/education-consultancy/features/application-tracking/lib/board-counts";
import { ApplicationsWorkspace } from "@/industries/education-consultancy/features/application-tracking/pages/applications-workspace";
import type { ApplicationStage, Application, ApplicationPipelineWithCounts, UserRole } from "@/types/database";

export default async function ApplicationsRoute({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.APPLICATION_TRACKING)) notFound();

  const supabase = await createServiceClient();
  const userClient = await createClient(); // RLS-context client — leads_visible_to_user() needs a real auth.uid()

  const poolSlug = tenantData.tenant.industry_id === "education_consultancy" && tenantData.positionSlug && tenantData.branchId
    ? (POSITION_ROUTE_MAP[tenantData.positionSlug] ?? null)
    : null;
  const scope = leadQueryScope(tenantData.permissions, tenantData.userId, tenantData.branchId ?? null, poolSlug);

  // leadIds: null = no filter (all); [] = empty result (own-scope with no leads)
  // teamMemberIds: set for team scope — filter via embedded lead's assigned_to (no large id list)
  let leadIds: string[] | null = null;
  let teamMemberIds: string[] | null = null;

  if (scope.restrictToSelf && scope.userId) {
    // Visibility-scoped (uncapped; migration 179) — includes collaborator-visible leads,
    // not just direct assignments.
    const { data, error } = await visibleLeadsBase({ user: userClient, service: supabase }, tenantData.tenant.id, scope).is("deleted_at", null);
    if (error) {
      console.error("[applications/page] own-scope lead visibility query failed", {
        tenantId: tenantData.tenant.id, userId: scope.userId, error,
      });
    }
    leadIds = (data ?? []).map((l: { id: string }) => l.id);
  } else if (scope.branchId) {
    teamMemberIds = await branchMemberIds(supabase, tenantData.tenant.id, scope.branchId);
  }
  // else: leadScope 'all' → no filter

  const scopeInput = { leadIds, teamMemberIds };
  const ctx: CompileCtx = {
    tz: tenantData.tenant.timezone || "UTC",
    now: new Date(),
    industryId: tenantData.tenant.industry_id,
    permissions: {},
  };

  // Filters live in the URL and run on the server (EDGEX-141 Phase 2).
  const decoded = decodeApplicationParams(sp, ctx);
  let filterError = decoded.filterError;
  // No chips, no search, All tab: the main query below IS the unfiltered read, so the light read
  // is skipped and every unfiltered number is derived from the main rows (fix round 1, M3).
  const unfiltered = isUnfilteredLoad(decoded);

  const [stagesResult, teamMembers, pipelinesResult, lightResult] = await Promise.all([
    supabase
      .from("application_stages")
      .select("*")
      .eq("tenant_id", tenantData.tenant.id)
      .order("position", { ascending: true }),
    // Roster for resolving counsellor ids -> names (cards + the Counsellor filter).
    getTeamMembers(tenantData.tenant.id),
    supabase
      .from("application_pipelines")
      .select("*")
      .eq("tenant_id", tenantData.tenant.id)
      .eq("is_active", true)
      .order("position", { ascending: true }),
    // Filtered loads only: one lightweight, UNfiltered read of the same scope for the numbers that
    // must not follow the chips (tabs, "of T", pipeline + stage totals, filter options + counts).
    unfiltered
      ? null
      : runApplicationsQuery({
          supabase, tenantId: tenantData.tenant.id, scope: scopeInput, tree: EMPTY_TREE, ctx,
          mode: "rows", select: APPLICATION_LIGHT_SELECT, sort: "stage",
        }),
  ]);

  const stages = (stagesResult.data ?? []) as ApplicationStage[];
  const rawPipelines = pipelinesResult.data ?? [];

  const tab: ApplicationsTab =
    decoded.tab === "mine"
      ? { mineUserId: tenantData.userId }
      : decoded.tab === "stuck"
        ? { stuck: { cutoffIso: new Date(ctx.now.getTime() - STUCK_DAYS * 86_400_000).toISOString(), finishedStageIds: [...finishedStageIdSet(stages)] } }
        : {};
  const queryFor = (tree: typeof EMPTY_TREE) =>
    runApplicationsQuery({
      supabase, tenantId: tenantData.tenant.id, scope: scopeInput, tree, q: decoded.q, tab, ctx,
      mode: "rows", sort: decoded.sort,
    });
  let rowsResult = await queryFor(decoded.tree);
  if (!rowsResult.ok) {
    // A tree the planner rejects (e.g. Counsellor inside an OR) becomes a chip message, never a 500.
    filterError = rowsResult.error;
    rowsResult = await queryFor(EMPTY_TREE);
  }
  if (!rowsResult.ok || rowsResult.mode !== "rows") {
    console.error("[applications/page] applications query failed", { tenantId: tenantData.tenant.id, error: rowsResult.ok ? "mode" : rowsResult.error });
  }
  const applications = rowsResult.ok && rowsResult.mode === "rows" ? rowsResult.rows : [];

  let lightRows: BoardRow[] | null = applications;
  if (lightResult) {
    if (lightResult.ok && lightResult.mode === "rows") {
      lightRows = lightResult.rows;
    } else {
      // Never silent zeros: log it like the main query; the totals then degrade (tab badges hide,
      // pipeline/stage/option counts fall back to the filtered rows) instead of reading 0.
      console.error("[applications/page] unfiltered count query failed", {
        tenantId: tenantData.tenant.id, error: lightResult.ok ? "mode" : lightResult.error,
      });
      lightRows = null;
    }
  }

  const selectedPipelineId = resolvePipelineSelection(typeof sp.pipeline === "string" ? sp.pipeline : null, rawPipelines);
  const totals = assembleBoardTotals({
    lightRows, mainRows: applications, stages, pipelines: rawPipelines, selectedPipelineId,
    userId: tenantData.userId, nowMs: ctx.now.getTime(),
  });

  const stageCountByPipeline = new Map<string, number>();
  for (const s of stages) {
    if (s.pipeline_id) stageCountByPipeline.set(s.pipeline_id, (stageCountByPipeline.get(s.pipeline_id) ?? 0) + 1);
  }
  // Pipeline counts are UNFILTERED totals (mockup: "Default pipeline 201" under "20 of 201"),
  // with the same placement the board uses (null-pipeline apps count under Default).
  const pipelines: ApplicationPipelineWithCounts[] = rawPipelines.map((p) => ({
    ...p,
    stage_count: stageCountByPipeline.get(p.id) ?? 0,
    application_count: totals.pipelineTotals[p.id] ?? 0,
  }));

  const { docsByApplication, openTasksByLead } = await fetchBoardCounts(supabase, tenantData.tenant.id, applications);
  const boardApplications: Application[] = applications.map((a) => ({
    ...a,
    doc_count: docsByApplication.get(a.id) ?? 0,
    open_task_count: openTasksByLead.get(a.lead_id) ?? 0,
  }));

  return (
    <div className="flex flex-col h-[calc(100vh-90px)]">
      <ApplicationsWorkspace
        stages={stages}
        applications={boardApplications}
        totals={totals}
        filterError={filterError}
        canManageApplications={tenantData.permissions.canManageApplications}
        teamMembers={teamMembers.map((m) => ({ user_id: m.user_id, name: m.name, email: m.email }))}
        pipelines={pipelines}
        role={tenantData.role as UserRole}
        tenantId={tenantData.tenant.id}
        userId={tenantData.userId}
      />
    </div>
  );
}
