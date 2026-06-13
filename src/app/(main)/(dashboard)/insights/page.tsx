import { redirect, notFound } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

export default async function InsightsPage() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");

  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.INSIGHTS)) notFound();

  redirect("/insights/dashboards");
}
