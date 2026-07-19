import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getCurrentUserTenant, getFormConfigsForTenant, getBranches, getLeadListsByTenant, getLeadListCounts } from "@/lib/supabase/queries";
import { createClient } from "@/lib/supabase/server";
import { DashboardShell } from "@/components/dashboard/shell";
import { AIAssistantProvider } from "@/contexts/ai-assistant-context";
import { SettingsModalProvider } from "@/contexts/settings-modal-context";
import { GlobalSearchProvider } from "@/contexts/global-search-context";
import { getIndustrySidebarItems, getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { isAssistantEnabled } from "@/lib/ai/flag";
import { canAccessList, resolveEffectiveBranch } from "@/lib/api/permissions";
import { isOffFunnelLeadList } from "@/lib/leads/list-funnel";
import { buildNavIndex } from "@/components/dashboard/search/build-nav-index";
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
  // Env flag AND tenants.ai_enabled (migration 174) — see src/lib/ai/flag.ts.
  // tenantData.tenant is already loaded above, so this is free (no extra query).
  const aiAssistantEnabled = isAssistantEnabled() && tenantData.tenant.ai_enabled;

  const [formConfigs, branches, cookieStore, allLeadLists] = await Promise.all([
    getFormConfigsForTenant(tenantData.tenant.id),
    maxBranches > 1 ? getBranches(tenantData.tenant.id) : Promise.resolve([]),
    cookies(),
    hasLeadLists ? getLeadListsByTenant(tenantData.tenant.id) : Promise.resolve([]),
  ]);

  // Filter lead lists by caller's per-list access, then split staging vs pipeline
  const accessibleLists = (allLeadLists as LeadList[]).filter((l) =>
    canAccessList(
      tenantData.permissions,
      l.access as { mode: string; positionIds?: string[] },
      tenantData.positionId,
      l.id,
    )
  );
  const isLayoutAdmin = tenantData.role === "owner" || tenantData.role === "admin";
  // "All Leads" shows only the active funnel; off-funnel lists (Archived, Delete)
  // render as standalone top-level items in the LEADS section.
  const leadLists = accessibleLists.filter((l) => !l.is_staging && !isOffFunnelLeadList(l));
  const archiveLists = accessibleLists
    .filter((l) => !l.is_staging && isOffFunnelLeadList(l))
    .sort((a, b) => a.sort_order - b.sort_order);
  // Leads Organise staging buckets are admin-only; counselors/viewers never see them in the nav
  const stagingLists = isLayoutAdmin ? accessibleLists.filter((l) => !!l.is_staging) : [];

  // it_agency funnel sidebar rows show a live lead count. Scoped to funnel-tagged
  // lists only (not the whole tenant) to keep this off the hot path for every page nav.
  const funnelListIds = leadLists.filter((l) => l.funnel_key != null).map((l) => l.id);
  const funnelListCounts =
    funnelListIds.length > 0 ? await getLeadListCounts(tenantData.tenant.id, funnelListIds) : {};
  const leadListsWithCounts = leadLists.map((l) => ({ ...l, count: funnelListCounts[l.id] }));

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
  const selectedBranchId = resolveEffectiveBranch(
    branchCookieVal,
    branches.map((b) => b.id),
  );

  const navIndex = buildNavIndex({
    industrySidebarItems,
    leadLists: [...leadLists, ...archiveLists],
    stagingLists,
    allowedNavKeys,
    industryId: tenantData.tenant.industry_id ?? null,
    isOrcaAvailable: true,
  });

  return (
    <AIAssistantProvider>
      <SettingsModalProvider
        tenant={tenantData.tenant}
        role={tenantData.role}
        industryId={tenantData.tenant.industry_id ?? null}
      >
        <GlobalSearchProvider navIndex={navIndex}>
          <DashboardShell
            user={user}
            tenant={tenantData.tenant}
            role={tenantData.role}
            positionName={tenantData.positionName}
            positionSlug={tenantData.positionSlug}
            formConfigs={formConfigs.map((f) => ({ name: f.name, slug: f.slug }))}
            industrySidebarItems={industrySidebarItems}
            allowedNavKeys={allowedNavKeys}
            branches={branches}
            maxBranches={maxBranches}
            userBranchId={tenantData.branchId}
            leadScope={tenantData.permissions.leadScope}
            selectedBranchId={selectedBranchId}
            leadLists={leadListsWithCounts}
            stagingLists={stagingLists}
            archiveLists={archiveLists}
            aiAssistantEnabled={aiAssistantEnabled}
          >
            {children}
          </DashboardShell>
        </GlobalSearchProvider>
      </SettingsModalProvider>
    </AIAssistantProvider>
  );
}
