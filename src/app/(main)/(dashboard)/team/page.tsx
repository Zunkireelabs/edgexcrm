import { redirect } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { TeamManagement } from "@/components/dashboard/team-management";

export default async function TeamPage() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Team</h1>
        <p className="text-muted-foreground">
          Manage team members and invitations
        </p>
      </div>
      <TeamManagement
        role={tenantData.role}
        tenantId={tenantData.tenant.id}
        userId={tenantData.userId}
      />
    </div>
  );
}
