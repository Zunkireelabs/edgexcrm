import { redirect, notFound } from "next/navigation";
import { getCurrentUserTenant, getTeamMembers } from "@/lib/supabase/queries";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { resolveApplicationsScope } from "@/industries/education-consultancy/features/application-tracking/lib/applications-scope";
import { loadBoardMeta, loadBoardPage } from "@/industries/education-consultancy/features/application-tracking/lib/board-load";
import { ApplicationsWorkspace } from "@/industries/education-consultancy/features/application-tracking/pages/applications-workspace";
import type { CompileCtx } from "@/lib/filters/types";
import type { ApplicationPipelineWithCounts, UserRole } from "@/types/database";

// EDGEX-141 Phase 3: the board renders from two light INDEX reads (unfiltered + filtered; one read
// on an unfiltered load), paged past PostgREST's 1000-row cap, plus full card rows for the first 25
// of each expanded column. "Show N more" pages through GET /api/v1/applications/board-page, which
// rebuilds the same index from the same URL state with the same scope helper.

export default async function ApplicationsRoute({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.APPLICATION_TRACKING)) notFound();

  const supabase = await createServiceClient();
  const userClient = await createClient(); // RLS-context client — leads_visible_to_user() needs a real auth.uid()
  const tenantId = tenantData.tenant.id;

  const ctx: CompileCtx = {
    tz: tenantData.tenant.timezone || "UTC",
    now: new Date(),
    industryId: tenantData.tenant.industry_id,
    permissions: {},
  };

  const [resolved, meta, teamMembers] = await Promise.all([
    resolveApplicationsScope(
      { user: userClient, service: supabase },
      {
        tenantId, userId: tenantData.userId, industryId: tenantData.tenant.industry_id, permissions: tenantData.permissions,
        branchId: tenantData.branchId ?? null, positionSlug: tenantData.positionSlug ?? null,
      },
    ),
    loadBoardMeta(supabase, tenantId),
    // Roster for resolving counsellor ids -> names (cards + the Counsellor filter).
    getTeamMembers(tenantId),
  ]);
  if (resolved.error) {
    console.error("[applications/page] own-scope lead visibility query failed", { tenantId, userId: tenantData.userId, error: resolved.error });
  }

  const { board, totals, filterError } = await loadBoardPage({
    supabase, tenantId, userId: tenantData.userId, scope: resolved.scope, ctx, params: sp, meta,
  });

  const stageCountByPipeline = new Map<string, number>();
  for (const s of meta.stages) {
    if (s.pipeline_id) stageCountByPipeline.set(s.pipeline_id, (stageCountByPipeline.get(s.pipeline_id) ?? 0) + 1);
  }
  // Pipeline counts are UNFILTERED totals (mockup: "Default pipeline 201" under "20 of 201"),
  // with the same placement the board uses (null-pipeline apps count under Default).
  const pipelines: ApplicationPipelineWithCounts[] = meta.pipelines.map((p) => ({
    ...p,
    stage_count: stageCountByPipeline.get(p.id) ?? 0,
    application_count: totals.pipelineTotals[p.id] ?? 0,
  }));

  return (
    <div className="flex flex-col h-[calc(100vh-90px)]">
      <ApplicationsWorkspace
        stages={meta.stages}
        board={board}
        totals={totals}
        filterError={filterError}
        canManageApplications={tenantData.permissions.canManageApplications}
        teamMembers={teamMembers.map((m) => ({ user_id: m.user_id, name: m.name, email: m.email }))}
        pipelines={pipelines}
        role={tenantData.role as UserRole}
        tenantId={tenantId}
        userId={tenantData.userId}
      />
    </div>
  );
}
