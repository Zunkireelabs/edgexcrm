import { redirect, notFound } from "next/navigation";
import {
  getCurrentUserTenant,
  getTeamMembers,
  getPipelineStages,
  getFormConfigsForTenant,
  getBranches,
} from "@/lib/supabase/queries";
import { getLeadCollaboratorsMap } from "@/lib/leads/collaborators";
import { createServiceClient } from "@/lib/supabase/server";
import { LeadsTable } from "@/components/dashboard/leads-table";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES, INDUSTRIES } from "@/industries/_registry";
import { ContactsListPage } from "@/industries/it-agency/features/crm-contacts/pages/contacts-list";
import { canSeeNav } from "@/lib/api/permissions";
import { filterAssignableMembersByChain } from "@/lib/leads/assignable";
import type { Lead, TenantEntity, Industry } from "@/types/database";

export default async function ContactsRoutePage() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!canSeeNav(tenantData.permissions, "/contacts")) redirect("/dashboard");

  const industry = tenantData.tenant.industry_id;

  // it_agency → CRM Contacts placeholder (Phase B will add real content)
  if (industry === INDUSTRIES.IT_AGENCY && getFeatureAccess(industry, FEATURES.CRM_CONTACTS)) {
    return (
      <ContactsListPage
        tenantId={tenantData.tenant.id}
        role={tenantData.role as "owner" | "admin" | "viewer" | "counselor"}
      />
    );
  }

  // education_consultancy → "other" tagged walk-in contacts, rendered with the same
  // LeadsTable used by the leads stage views (search/filters/sort/export/columns).
  // Admin/owner (all-scope) see every branch; a branch user sees only their branch's contacts.
  if (industry === INDUSTRIES.EDUCATION_CONSULTANCY && getFeatureAccess(industry, FEATURES.CONTACTS)) {
    const { baseTier } = tenantData.permissions;
    const isAllScope = baseTier === "owner" || baseTier === "admin";
    // A non-admin with no branch can't be branch-scoped — nothing to show.
    if (!isAllScope && !tenantData.branchId) redirect("/dashboard");

    const serviceClient = await createServiceClient();

    let contactsQuery = serviceClient
      .from("leads")
      .select("*")
      .eq("tenant_id", tenantData.tenant.id)
      .is("deleted_at", null)
      .contains("tags", ["other"]);

    // Branch users are limited to their own branch; admin/owner see all branches.
    if (!isAllScope) contactsQuery = contactsQuery.eq("branch_id", tenantData.branchId);

    const [
      { data: otherLeads },
      teamMembers,
      stages,
      formConfigs,
      branches,
      leadCollaboratorsMap,
      industryResult,
      entitiesResult,
    ] = await Promise.all([
      contactsQuery.order("created_at", { ascending: false }).limit(500),
      getTeamMembers(tenantData.tenant.id),
      getPipelineStages(tenantData.tenant.id),
      getFormConfigsForTenant(tenantData.tenant.id),
      tenantData.entitlements.maxBranches > 1 ? getBranches(tenantData.tenant.id) : Promise.resolve([]),
      getLeadCollaboratorsMap(serviceClient, tenantData.tenant.id),
      industry
        ? serviceClient.from("industries").select("*").eq("id", industry).single()
        : Promise.resolve({ data: null }),
      serviceClient
        .from("tenant_entities")
        .select("*")
        .eq("tenant_id", tenantData.tenant.id)
        .eq("is_active", true)
        .order("position", { ascending: true }),
    ]);

    const leads = (otherLeads || []) as Lead[];
    const memberMap = Object.fromEntries(teamMembers.map((m) => [m.user_id, m.email]));
    const memberNames = Object.fromEntries(teamMembers.map((m) => [m.user_id, m.name]));
    const memberBranchMap = Object.fromEntries(
      teamMembers.filter((m) => m.branch_id).map((m) => [m.user_id, m.branch_id as string])
    );
    const formMap = Object.fromEntries(formConfigs.map((f) => [f.id, f.name]));
    const roleMap = Object.fromEntries(teamMembers.map((m) => [m.user_id, m.position_name ?? m.role]));
    const positionSlugMap = Object.fromEntries(teamMembers.map((m) => [m.user_id, m.position_slug]));
    const industryRow = industryResult.data as Industry | null;
    const entities = (entitiesResult.data || []) as TenantEntity[];

    const assignableMembers = filterAssignableMembersByChain(teamMembers, {
      baseTier: tenantData.permissions.baseTier,
      leadScope: tenantData.permissions.leadScope,
      branchId: tenantData.branchId,
      positionSlug: tenantData.positionSlug,
      industryId: tenantData.tenant.industry_id,
      selfUserId: tenantData.userId,
    });

    return (
      <div className="flex flex-col h-full min-h-0">
        <h1 className="shrink-0 text-lg font-bold mb-1 pr-6">Contacts</h1>
        <p className="shrink-0 text-sm text-muted-foreground mb-4 pr-6">Walk-in visitors tagged as Other</p>
        <LeadsTable
          leads={leads}
          leadCollaborators={leadCollaboratorsMap}
          memberMap={memberMap}
          memberNames={memberNames}
          stages={stages}
          formMap={formMap}
          role={tenantData.role as "owner" | "admin" | "viewer" | "counselor"}
          tenantId={tenantData.tenant.id}
          teamMembers={teamMembers}
          entities={entities}
          entityLabel={industryRow?.entity_type_label}
          currentUserId={tenantData.userId}
          industryId={tenantData.tenant.industry_id}
          branches={branches}
          maxBranches={tenantData.entitlements.maxBranches}
          userBranchId={tenantData.branchId}
          canExport={tenantData.permissions.canExport}
          canEditLeads={tenantData.permissions.canEditLeads}
          assignableMembers={assignableMembers}
          memberBranchMap={memberBranchMap}
          isTeamScoped={tenantData.permissions.leadScope === "team"}
          roleMap={roleMap}
          positionSlugMap={positionSlugMap}
          currentUserPositionSlug={tenantData.positionSlug}
          disableAddLead
          hideTagFilter
          columnPrefsScope="contacts"
          excludeDefaultVisibleKeys={["lead_type", "status", "ref_code", "form_source"]}
          extraDefaultVisibleKeys={["phone", "created"]}
        />
      </div>
    );
  }

  notFound();
}
