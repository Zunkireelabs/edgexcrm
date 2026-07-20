import { redirect, notFound } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { TasksWorkspacePage } from "@/industries/it-agency/features/project-board/pages/tasks-workspace";

export default async function TasksRoute() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.PROJECT_BOARD)) notFound();

  return <TasksWorkspacePage />;
}
