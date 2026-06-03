import { redirect } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { KnowledgeBases } from "@/components/dashboard/knowledge-bases";

export default async function KnowledgeBasesPage() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");

  return (
    <div className="space-y-4">
      <KnowledgeBases tenantId={tenantData.tenant.id} role={tenantData.role} />
    </div>
  );
}
