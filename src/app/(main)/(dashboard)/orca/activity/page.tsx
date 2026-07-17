import { redirect } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { createClient } from "@/lib/supabase/server";
import { AskOrcaContent } from "@/components/dashboard/orca/ask-orca-content";

export default async function OrcaActivityPage() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const meta = user?.user_metadata as { name?: string; full_name?: string } | undefined;
  const userFirstName =
    (meta?.name?.trim() || meta?.full_name?.trim() || user?.email?.split("@")[0] || "there").split(" ")[0];

  return <AskOrcaContent userFirstName={userFirstName} />;
}
