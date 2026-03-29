import { redirect } from "next/navigation";
import {
  getCurrentUserTenant,
  getPipelineStages,
  getLeadsForPipeline,
  getTeamMembers,
} from "@/lib/supabase/queries";
import { createServiceClient } from "@/lib/supabase/server";
import { PipelineBoard } from "@/components/pipeline/PipelineBoard";
import type { UserRole, TenantEntity, Industry } from "@/types/database";

export default async function PipelinePage() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");

  const serviceClient = await createServiceClient();

  const [stages, leads, teamMembers, industryResult, entitiesResult] = await Promise.all([
    getPipelineStages(tenantData.tenant.id),
    getLeadsForPipeline(tenantData.tenant.id, {
      role: tenantData.role,
      userId: tenantData.userId,
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
      <h1 className="shrink-0 text-lg font-bold mb-4">Pipeline</h1>
      <PipelineBoard
        stages={stages}
        leads={leads}
        role={tenantData.role as UserRole}
        userId={tenantData.userId}
        tenantId={tenantData.tenant.id}
        teamMembersData={teamMembers}
        entities={entities}
        entityLabel={industry?.entity_type_label}
      />
    </div>
  );
}
