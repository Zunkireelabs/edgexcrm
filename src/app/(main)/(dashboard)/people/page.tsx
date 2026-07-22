import { redirect } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { canManageHR } from "@/lib/api/permissions";
import { PeopleDirectory } from "@/components/dashboard/hr/people-directory";

export default async function PeoplePage() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");

  return (
    <PeopleDirectory
      canManageHR={canManageHR(tenantData.permissions)}
      currentUserId={tenantData.userId}
      industryId={tenantData.tenant.industry_id}
    />
  );
}
