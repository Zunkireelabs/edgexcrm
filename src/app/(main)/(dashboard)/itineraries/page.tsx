import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { Button } from "@/components/ui/button";

export default async function ItinerariesPage() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.ITINERARY)) notFound();

  return (
    <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4 text-center px-4">
      <h1 className="text-2xl font-bold">Itineraries</h1>
      <p className="text-muted-foreground max-w-sm">
        Open a lead and click the <strong>Itinerary</strong> tab to build a day-by-day quote
        for that traveller.
      </p>
      <Button asChild>
        <Link href="/leads">Go to Leads</Link>
      </Button>
    </div>
  );
}
