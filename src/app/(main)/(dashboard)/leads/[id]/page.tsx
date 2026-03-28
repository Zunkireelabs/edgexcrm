import { redirect, notFound } from "next/navigation";
import {
  getCurrentUserTenant,
  getLead,
  getLeadNotes,
  getLeadChecklists,
  getLeadActivity,
  getPipelineStages,
} from "@/lib/supabase/queries";
import { createServiceClient } from "@/lib/supabase/server";
import { LeadDetailV2 } from "@/components/dashboard/lead/lead-detail-v2";
import type { TenantEntity, Industry } from "@/types/database";

export default async function LeadDetailPage({
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

  const [notes, checklists, activities, stages, entityResult, industryResult] = await Promise.all([
    getLeadNotes(lead.id),
    getLeadChecklists(lead.id),
    getLeadActivity(lead.id, tenantData.tenant.id),
    getPipelineStages(tenantData.tenant.id),
    // Fetch entity if lead has one
    lead.entity_id
      ? serviceClient
          .from("tenant_entities")
          .select("*")
          .eq("id", lead.entity_id)
          .single()
      : Promise.resolve({ data: null }),
    // Fetch industry if tenant has one
    tenantData.tenant.industry_id
      ? serviceClient
          .from("industries")
          .select("*")
          .eq("id", tenantData.tenant.industry_id)
          .single()
      : Promise.resolve({ data: null }),
  ]);

  const entity = entityResult.data as TenantEntity | null;
  const industry = industryResult.data as Industry | null;

  return (
    <LeadDetailV2
      lead={lead}
      notes={notes}
      checklists={checklists}
      activities={activities}
      stages={stages}
      tenant={tenantData.tenant}
      role={tenantData.role}
      userId={tenantData.userId}
      entity={entity}
      industry={industry}
    />
  );
}
