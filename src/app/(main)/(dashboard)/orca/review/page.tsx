import { redirect, notFound } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { getReviewQueue } from "@/lib/ai/agents/queries";
import { ReviewContent } from "@/components/dashboard/orca/review-content";

export default async function OrcaReviewPage() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");

  const { tenant, role } = tenantData;
  if (role !== "owner" && role !== "admin") notFound();

  const items = await getReviewQueue(tenant.id);

  return <ReviewContent items={items} />;
}
