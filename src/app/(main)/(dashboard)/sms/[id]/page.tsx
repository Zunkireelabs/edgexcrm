import { redirect, notFound } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { isSmsSandbox } from "@/lib/sms/flag";
import { BlastWorkspace } from "@/industries/_shared/features/sms/ui/blast-workspace";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// Server-only isSmsSandbox() read: the /preview contract (SMS-PHASE3A-BRIEF.md
// §5) has no sandbox field and this phase must not invent an endpoint for one
// (see docs/SMS-PHASE3B-BRIEF.md §0.4) — threading the flag through the shell
// as a plain boolean prop is the only way send-confirm-dialog's sandbox-off
// banner can know the real state without a new API surface.
export default async function SmsBlastRoute({ params }: RouteParams) {
  const { id } = await params;
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.SMS)) notFound();

  return (
    <div className="flex flex-col gap-6 p-6">
      <BlastWorkspace blastId={id} canSendSms={tenantData.permissions.canSendSms} sandboxed={isSmsSandbox()} />
    </div>
  );
}
