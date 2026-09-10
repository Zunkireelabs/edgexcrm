import { redirect } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { TaskDetailPage } from "@/components/dashboard/tasks/task-detail-page";

interface Props {
  params: Promise<{ id: string }>;
}

// Round 2 slice A (docs/IT-AGENCY-ROUND2-TASK-OBJECT-BRIEF.md §2) — a task's
// address. Deliberately NOT gated with getFeatureAccess(..., PROJECT_BOARD):
// a task can be a personal task from ANY industry (Home's My Tasks —
// "Universal task assignment"), not just an it_agency project task, and this
// route is exactly the fix for notifications that used to link somewhere a
// project-less task couldn't be seen. TaskDetailBody itself resolves whether
// the task is a project task or a personal one and 404s (via "Task not
// found") for a task outside the caller's tenant either way.
export default async function TaskDetailRoute({ params }: Props) {
  const { id } = await params;
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");

  return (
    <TaskDetailPage
      taskId={id}
      currentUserId={tenantData.userId}
      isAdmin={tenantData.role === "owner" || tenantData.role === "admin"}
      canManageProjects={tenantData.permissions.canManageProjects}
    />
  );
}
