import { redirect, notFound } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { OfferingsWorkspace } from "@/industries/real-estate/features/offerings/pages/offerings-workspace";

// Thin route shell: gate on real_estate + OFFERINGS feature, then delegate to the
// client workspace (which fetches from /api/v1/offerings). Non-real_estate tenants
// 404 here — the feature is invisible and unreachable for them.
export default async function OfferingsRoute() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.OFFERINGS)) notFound();

  const isAdmin = tenantData.role === "owner" || tenantData.role === "admin";

  return (
    <div className="p-6">
      <OfferingsWorkspace canManage={isAdmin} />
    </div>
  );
}
