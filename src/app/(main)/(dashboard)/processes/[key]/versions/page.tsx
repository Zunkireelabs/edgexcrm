import { notFound, redirect } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { isProcessKey } from "@/industries/education-consultancy/features/processes/lib/keys";
import { VersionsPage } from "@/industries/education-consultancy/features/processes/ui/versions-page";

export const dynamic = "force-dynamic";

// Thin shell: before -> after for a process (EDGEX-109 P2). `?version=<id>` picks the version compared (default: the live one).
export default async function Page({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<{ version?: string }> }) {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.PROCESSES)) notFound();
  if (tenantData.role !== "owner" && tenantData.role !== "admin") notFound();
  const { key } = await params;
  if (!isProcessKey(key)) notFound();
  const { version } = await searchParams;
  return <VersionsPage processKey={key} versionId={version ?? null} tenantName={tenantData.tenant.name ?? ""} />;
}
