import { redirect, notFound } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { UtilizationDashboard } from "@/industries/it-agency/features/resourcing/pages/utilization-dashboard";

export default async function ResourcingUtilizationRoute() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.RESOURCING)) notFound();

  return <UtilizationDashboard />;
}
