import { redirect, notFound } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { ProposalDetailPage } from "@/industries/it-agency/features/proposals/pages/proposal-detail";
import type { UserRole } from "@/types/database";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ProposalDetailRoute({ params }: Props) {
  const { id } = await params;
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.PROPOSALS)) notFound();

  return (
    <ProposalDetailPage
      proposalId={id}
      role={tenantData.role as UserRole}
    />
  );
}
