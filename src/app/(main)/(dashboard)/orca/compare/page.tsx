import { redirect } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { CompareContent } from "@/components/dashboard/orca/compare-content";

export default async function OrcaComparePage() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");

  return <CompareContent />;
}
