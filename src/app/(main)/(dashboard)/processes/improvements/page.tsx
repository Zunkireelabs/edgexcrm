import { notFound, redirect } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { ImprovementsPage } from "@/industries/education-consultancy/features/processes/ui/improvements-page";

export const dynamic = "force-dynamic";

// Thin shell: every improvement event, newest first (EDGEX-109 P2). A static segment, so it wins over /processes/[key].
export default async function Page() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.PROCESSES)) notFound();
  if (tenantData.role !== "owner" && tenantData.role !== "admin") notFound();
  return <ImprovementsPage />;
}
