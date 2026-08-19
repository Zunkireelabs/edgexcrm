import { redirect, notFound } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { isSmsEnabledForTenant } from "@/lib/sms/flag";
import { SmsDashboard } from "@/industries/_shared/features/sms/ui/sms-dashboard";

export default async function SmsRoute() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.SMS)) notFound();
  if (!(await isSmsEnabledForTenant(tenantData.tenant.id))) notFound();
  if (!tenantData.permissions.canSendSms) notFound();

  return (
    <div className="flex flex-col gap-6 p-6">
      <SmsDashboard
        canSendSms={tenantData.permissions.canSendSms}
        isAdmin={tenantData.role === "owner" || tenantData.role === "admin"}
      />
    </div>
  );
}
