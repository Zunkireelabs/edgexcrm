import { redirect } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { getAgentFleet, getAgentCatalog, getAssignablePositions } from "@/lib/ai/agents/queries";
import { isAgentsEnabledForTenant } from "@/lib/ai/flag";
import { AgentsContent } from "@/components/dashboard/orca/agents-content";

export default async function OrcaAgentsPage() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");

  const { tenant } = tenantData;

  const [agents, catalog, positions, agentsActive] = await Promise.all([
    getAgentFleet(tenant.id),
    getAgentCatalog(tenant.id, tenant.industry_id),
    getAssignablePositions(tenant.id),
    isAgentsEnabledForTenant(tenant.id),
  ]);

  return <AgentsContent agents={agents} catalog={catalog} positions={positions} agentsActive={agentsActive} />;
}
