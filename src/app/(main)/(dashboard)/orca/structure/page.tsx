import { redirect } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { StructureContent } from "@/components/dashboard/orca/structure-content";

export default async function OrcaStructurePage() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");

  return <StructureContent />;
}
