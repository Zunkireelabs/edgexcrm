import { redirect } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { KnowledgeBaseDetail } from "@/components/dashboard/knowledge-base-detail";
import { canSeeNav } from "@/lib/api/permissions";

export default async function KnowledgeBaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!canSeeNav(tenantData.permissions, "/knowledge-bases")) redirect("/dashboard");

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
