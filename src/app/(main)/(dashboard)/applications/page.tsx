import { redirect, notFound } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { createServiceClient } from "@/lib/supabase/server";
import { shouldRestrictToSelf } from "@/lib/api/permissions";
import { ApplicationsWorkspace } from "@/industries/education-consultancy/features/application-tracking/pages/applications-workspace";
import type { ApplicationStage, Application, UserRole } from "@/types/database";

export default async function ApplicationsRoute() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.APPLICATION_TRACKING)) notFound();

  const supabase = await createServiceClient();

  // Fix 3: scope the SSR fetch by leadScope — counselors only see their own leads' applications
  const restrictToOwn = shouldRestrictToSelf(tenantData.permissions);

  let leadIds: string[] | null = null;
  if (restrictToOwn) {
    const { data: assignedLeads } = await supabase
      .from("leads")
      .select("id")
      .eq("tenant_id", tenantData.tenant.id)
      .eq("assigned_to", tenantData.userId)
      .is("deleted_at", null);
    leadIds = (assignedLeads ?? []).map((l) => l.id);
  }

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
  const canManageApplications = tenantData.permissions.canManageApplications;

  return (
    <div className="flex flex-col h-[calc(100vh-90px)]">
      <ApplicationsWorkspace
        role={tenantData.role as UserRole}
        stages={stages}
        applications={applications}
        canManageApplications={canManageApplications}
      />
    </div>
  );
}
