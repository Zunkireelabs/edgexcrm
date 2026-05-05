import { redirect, notFound } from "next/navigation";
import {
  getCurrentUserTenant,
  getLead,
  getPipelineStages,
} from "@/lib/supabase/queries";
import { createServiceClient } from "@/lib/supabase/server";
import { CheckInDetailPage } from "@/components/dashboard/check-in-detail-page";
import type { TenantEntity, LeadNote, PipelineStage } from "@/types/database";

export default async function CheckInDetailRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");

  const lead = await getLead(id, tenantData.tenant.id, {
    role: tenantData.role,
    userId: tenantData.userId,
  });
  if (!lead) notFound();

  const serviceClient = await createServiceClient();

  const [stages, entityResult, checkInNotesResult, teamResult] = await Promise.all([
    getPipelineStages(tenantData.tenant.id),
    lead.entity_id
      ? serviceClient
          .from("tenant_entities")
          .select("*")
          .eq("id", lead.entity_id)
          .single()
      : Promise.resolve({ data: null }),
    serviceClient
      .from("lead_notes")
      .select("id, content, created_at, user_email")
      .eq("lead_id", id)
      .like("content", "[CHECK-IN]%")
      .order("created_at", { ascending: false }),
    serviceClient
      .from("tenant_users")
      .select("user_id, role, users:user_id(email)")
      .eq("tenant_id", tenantData.tenant.id),
  ]);

  const entity = entityResult.data as TenantEntity | null;
  const checkInNotes = (checkInNotesResult.data || []) as Pick<LeadNote, "id" | "content" | "created_at" | "user_email">[];

  // Build member map for assigned_to display
  const memberMap: Record<string, string> = {};
  if (teamResult.data) {
    for (const m of teamResult.data) {
      const user = m.users as unknown as { email: string } | null;
      if (user?.email) {
        memberMap[m.user_id] = user.email;
      }
    }
  }

  // Find the lead's stage and pipeline info
  const allStages = stages as PipelineStage[];
  const currentStage = allStages.find((s) => s.id === lead.stage_id);

  // Get pipeline name
  let pipelineName: string | null = null;
  if (lead.pipeline_id) {
    const { data: pipeline } = await serviceClient
      .from("pipelines")
      .select("name")
      .eq("id", lead.pipeline_id)
      .single();
    pipelineName = pipeline?.name || null;
  }

  return (
    <CheckInDetailPage
      lead={lead}
      stageName={currentStage?.name || null}
      stageColor={currentStage?.color || null}
      pipelineName={pipelineName}
      entityName={entity?.name || null}
      assignedToEmail={lead.assigned_to ? memberMap[lead.assigned_to] || null : null}
      checkInHistory={checkInNotes}
    />
  );
}
