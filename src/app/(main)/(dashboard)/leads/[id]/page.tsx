import { redirect, notFound } from "next/navigation";
import {
  getCurrentUserTenant,
  getLead,
  getLeadNotes,
  getLeadChecklists,
  getLeadActivity,
  getPipelineStages,
  getLeadListsByTenant,
} from "@/lib/supabase/queries";
import { createServiceClient } from "@/lib/supabase/server";
import { LeadDetailV2 } from "@/components/dashboard/lead/lead-detail-v2";
import { canSeeNav, canAccessList, leadQueryScope } from "@/lib/api/permissions";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import type { TenantEntity, Industry, LeadList } from "@/types/database";

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!canSeeNav(tenantData.permissions, "/leads")) redirect("/dashboard");

  const lead = await getLead(id, tenantData.tenant.id, leadQueryScope(tenantData.permissions, tenantData.userId, tenantData.branchId));
  if (!lead) notFound();

  const serviceClient = await createServiceClient();

  const hasLeadLists = getFeatureAccess(tenantData.tenant.industry_id, FEATURES.LEAD_LISTS);

  const [notes, checklists, activities, stages, entityResult, industryResult, allLists] = await Promise.all([
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
    hasLeadLists ? getLeadListsByTenant(tenantData.tenant.id) : Promise.resolve([] as LeadList[]),
  ]);

  const entity = entityResult.data as TenantEntity | null;
  const industry = industryResult.data as Industry | null;

  const accessibleLists = hasLeadLists
    ? (allLists as LeadList[]).filter((l) =>
        canAccessList(
          tenantData.permissions,
          l.access as { mode: string; positionIds?: string[] },
          tenantData.positionId,
        )
      )
    : [];

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
      userBranchId={tenantData.branchId}
      leadScope={tenantData.permissions.leadScope}
      canManageApplications={tenantData.permissions.canManageApplications}
      leadLists={accessibleLists}
    />
  );
}
