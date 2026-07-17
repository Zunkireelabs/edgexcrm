import { redirect, notFound } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { DataRoomWorkspace } from "@/industries/real-estate/features/offerings/pages/data-room";

// Thin route shell: gate on real_estate + OFFERINGS, then delegate to the Data
// Room landing (lists offerings; each links to its per-offering documents).
// Non-real_estate tenants 404 here — the route is invisible and unreachable.
export default async function DataRoomRoute() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.OFFERINGS)) notFound();

  return (
    <div className="p-6">
      <DataRoomWorkspace />
    </div>
  );
}
