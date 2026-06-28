import { redirect, notFound } from "next/navigation";
import { getCurrentUserTenant, getPipelines, getTeamMembers } from "@/lib/supabase/queries";
import { createServiceClient } from "@/lib/supabase/server";
import { CheckInPage } from "@/industries/_shared/features/check-in/ui";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { canSeeNav } from "@/lib/api/permissions";
import { filterAssignableMembers } from "@/lib/leads/assignable";
import type { PipelineStage } from "@/types/database";

export default async function CheckInRoute() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.CHECK_IN)) notFound();
  if (!canSeeNav(tenantData.permissions, "/check-in")) redirect("/dashboard");

  const serviceClient = await createServiceClient();

  const [pipelines, stagesResult, teamMembers] = await Promise.all([
    getPipelines(tenantData.tenant.id),
    serviceClient
      .from("pipeline_stages")
      .select("*")
      .eq("tenant_id", tenantData.tenant.id)
      .order("position", { ascending: true }),
    getTeamMembers(tenantData.tenant.id),
  ]);

  const stages = (stagesResult.data || []) as PipelineStage[];

  // Assign list: branch-scoped users only see their own branch's team; overall
  // access (owner/admin) sees everyone.
  const assignableMembers = filterAssignableMembers(
    teamMembers,
    tenantData.permissions.leadScope,
    tenantData.branchId,
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      <CheckInPage
        tenantId={tenantData.tenant.id}
        pipelines={pipelines}
        stages={stages}
        teamMembers={assignableMembers}
        industryId={tenantData.tenant.industry_id ?? ""}
      />
    </div>
  );
}
