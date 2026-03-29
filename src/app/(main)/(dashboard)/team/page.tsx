import { redirect } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { TeamManagement } from "@/components/dashboard/team-management";

export default async function TeamPage() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold">Team</h1>
      <TeamManagement
        role={tenantData.role}
        tenantId={tenantData.tenant.id}
        userId={tenantData.userId}
      />
    </div>
  );
}
