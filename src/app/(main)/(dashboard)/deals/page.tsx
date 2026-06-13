import { redirect, notFound } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { DealsWorkspace } from "@/industries/it-agency/features/deals/pages/deals-workspace";
import type { UserRole } from "@/types/database";

export default async function DealsRoute() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.DEALS)) notFound();

  return (
    <DealsWorkspace
      tenantId={tenantData.tenant.id}
      role={tenantData.role as UserRole}
    />
  );
}
