import { redirect, notFound } from "next/navigation";
import {
  getCurrentUserTenant,
  getLead,
  getLeadNotes,
  getLeadChecklists,
  getPipelineStages,
} from "@/lib/supabase/queries";
import { LeadDetail } from "@/components/dashboard/lead-detail";

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");

  const lead = await getLead(id, tenantData.tenant.id, {
    role: tenantData.role,
    userId: tenantData.userId,
  });
  if (!lead) notFound();

  const [notes, checklists, stages] = await Promise.all([
    getLeadNotes(lead.id),
    getLeadChecklists(lead.id),
    getPipelineStages(tenantData.tenant.id),
  ]);

  return (
    <LeadDetail
      lead={lead}
      notes={notes}
      checklists={checklists}
      stages={stages}
      tenant={tenantData.tenant}
      role={tenantData.role}
      userId={tenantData.userId}
    />
  );
}
