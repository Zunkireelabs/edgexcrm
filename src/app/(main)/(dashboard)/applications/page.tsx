import { redirect, notFound } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { createServiceClient } from "@/lib/supabase/server";
import { leadQueryScope } from "@/lib/api/permissions";
import { leadIdsVisibleToAssignee, leadIdsForBranch } from "@/lib/leads/branch-membership";
import { ApplicationsWorkspace } from "@/industries/education-consultancy/features/application-tracking/pages/applications-workspace";
import type { ApplicationStage, Application } from "@/types/database";

export default async function ApplicationsRoute() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.APPLICATION_TRACKING)) notFound();

  const supabase = await createServiceClient();

  // Fix 5: build the accessible-lead-id set the same way getLeads() does,
  // mirroring leadQueryScope + leadIdsVisibleToAssignee / leadIdsForBranch.
  const scope = leadQueryScope(tenantData.permissions, tenantData.userId, tenantData.branchId ?? null);

  // leadIds: null = no filter (all tenant apps); [] = no accessible leads (return empty)
  let leadIds: string[] | null = null;

  if (scope.restrictToSelf && scope.userId) {
    // 'own' scope (counselor) or 'team' with no branch (null-branch fallback):
    // leads.assigned_to === userId UNION lead_branches.assigned_to === userId
    leadIds = await leadIdsVisibleToAssignee(supabase, tenantData.tenant.id, scope.userId);
  } else if (scope.branchId) {
    // 'team' scope with a branch: leads in that branch (via lead_branches)
    leadIds = await leadIdsForBranch(supabase, tenantData.tenant.id, scope.branchId);
  }
  // else: leadScope 'all' → leadIds stays null → no filter

  const [stagesResult, applicationsResult] = await Promise.all([
    supabase
      .from("application_stages")
      .select("*")
      .eq("tenant_id", tenantData.tenant.id)
      .order("position", { ascending: true }),
    leadIds !== null && leadIds.length === 0
      ? Promise.resolve({ data: [] })
      : (() => {
          let q = supabase
            .from("applications")
            .select("*, leads!applications_lead_id_fkey(id,first_name,last_name,email)")
            .eq("tenant_id", tenantData.tenant.id)
            .is("deleted_at", null)
            .order("created_at", { ascending: false });
          if (leadIds && leadIds.length > 0) q = q.in("lead_id", leadIds);
          return q;
        })(),
  ]);

  const stages = (stagesResult.data ?? []) as ApplicationStage[];
  const applications = (applicationsResult.data ?? []) as Application[];

  return (
    <div className="flex flex-col h-[calc(100vh-90px)]">
      <ApplicationsWorkspace
        stages={stages}
        applications={applications}
        canManageApplications={tenantData.permissions.canManageApplications}
      />
    </div>
  );
}
