import { redirect } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { OrgStructureContent } from "@/components/dashboard/org-structure/org-structure-content";
import { canSeeNav } from "@/lib/api/permissions";

export default async function TeamPage() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!canSeeNav(tenantData.permissions, "/team")) redirect("/dashboard");

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold">Org Structure</h1>
      <OrgStructureContent
        role={tenantData.role}
        tenantId={tenantData.tenant.id}
        userId={tenantData.userId}
        industryId={tenantData.tenant.industry_id ?? undefined}
        maxBranches={tenantData.entitlements.maxBranches}
      />
    </div>
  );
}
