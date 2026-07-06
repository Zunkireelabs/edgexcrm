import { redirect, notFound } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { DealDetailPage } from "@/industries/it-agency/features/deals/pages/deal-detail";
import type { UserRole } from "@/types/database";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function DealDetailRoute({ params }: Props) {
  const { id } = await params;
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.DEALS)) notFound();

  return (
    <DealDetailPage
      dealId={id}
      role={tenantData.role as UserRole}
      currentUserId={tenantData.userId}
    />
  );
}
