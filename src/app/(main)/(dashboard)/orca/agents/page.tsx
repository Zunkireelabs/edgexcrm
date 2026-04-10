import { redirect } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { AgentsContent } from "@/components/dashboard/orca/agents-content";

export default async function OrcaAgentsPage() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");

  return <AgentsContent />;
}
