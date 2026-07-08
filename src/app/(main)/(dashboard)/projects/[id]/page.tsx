import { redirect, notFound } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { ProjectCockpitPage } from "@/industries/it-agency/features/project-board/pages/project-cockpit";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ProjectCockpitRoute({ params }: Props) {
  const { id } = await params;
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.PROJECT_BOARD)) notFound();

  const isAdmin = tenantData.role === "owner" || tenantData.role === "admin";
  if (!isAdmin) notFound();

  return <ProjectCockpitPage projectId={id} />;
}
