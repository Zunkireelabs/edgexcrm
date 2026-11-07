import { notFound, redirect } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { ProcessesPage } from "@/industries/education-consultancy/features/processes/ui/processes-page";

export const dynamic = "force-dynamic";

// Thin shell: the gate lives here (industry + owner/admin), the UI lives in the feature folder.
export default async function Page() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.PROCESSES)) notFound();
  if (tenantData.role !== "owner" && tenantData.role !== "admin") notFound();
  return <ProcessesPage tenantName={tenantData.tenant.name ?? ""} />;
}
