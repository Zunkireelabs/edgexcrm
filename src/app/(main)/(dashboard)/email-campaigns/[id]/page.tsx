import { redirect, notFound } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { isBulkEmailEnabledForTenant } from "@/lib/email/outbound/flag";
import { BlastWorkspace } from "@/industries/_shared/features/email-campaigns/ui/blast-workspace";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export default async function EmailBlastRoute({ params }: RouteParams) {
  const { id } = await params;
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.EMAIL_CAMPAIGNS)) notFound();
  if (!(await isBulkEmailEnabledForTenant(tenantData.tenant.id))) notFound();

  const canSendEmail = tenantData.role === "owner" || tenantData.role === "admin";
  if (!canSendEmail) notFound();

  return (
    <div className="flex flex-col gap-6 p-6">
      <BlastWorkspace blastId={id} canSendEmail={canSendEmail} isAdmin={canSendEmail} />
    </div>
  );
}
