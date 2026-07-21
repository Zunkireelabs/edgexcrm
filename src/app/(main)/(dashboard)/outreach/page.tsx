import { redirect, notFound } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { OutreachCockpit } from "@/industries/_shared/features/outreach/ui/outreach-cockpit";
import type { UserRole } from "@/types/database";

export default async function OutreachRoute() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.OUTREACH)) notFound();

  return <OutreachCockpit role={tenantData.role as UserRole} currentUserId={tenantData.userId} />;
}
