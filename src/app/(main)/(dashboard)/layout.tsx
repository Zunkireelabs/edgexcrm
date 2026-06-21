import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getCurrentUserTenant, getFormConfigsForTenant, getBranches, getLeadListsByTenant } from "@/lib/supabase/queries";
import { createClient } from "@/lib/supabase/server";
import { DashboardShell } from "@/components/dashboard/shell";
import { AIAssistantProvider } from "@/contexts/ai-assistant-context";
import { getIndustrySidebarItems, getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { canAccessList } from "@/lib/api/permissions";
import type { LeadList } from "@/types/database";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const tenantData = await getCurrentUserTenant();
  if (!tenantData) {
    // User is authenticated but has no tenant — don't redirect to /login (causes loop)
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center space-y-2">
          <h1 className="text-xl font-semibold">No Organization Found</h1>
          <p className="text-muted-foreground text-sm">
            Your account is not linked to any organization yet.
          </p>
        </div>
      </div>
    );
  }

  const maxBranches = tenantData.entitlements.maxBranches;
  const hasLeadLists = getFeatureAccess(tenantData.tenant.industry_id, FEATURES.LEAD_LISTS);

  const [formConfigs, branches, cookieStore, allLeadLists] = await Promise.all([
    getFormConfigsForTenant(tenantData.tenant.id),
    maxBranches > 1 ? getBranches(tenantData.tenant.id) : Promise.resolve([]),
    cookies(),
    hasLeadLists ? getLeadListsByTenant(tenantData.tenant.id) : Promise.resolve([]),
  ]);

  // Filter lead lists by caller's per-list access
  const leadLists = (allLeadLists as LeadList[]).filter((l) =>
    canAccessList(
      tenantData.permissions,
      l.access as { mode: string; positionIds?: string[] },
      tenantData.positionId,
    )
  );

  const industrySidebarItems = getIndustrySidebarItems(
    tenantData.tenant.industry_id,
    tenantData.role,
    tenantData.permissions,
  );
  const allowedNavKeys =
    tenantData.permissions.allowedNavKeys === null
      ? null
      : [...tenantData.permissions.allowedNavKeys];

  const branchCookieVal = cookieStore.get("edgex_branch")?.value ?? null;
  const selectedBranchId = branchCookieVal === "all" ? null : branchCookieVal;

  return (
    <AIAssistantProvider>
      <DashboardShell
        user={user}
        tenant={tenantData.tenant}
        role={tenantData.role}
        positionName={tenantData.positionName}
        formConfigs={formConfigs.map((f) => ({ name: f.name, slug: f.slug }))}
        industrySidebarItems={industrySidebarItems}
        allowedNavKeys={allowedNavKeys}
        branches={branches}
        maxBranches={maxBranches}
        userBranchId={tenantData.branchId}
        leadScope={tenantData.permissions.leadScope}
        selectedBranchId={selectedBranchId}
        leadLists={leadLists}
      >
        {children}
      </DashboardShell>
    </AIAssistantProvider>
  );
}
