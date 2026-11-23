import { notFound, redirect } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { isProcessKey } from "@/industries/education-consultancy/features/processes/lib/keys";
import { ProcessDetail } from "@/industries/education-consultancy/features/processes/ui/process-detail";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ key: string }> }) {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.PROCESSES)) notFound();
  if (tenantData.role !== "owner" && tenantData.role !== "admin") notFound();
  const { key } = await params;
  if (!isProcessKey(key)) notFound();
  return <ProcessDetail processKey={key} tenantName={tenantData.tenant.name ?? ""} />;
}
