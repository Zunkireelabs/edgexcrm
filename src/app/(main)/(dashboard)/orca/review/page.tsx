import { redirect, notFound } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { getReviewQueue, getPendingApprovals } from "@/lib/ai/agents/queries";
import { requireOrcaAccess } from "@/lib/ai/flag";
import { ReviewContent } from "@/components/dashboard/orca/review-content";

export default async function OrcaReviewPage() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");

  const { tenant, role } = tenantData;
  if (!requireOrcaAccess(role)) notFound();

  const [items, approvals] = await Promise.all([getReviewQueue(tenant.id), getPendingApprovals(tenant.id)]);

  return <ReviewContent items={items} approvals={approvals} />;
}
