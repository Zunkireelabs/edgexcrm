import { redirect, notFound } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { ServicesListPage } from "@/industries/it-agency/features/services/pages/services-list";

export default async function ServicesRoute() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.SERVICES)) notFound();

  return (
    <ServicesListPage
      tenantId={tenantData.tenant.id}
      role={tenantData.role}
    />
  );
}
