import { redirect, notFound } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { ProposalsListPage } from "@/industries/it-agency/features/proposals/pages/proposals-list";
import type { UserRole } from "@/types/database";

export default async function ProposalsRoute() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.PROPOSALS)) notFound();

  return (
    <ProposalsListPage
      tenantId={tenantData.tenant.id}
      role={tenantData.role as UserRole}
    />
  );
}
