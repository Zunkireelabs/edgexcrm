import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getCurrentUserTenant, getLeads, getLeadListsByTenant, getTeamMembers, getPipelineStages, getFormConfigsForTenant, getBranches } from "@/lib/supabase/queries";
import { createServiceClient } from "@/lib/supabase/server";
import { LeadsTable } from "@/components/dashboard/leads-table";
import { canSeeNav, canAccessList, leadQueryScope } from "@/lib/api/permissions";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import type { TenantEntity, Industry, LeadList } from "@/types/database";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ list?: string }>;
}) {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!canSeeNav(tenantData.permissions, "/leads")) redirect("/dashboard");

  const { list: listSlug } = await searchParams;

  const [serviceClient, cookieStore] = await Promise.all([
    createServiceClient(),
    cookies(),
  ]);

  const branchCookieVal = cookieStore.get("edgex_branch")?.value ?? null;

  // Build base scope; for all-scope admins apply the edgex_branch cookie from the header switcher
  const scope = leadQueryScope(tenantData.permissions, tenantData.userId, tenantData.branchId);
  if (tenantData.permissions.leadScope === "all" && branchCookieVal && branchCookieVal !== "all") {
    scope.branchId = branchCookieVal;
  }

  const isEducation = tenantData.tenant.industry_id === "education_consultancy";
  const hasLeadLists = isEducation && getFeatureAccess(tenantData.tenant.industry_id, FEATURES.LEAD_LISTS);

  // Resolve list slug → list object (and archive exclusion for master view)
  let activeList: LeadList | null = null;
  let allLists: LeadList[] = [];
  if (hasLeadLists) {
    allLists = await getLeadListsByTenant(tenantData.tenant.id);
    if (listSlug) {
      const found = allLists.find((l) => l.slug === listSlug);
      if (found) {
        const accessible = canAccessList(
          tenantData.permissions,
          found.access as { mode: string; positionIds?: string[] },
          tenantData.positionId,
        );
        if (accessible) activeList = found;
      }
    }
    const archiveIds = allLists.filter((l) => l.is_archive).map((l) => l.id);
    if (activeList) {
      scope.listId = activeList.id;
    } else {
      scope.excludeListIds = archiveIds;
    }
  }

  const [leads, teamMembers, stages, formConfigs, industryResult, entitiesResult, branches] =
    await Promise.all([
      getLeads(tenantData.tenant.id, scope),
      getTeamMembers(tenantData.tenant.id),
      getPipelineStages(tenantData.tenant.id),
      getFormConfigsForTenant(tenantData.tenant.id),
      tenantData.tenant.industry_id
        ? serviceClient
            .from("industries")
            .select("*")
            .eq("id", tenantData.tenant.industry_id)
            .single()
        : Promise.resolve({ data: null }),
      serviceClient
        .from("tenant_entities")
        .select("*")
        .eq("tenant_id", tenantData.tenant.id)
        .eq("is_active", true)
        .order("position", { ascending: true }),
      tenantData.entitlements.maxBranches > 1
        ? getBranches(tenantData.tenant.id)
        : Promise.resolve([]),
    ]);

  const memberMap = Object.fromEntries(teamMembers.map((m) => [m.user_id, m.email]));
  const formMap = Object.fromEntries(formConfigs.map((f) => [f.id, f.name]));

  const industry = industryResult.data as Industry | null;
  const entities = (entitiesResult.data || []) as TenantEntity[];

  const pageHeading = activeList ? activeList.name : "All Leads";

  // Pass lead lists (accessible ones) for the move-to-list selector
  const accessibleLists = hasLeadLists
    ? allLists.filter((l) =>
        canAccessList(
          tenantData.permissions,
          l.access as { mode: string; positionIds?: string[] },
          tenantData.positionId,
        )
      )
    : [];

  return (
    <div className="flex flex-col h-full min-h-0">
      <h1 className="shrink-0 text-lg font-bold mb-4 pr-6">{pageHeading}</h1>
      <LeadsTable
        leads={leads}
        memberMap={memberMap}
        stages={stages}
        formMap={formMap}
        role={tenantData.role as "owner" | "admin" | "viewer" | "counselor"}
        tenantId={tenantData.tenant.id}
        teamMembers={teamMembers}
        entities={entities}
        entityLabel={industry?.entity_type_label}
        currentUserId={tenantData.userId}
        industryId={tenantData.tenant.industry_id}
        branches={branches}
        maxBranches={tenantData.entitlements.maxBranches}
        leadLists={accessibleLists}
      />
    </div>
  );
}
