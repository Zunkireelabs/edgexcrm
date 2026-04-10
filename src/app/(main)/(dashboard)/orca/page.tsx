import { redirect } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { OverviewContent } from "@/components/dashboard/orca/overview-content";

export default async function OrcaPage() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");

  return <OverviewContent />;
}
