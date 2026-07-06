import { redirect, notFound } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { AffiliatesPage } from "@/industries/education-consultancy/features/affiliates/ui";

export default async function AffiliatesRoute() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.AFFILIATES)) notFound();
  if (tenantData.role !== "owner" && tenantData.role !== "admin") redirect("/dashboard");

  return (
    <div className="flex flex-col gap-6 p-6">
      <AffiliatesPage />
    </div>
  );
}
