import { redirect, notFound } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { ApprovalsInboxPage } from "@/industries/it-agency/features/approvals/pages/approvals-inbox";

export default async function ApprovalsInboxRoute() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.PROJECT_BOARD)) notFound();
  if (tenantData.role !== "owner" && tenantData.role !== "admin") notFound();

  return <ApprovalsInboxPage role={tenantData.role} />;
}
