import { redirect, notFound } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { ProjectWorkspacePage } from "@/industries/it-agency/features/project-board/pages/workspace";

interface ProjectsRouteProps {
  searchParams: Promise<{ view?: string }>;
}

export default async function ProjectsRoute({ searchParams }: ProjectsRouteProps) {
  const params = await searchParams;
  if (params.view === "tasks") redirect("/tasks");
  if (params.view === "members") redirect("/tasks?view=members");

  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.PROJECT_BOARD)) notFound();

  return (
    <ProjectWorkspacePage
      tenantId={tenantData.tenant.id}
      role={tenantData.role}
    />
  );
}
