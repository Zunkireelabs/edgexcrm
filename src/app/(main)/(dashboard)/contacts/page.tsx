import { redirect, notFound } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { createServiceClient } from "@/lib/supabase/server";
import { ContactsPage } from "@/industries/education-consultancy/features/contacts/ui";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES, INDUSTRIES } from "@/industries/_registry";
import { ContactsListPage } from "@/industries/it-agency/features/crm-contacts/pages/contacts-list";
import { canSeeNav } from "@/lib/api/permissions";
import type { Lead } from "@/types/database";

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

  // education_consultancy → show "other" tagged walk-in contacts.
  // Admin/owner (all-scope) see every branch; a branch user sees only their branch's contacts.
  if (industry === INDUSTRIES.EDUCATION_CONSULTANCY && getFeatureAccess(industry, FEATURES.CONTACTS)) {
    const { baseTier } = tenantData.permissions;
    const isAllScope = baseTier === "owner" || baseTier === "admin";
    // A non-admin with no branch can't be branch-scoped — nothing to show.
    if (!isAllScope && !tenantData.branchId) redirect("/dashboard");

    const supabase = await createServiceClient();

    let query = supabase
      .from("leads")
      .select("*")
      .eq("tenant_id", tenantData.tenant.id)
      .is("deleted_at", null)
      .contains("tags", ["other"]);

    // Branch users are limited to their own branch; admin/owner see all branches.
    if (!isAllScope) query = query.eq("branch_id", tenantData.branchId);

    const { data: otherLeads } = await query
      .order("created_at", { ascending: false })
      .limit(500);

    const leads = (otherLeads || []) as Lead[];

    return (
      <ContactsPage
        leads={leads}
        role={tenantData.role as "owner" | "admin" | "viewer" | "counselor"}
        tenantId={tenantData.tenant.id}
      />
    );
  }

  notFound();
}
