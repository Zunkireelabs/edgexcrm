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

  // education_consultancy → show "other" tagged walk-in contacts (admin/owner only)
  if (industry === INDUSTRIES.EDUCATION_CONSULTANCY && getFeatureAccess(industry, FEATURES.CONTACTS)) {
    const { baseTier } = tenantData.permissions;
    if (baseTier !== "owner" && baseTier !== "admin") redirect("/dashboard");

    const supabase = await createServiceClient();

    const { data: otherLeads } = await supabase
      .from("leads")
      .select("*")
      .eq("tenant_id", tenantData.tenant.id)
      .is("deleted_at", null)
      .contains("tags", ["other"])
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
