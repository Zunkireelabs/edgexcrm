import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { PulsePage } from "@/industries/education-consultancy/features/pulse/ui/pulse-page";

export const dynamic = "force-dynamic";

// Thin shell: the gate lives here (industry + owner/admin), the UI lives in the feature folder.
export default async function Page() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.PULSE)) notFound();
  if (tenantData.role !== "owner" && tenantData.role !== "admin") notFound();
  // The top-bar branch switcher writes this cookie and calls router.refresh(); keying on it remounts the client
  // component so Pulse refetches for the new branch (the API reads the same cookie).
  const branch = (await cookies()).get("edgex_branch")?.value ?? "all";
  return <PulsePage key={branch} />;
}
