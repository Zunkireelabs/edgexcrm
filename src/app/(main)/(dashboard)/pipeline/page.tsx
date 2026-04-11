import { redirect } from "next/navigation";
import {
  getCurrentUserTenant,
  getPipelineStages,
  getLeadsForPipeline,
  getTeamMembers,
  getPipelines,
  getDefaultPipeline,
} from "@/lib/supabase/queries";
import { createServiceClient } from "@/lib/supabase/server";
import { PipelineBoard } from "@/components/pipeline/PipelineBoard";
import { PipelineSelector } from "@/components/pipeline/PipelineSelector";
import type { UserRole, TenantEntity, Industry } from "@/types/database";

interface PipelinePageProps {
  searchParams: Promise<{ pipeline?: string }>;
}

export default async function PipelinePage({ searchParams }: PipelinePageProps) {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");

  const params = await searchParams;
  const serviceClient = await createServiceClient();

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
      role: tenantData.role,
      userId: tenantData.userId,
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

      {/* Pipeline Board */}
      <PipelineBoard
        stages={stages}
        leads={leads}
        role={tenantData.role as UserRole}
        userId={tenantData.userId}
        tenantId={tenantData.tenant.id}
        pipelineId={selectedPipelineId}
        teamMembersData={teamMembers}
        entities={entities}
        entityLabel={industry?.entity_type_label}
      />
    </div>
  );
}
