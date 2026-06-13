import { redirect, notFound } from "next/navigation";
import { getCurrentUserTenant, getTeamMembers } from "@/lib/supabase/queries";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { getDealPipelines, getDealPipelineStages, getDealsForPipeline } from "@/lib/deals/queries";
import { DealsWorkspace } from "@/industries/it-agency/features/deals/pages/deals-workspace";
import type { UserRole } from "@/types/database";

interface DealsPageProps {
  searchParams: Promise<{ pipeline?: string }>;
}

export default async function DealsRoute({ searchParams }: DealsPageProps) {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.DEALS)) notFound();

  const params = await searchParams;

  const pipelines = await getDealPipelines(tenantData.tenant.id);

  // Determine selected pipeline
  let selectedPipelineId = params.pipeline;
  if (!selectedPipelineId || !pipelines.find((p) => p.id === selectedPipelineId)) {
    const defaultPipeline = pipelines.find((p) => p.is_default) || pipelines[0];
    selectedPipelineId = defaultPipeline?.id;
  }

  if (!selectedPipelineId) {
    return (
      <div className="flex flex-col h-[calc(100vh-90px)]">
        <h1 className="text-xl font-bold mb-4">Deals</h1>
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          No pipelines found. Create your first deal to get started.
        </div>
      </div>
    );
  }

  const [stages, deals, teamMembers] = await Promise.all([
    getDealPipelineStages(tenantData.tenant.id, selectedPipelineId),
    getDealsForPipeline(tenantData.tenant.id, { pipelineId: selectedPipelineId }),
    getTeamMembers(tenantData.tenant.id),
  ]);

  return (
    <div className="flex flex-col h-[calc(100vh-90px)]">
      <DealsWorkspace
        tenantId={tenantData.tenant.id}
        role={tenantData.role as UserRole}
        pipelines={pipelines}
        selectedPipelineId={selectedPipelineId}
        stages={stages}
        deals={deals}
        teamMembers={teamMembers}
      />
    </div>
  );
}
