import { redirect } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { TasksContent } from "@/components/dashboard/orca/tasks-content";

export default async function OrcaTasksPage() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");

  return <TasksContent />;
}
