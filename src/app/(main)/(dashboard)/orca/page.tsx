import { redirect } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { getOrcaOverviewStats } from "@/lib/ai/agents/queries";
import { OverviewContent } from "@/components/dashboard/orca/overview-content";

export default async function OrcaPage() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");

  const { tenant } = tenantData;
  const stats = await getOrcaOverviewStats(tenant.id, tenant.industry_id);

  return <OverviewContent stats={stats} />;
}
