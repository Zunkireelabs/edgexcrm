import { notFound, redirect } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { isProcessKey } from "@/industries/education-consultancy/features/processes/lib/keys";
import { DraftReview } from "@/industries/education-consultancy/features/processes/ui/draft-review";

export const dynamic = "force-dynamic";

// Thin shell: review the process's open draft (EDGEX-109 P2). Gate = industry + owner/admin; the UI lives in the feature folder.
export default async function Page({ params }: { params: Promise<{ key: string }> }) {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.PROCESSES)) notFound();
  if (tenantData.role !== "owner" && tenantData.role !== "admin") notFound();
  const { key } = await params;
  if (!isProcessKey(key)) notFound();
  return <DraftReview processKey={key} />;
}
