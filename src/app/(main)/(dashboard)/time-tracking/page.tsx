import { redirect, notFound } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { TimeTrackingHomePage } from "@/industries/it-agency/features/time-tracking/pages/time-tracking-home";

export default async function TimeTrackingRoute() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.TIME_TRACKING)) notFound();

  return (
    <TimeTrackingHomePage
      tenantId={tenantData.tenant.id}
      role={tenantData.role}
    />
  );
}
