import { redirect } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { getAutomationMatrix } from "@/lib/ai/agents/queries";
import { TasksContent } from "@/components/dashboard/orca/tasks-content";

export default async function OrcaTasksPage() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");

  const { tenant } = tenantData;
  const tasks = await getAutomationMatrix(tenant.id, tenant.industry_id);

  return <TasksContent tasks={tasks} />;
}
