import { redirect, notFound } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { FormCreationWizard } from "@/industries/education-consultancy/features/form-builder/components/form-creation-wizard";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { canSeeNav } from "@/lib/api/permissions";

export default async function NewFormPage() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.FORM_BUILDER)) notFound();
  if (!canSeeNav(tenantData.permissions, "/forms")) redirect("/dashboard");

  if (tenantData.role !== "owner" && tenantData.role !== "admin") {
    return (
      <div className="text-center py-12 text-muted-foreground">
        You don&apos;t have permission to create forms.
      </div>
    );
  }

  return (
    <FormCreationWizard
      tenantPrimaryColor={tenantData.tenant.primary_color || "#6366f1"}
      tenantSlug={tenantData.tenant.slug}
    />
  );
}
