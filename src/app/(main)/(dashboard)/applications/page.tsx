import { redirect, notFound } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { createServiceClient } from "@/lib/supabase/server";
import { ApplicationsWorkspace } from "@/industries/education-consultancy/features/application-tracking/pages/applications-workspace";
import type { ApplicationStage, Application, UserRole } from "@/types/database";

export default async function ApplicationsRoute() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.APPLICATION_TRACKING)) notFound();

  const supabase = await createServiceClient();

  const [stagesResult, applicationsResult] = await Promise.all([
    supabase
      .from("application_stages")
      .select("*")
      .eq("tenant_id", tenantData.tenant.id)
      .order("position", { ascending: true }),
    supabase
      .from("applications")
      .select("*, leads!applications_lead_id_fkey(id,first_name,last_name,email)")
      .eq("tenant_id", tenantData.tenant.id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
  ]);

  const stages = (stagesResult.data ?? []) as ApplicationStage[];
  const applications = (applicationsResult.data ?? []) as Application[];

  return (
    <div className="flex flex-col h-[calc(100vh-90px)]">
      <ApplicationsWorkspace
        role={tenantData.role as UserRole}
        stages={stages}
        applications={applications}
      />
    </div>
  );
}
