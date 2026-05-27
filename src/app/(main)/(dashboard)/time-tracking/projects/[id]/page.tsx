import { redirect, notFound } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { ProjectDetailPage } from "@/industries/it-agency/features/time-tracking/pages/project-detail";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ProjectDetailRoute({ params }: Props) {
  const { id } = await params;
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.TIME_TRACKING)) notFound();

  return (
    <ProjectDetailPage
      tenantId={tenantData.tenant.id}
      role={tenantData.role}
      projectId={id}
    />
  );
}
