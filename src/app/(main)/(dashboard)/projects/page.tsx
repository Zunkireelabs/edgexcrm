import { redirect, notFound } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { ProjectWorkspacePage } from "@/industries/it-agency/features/project-board/pages/workspace";

export default async function ProjectsRoute() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.PROJECT_BOARD)) notFound();

  // Workspace is admin-only in v1; non-admins continue using /time-tracking
  const isAdmin = tenantData.role === "owner" || tenantData.role === "admin";
  if (!isAdmin) notFound();

  return (
    <ProjectWorkspacePage
      tenantId={tenantData.tenant.id}
      role={tenantData.role}
    />
  );
}
