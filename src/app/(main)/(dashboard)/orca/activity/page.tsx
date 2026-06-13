import { redirect } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { AskOrcaContent } from "@/components/dashboard/orca/ask-orca-content";

export default async function OrcaActivityPage() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  return <AskOrcaContent />;
}
