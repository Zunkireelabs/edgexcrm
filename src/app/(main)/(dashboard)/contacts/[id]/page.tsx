import { redirect, notFound } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES, INDUSTRIES } from "@/industries/_registry";
import { ContactDetailPage } from "@/industries/it-agency/features/crm-contacts/pages/contact-detail";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ContactDetailRoute({ params }: Props) {
  const { id } = await params;
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");

  const industry = tenantData.tenant.industry_id;
  if (industry !== INDUSTRIES.IT_AGENCY) notFound();
  if (!getFeatureAccess(industry, FEATURES.CRM_CONTACTS)) notFound();

  return (
    <ContactDetailPage
      tenantId={tenantData.tenant.id}
      role={tenantData.role as "owner" | "admin" | "viewer" | "counselor"}
      contactId={id}
    />
  );
}
