import { redirect, notFound } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { CompliancePage } from "@/industries/it-agency/features/time-tracking/pages/compliance";

export default async function TimeTrackingComplianceRoute() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.TIME_TRACKING)) notFound();
  if (tenantData.role !== "owner" && tenantData.role !== "admin") notFound();

  return <CompliancePage />;
}
