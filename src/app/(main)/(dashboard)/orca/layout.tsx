import { notFound, redirect } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { isAssistantEnabled } from "@/lib/ai/flag";

export default async function OrcaLayout({ children }: { children: React.ReactNode }) {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");

  // Same condition as the dashboard layout's `aiAssistantEnabled` (migration 174):
  // env kill switch AND per-tenant grant. Every /orca/* route sits under this
  // layout, so gating here covers all of them in one place.
  if (!isAssistantEnabled() || !tenantData.tenant.ai_enabled) notFound();

  // Interim access gate: the whole Orca surface (Ask Orca, the Fleet, the
  // approval queue) is owner/admin only until per-user AI access levels are
  // built. Page gate only — the matching AI API routes gate themselves.
  if (tenantData.role !== "owner" && tenantData.role !== "admin") notFound();

  return children;
}
