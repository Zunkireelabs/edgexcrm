import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { redirect, notFound } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { TimesheetPage } from "@/industries/it-agency/features/time-tracking/pages/timesheet";

export default async function TimeTrackingRoute() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.TIME_TRACKING)) notFound();

  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <TimesheetPage tenantId={tenantData.tenant.id} role={tenantData.role} />
    </Suspense>
  );
}
