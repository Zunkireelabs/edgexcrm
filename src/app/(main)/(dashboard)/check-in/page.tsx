import { redirect, notFound } from "next/navigation";
import { getCurrentUserTenant, getPipelines, getTeamMembers } from "@/lib/supabase/queries";
import { createServiceClient } from "@/lib/supabase/server";
import { CheckInPage } from "@/industries/_shared/features/check-in/ui";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { canSeeNav } from "@/lib/api/permissions";
import { filterAssignableMembersByChain } from "@/lib/leads/assignable";
import type { PipelineStage } from "@/types/database";

export default async function CheckInRoute() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.CHECK_IN)) notFound();

  const { baseTier } = tenantData.permissions;
  const isAllowedRole =
    baseTier === "owner" ||
    baseTier === "admin" ||
    tenantData.positionSlug === "lead-executive" ||
    tenantData.positionSlug === "branch-manager";
  if (!isAllowedRole) redirect("/dashboard");

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

  // Assign list: chain filter narrows to role-chain peers/next; branch-scoped
  // users are further constrained to their own branch.
  const assignableMembers = filterAssignableMembersByChain(teamMembers, {
    baseTier: tenantData.permissions.baseTier,
    leadScope: tenantData.permissions.leadScope,
    branchId: tenantData.branchId,
    positionSlug: tenantData.positionSlug,
    industryId: tenantData.tenant.industry_id,
  });

  const canAssignAny =
    tenantData.permissions.baseTier === "owner" ||
    tenantData.permissions.baseTier === "admin" ||
    tenantData.permissions.leadScope === "team";
  const canAssignOwnCheckIns =
    tenantData.tenant.industry_id === "education_consultancy" &&
    tenantData.positionSlug === "lead-executive" &&
    tenantData.permissions.leadScope === "own" &&
    !!tenantData.permissions.canAssignLeads;

  // "Meet with" dropdown: admins/owners see all members; branch-scoped users see only their branch.
  const isAdminTier =
    tenantData.permissions.baseTier === "owner" ||
    tenantData.permissions.baseTier === "admin";
  const branchMembers = isAdminTier || !tenantData.branchId
    ? teamMembers
    : teamMembers.filter((m) => m.branch_id === tenantData.branchId);

  return (
    <div className="flex flex-col h-full min-h-0">
      <CheckInPage
        tenantId={tenantData.tenant.id}
        pipelines={pipelines}
        stages={stages}
        teamMembers={assignableMembers}
        allBranchMembers={branchMembers}
        industryId={tenantData.tenant.industry_id ?? ""}
        canAssignAny={canAssignAny}
        canAssignOwnCheckIns={canAssignOwnCheckIns}
        currentUserId={tenantData.userId}
        isAdmin={tenantData.permissions.baseTier === "owner" || tenantData.permissions.baseTier === "admin"}
      />
    </div>
  );
}
