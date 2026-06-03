import { redirect } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { KnowledgeBaseDetail } from "@/components/dashboard/knowledge-base-detail";

export default async function KnowledgeBaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");

  return (
    <div className="space-y-4">
      <KnowledgeBaseDetail
        id={id}
        tenantId={tenantData.tenant.id}
        role={tenantData.role}
      />
    </div>
  );
}
