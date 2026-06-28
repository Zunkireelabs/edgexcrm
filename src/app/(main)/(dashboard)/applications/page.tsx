import { redirect, notFound } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { createServiceClient } from "@/lib/supabase/server";
import { leadQueryScope } from "@/lib/api/permissions";
import { leadIdsVisibleToAssignee, branchMemberIds } from "@/lib/leads/branch-membership";
import { ApplicationsWorkspace } from "@/industries/education-consultancy/features/application-tracking/pages/applications-workspace";
import type { ApplicationStage, Application } from "@/types/database";

export default async function ApplicationsRoute() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.APPLICATION_TRACKING)) notFound();

  const supabase = await createServiceClient();

  const scope = leadQueryScope(tenantData.permissions, tenantData.userId, tenantData.branchId ?? null);

  // leadIds: null = no filter (all); [] = empty result (own-scope with no leads)
  // teamMemberIds: set for team scope — filter via embedded lead's assigned_to (no large id list)
  let leadIds: string[] | null = null;
  let teamMemberIds: string[] | null = null;

  if (scope.restrictToSelf && scope.userId) {
    leadIds = await leadIdsVisibleToAssignee(supabase, tenantData.tenant.id, scope.userId);
  } else if (scope.branchId) {
    teamMemberIds = await branchMemberIds(supabase, tenantData.tenant.id, scope.branchId);
  }
  // else: leadScope 'all' → no filter

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
            .select("*, leads!applications_lead_id_fkey!inner(id,first_name,last_name,email,assigned_to)")
            .eq("tenant_id", tenantData.tenant.id)
            .is("deleted_at", null)
            .order("created_at", { ascending: false });
          if (leadIds && leadIds.length > 0) q = q.in("lead_id", leadIds);
          if (teamMemberIds) q = q.in("leads.assigned_to", teamMemberIds);
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
