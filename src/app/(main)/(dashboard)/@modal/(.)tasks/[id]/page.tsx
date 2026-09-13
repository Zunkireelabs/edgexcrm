import { redirect } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { TaskDetailModal } from "@/components/dashboard/tasks/task-detail-modal";

interface Props {
  params: Promise<{ id: string }>;
}

// Intercepts an in-app navigation to /tasks/[id] (single-dot = same level as
// this @modal slot's parent, (dashboard)/) and renders it as a drawer instead
// of the full page — the URL still becomes /tasks/<id>. A direct load of that
// URL (email link, hard refresh, pasted link) bypasses interception entirely
// and hits the real (dashboard)/tasks/[id]/page.tsx. See
// docs/IT-AGENCY-ROUND2-TASK-OBJECT-BRIEF.md §2.
export default async function TaskDetailInterceptedModal({ params }: Props) {
  const { id } = await params;
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");

  return (
    <TaskDetailModal
      taskId={id}
      currentUserId={tenantData.userId}
      isAdmin={tenantData.role === "owner" || tenantData.role === "admin"}
      canManageProjects={tenantData.permissions.canManageProjects}
    />
  );
}
