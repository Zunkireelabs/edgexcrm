import { redirect } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { KnowledgeBases } from "@/components/dashboard/knowledge-bases";
import { canSeeNav } from "@/lib/api/permissions";

export default async function KnowledgeBasesPage() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!canSeeNav(tenantData.permissions, "/knowledge-bases")) redirect("/dashboard");

  return (
    <div className="space-y-4">
      <KnowledgeBases tenantId={tenantData.tenant.id} role={tenantData.role} />
    </div>
  );
}
