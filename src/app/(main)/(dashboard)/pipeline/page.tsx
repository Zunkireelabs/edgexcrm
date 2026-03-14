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
    <div className="flex flex-col h-[calc(100vh-4rem)] md:h-[calc(100vh-3rem)]">
      <div className="mb-4 shrink-0">
        <h1 className="text-2xl font-bold">Pipeline</h1>
        <p className="text-muted-foreground">
          Drag leads between stages to update their status
        </p>
      </div>
      <div className="flex-1 min-h-0">
        <PipelineBoard
          stages={stages}
          leads={leads}
          role={tenantData.role as UserRole}
          userId={tenantData.userId}
          tenantId={tenantData.tenant.id}
        />
      </div>
    </div>
  );
}
