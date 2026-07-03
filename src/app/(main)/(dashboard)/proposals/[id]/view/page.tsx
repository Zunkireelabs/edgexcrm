import { redirect, notFound } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { ProposalPrintView } from "@/industries/it-agency/features/proposals/pages/proposal-print-view";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ProposalPrintRoute({ params }: Props) {
  const { id } = await params;
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.PROPOSALS)) notFound();

  return <ProposalPrintView proposalId={id} />;
}
