import { redirect, notFound } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { AccountDetailPage } from "@/industries/it-agency/features/accounts/pages/account-detail";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function AccountDetailRoute({ params }: Props) {
  const { id } = await params;
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.ACCOUNTS)) notFound();

  return (
    <AccountDetailPage
      tenantId={tenantData.tenant.id}
      role={tenantData.role}
      accountId={id}
    />
  );
}
