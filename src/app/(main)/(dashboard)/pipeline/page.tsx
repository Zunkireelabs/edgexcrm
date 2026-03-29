import { redirect } from "next/navigation";
import {
  getCurrentUserTenant,
  getPipelineStages,
  getLeadsForPipeline,
} from "@/lib/supabase/queries";
import { PipelineBoard } from "@/components/pipeline/PipelineBoard";
import type { UserRole } from "@/types/database";

export default async function PipelinePage() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");

  const [stages, leads] = await Promise.all([
    getPipelineStages(tenantData.tenant.id),
    getLeadsForPipeline(tenantData.tenant.id, {
      role: tenantData.role,
      userId: tenantData.userId,
    }),
  ]);

  return (
    <div className="flex flex-col h-[calc(100vh-90px)]">
      <h1 className="shrink-0 text-lg font-bold mb-4">Pipeline</h1>
      <PipelineBoard
        stages={stages}
        leads={leads}
        role={tenantData.role as UserRole}
        userId={tenantData.userId}
        tenantId={tenantData.tenant.id}
      />
    </div>
  );
}
