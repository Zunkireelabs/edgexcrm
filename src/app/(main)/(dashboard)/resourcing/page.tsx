import { redirect, notFound } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { canManageHR } from "@/lib/api/permissions";
import { ResourcingBoard } from "@/industries/it-agency/features/resourcing/pages/resourcing-board";

export default async function ResourcingRoute() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.RESOURCING)) notFound();

  return <ResourcingBoard canManageHR={canManageHR(tenantData.permissions)} />;
}
