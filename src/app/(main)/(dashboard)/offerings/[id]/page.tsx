import { redirect, notFound } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { OfferingDetail } from "@/industries/real-estate/features/offerings/pages/offering-detail";

interface Props {
  params: Promise<{ id: string }>;
}

// Offering detail + per-offering raise-funnel board. Same gate as the list shell.
export default async function OfferingDetailRoute({ params }: Props) {
  const { id } = await params;
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.OFFERINGS)) notFound();

  const isAdmin = tenantData.role === "owner" || tenantData.role === "admin";

  return (
    <div className="p-6">
      <OfferingDetail offeringId={id} canManage={isAdmin} />
    </div>
  );
}
