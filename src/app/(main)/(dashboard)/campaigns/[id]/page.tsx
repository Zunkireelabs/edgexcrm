import { redirect, notFound } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { CampaignDetail } from "@/industries/education-consultancy/features/campaigns/ui/campaign-detail";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function CampaignDetailRoute({ params }: Props) {
  const { id } = await params;

  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.CAMPAIGNS)) notFound();
  if (tenantData.role !== "owner" && tenantData.role !== "admin") redirect("/dashboard");

  return (
    <div className="p-6">
      <CampaignDetail campaignId={id} />
    </div>
  );
}
