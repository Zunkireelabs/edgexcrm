import { notFound, redirect } from "next/navigation";
import {
  getCurrentUserTenant,
  getTeamMembers,
  getPipelineStages,
  getFormConfigsForTenant,
  getBranches,
  getLeadListsByTenant,
} from "@/lib/supabase/queries";
import { createServiceClient } from "@/lib/supabase/server";
import { LeadsTable } from "@/components/dashboard/leads-table";
import { canAccessList } from "@/lib/api/permissions";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import type { Lead, TenantEntity, Industry, LeadList } from "@/types/database";

export default async function FollowUpsPage() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");

  // Gate: industry must opt in to the feature.
  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.FOLLOW_UPS)) {
    notFound();
  }

  // Gate: only users restricted to their own leads need this page.
  // Owner/admin/branch-manager already see broader scopes in All Leads.
  if (tenantData.permissions.leadScope !== "own") {
    notFound();
  }

  const serviceClient = await createServiceClient();

  // Step 1: find every assignment-history row where the current user was the
  // *from* side. We filter same-position handoffs in JS because PostgREST
  // can't express column=column comparisons directly.
  const { data: historyRows } = await serviceClient
    .from("lead_assignment_history")
    .select("lead_id, from_position_id, to_position_id, created_at")
    .eq("tenant_id", tenantData.tenant.id)
    .eq("from_user_id", tenantData.userId)
    .order("created_at", { ascending: false });

  const leadIds = Array.from(
    new Set(
      (historyRows ?? [])
        .filter(
          (r) =>
            r.from_position_id !== null &&
            r.from_position_id === r.to_position_id,
        )
        .map((r) => r.lead_id as string),
    ),
  );

  // Step 2: load the actual lead rows + the shell pieces LeadsTable needs.
  const [leadsResult, teamMembers, stages, formConfigs, industryResult, entitiesResult, branches, leadListsRaw] =
    await Promise.all([
      leadIds.length > 0
        ? serviceClient
            .from("leads")
            .select("*")
            .eq("tenant_id", tenantData.tenant.id)
            .is("deleted_at", null)
            .is("converted_at", null)
            .in("id", leadIds)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [] as Lead[] }),
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
      getFeatureAccess(tenantData.tenant.industry_id, FEATURES.LEAD_LISTS)
        ? getLeadListsByTenant(tenantData.tenant.id)
        : Promise.resolve([] as LeadList[]),
    ]);

  const leads = (leadsResult.data ?? []) as Lead[];

  const memberMap = Object.fromEntries(teamMembers.map((m) => [m.user_id, m.email]));
  const memberNames = Object.fromEntries(teamMembers.map((m) => [m.user_id, m.name]));
  const memberBranchMap = Object.fromEntries(
    teamMembers.filter((m) => m.branch_id).map((m) => [m.user_id, m.branch_id as string]),
  );
  const formMap = Object.fromEntries(formConfigs.map((f) => [f.id, f.name]));

  const industry = industryResult.data as Industry | null;
  const entities = (entitiesResult.data || []) as TenantEntity[];

  const accessibleLists = (leadListsRaw as LeadList[]).filter((l) =>
    canAccessList(
      tenantData.permissions,
      l.access as { mode: string; positionIds?: string[] },
      tenantData.positionId,
    ),
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 mb-4 pr-6">
        <h1 className="text-lg font-bold">Follow-ups</h1>
        <p className="text-xs text-gray-500 mt-0.5">
          Leads you previously handled and passed on to a peer in the same position.
        </p>
      </div>
      <LeadsTable
        leads={leads}
        memberMap={memberMap}
        memberNames={memberNames}
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
        selectedBranchId={null}
        userBranchId={tenantData.branchId}
        leadLists={accessibleLists}
        viewMode="normal"
        intakeListId={null}
        canExport={tenantData.permissions.canExport}
        memberBranchMap={memberBranchMap}
        activeListSlug={null}
        hasListPipeline={false}
      />
    </div>
  );
}
