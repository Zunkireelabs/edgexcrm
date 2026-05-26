import { redirect, notFound } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { AccountsListPage } from "@/industries/it-agency/features/time-tracking/pages/accounts-list";

export default async function AccountsRoute() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.TIME_TRACKING)) notFound();

  return (
    <AccountsListPage
      tenantId={tenantData.tenant.id}
      role={tenantData.role}
    />
  );
}
