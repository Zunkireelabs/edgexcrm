import { redirect } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { RolesContent } from "@/components/dashboard/orca/roles-content";

export default async function OrcaRolesPage() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");

  return <RolesContent />;
}
