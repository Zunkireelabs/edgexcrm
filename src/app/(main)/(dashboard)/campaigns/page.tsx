import { redirect, notFound } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { CampaignsList } from "@/industries/education-consultancy/features/campaigns/ui/campaigns-list";

export default async function CampaignsRoute() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.CAMPAIGNS)) notFound();
  if (tenantData.role !== "owner" && tenantData.role !== "admin") redirect("/dashboard");

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Campaigns</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Prediction leaderboards and engagement campaigns.
        </p>
      </div>
      <CampaignsList />
    </div>
  );
}
