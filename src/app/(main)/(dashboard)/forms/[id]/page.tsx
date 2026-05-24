import { redirect, notFound } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { createServiceClient } from "@/lib/supabase/server";
import { FormBuilderPage } from "@/industries/education-consultancy/features/form-builder/components/form-builder-page";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import type { FormConfig } from "@/types/database";

export default async function EditFormPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.FORM_BUILDER)) notFound();

  if (tenantData.role !== "owner" && tenantData.role !== "admin") {
    return (
      <div className="text-center py-12 text-muted-foreground">
        You don&apos;t have permission to edit forms.
      </div>
    );
  }

  const supabase = await createServiceClient();
  const { data: formConfig } = await supabase
    .from("form_configs")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", tenantData.tenant.id)
    .single();

  if (!formConfig) notFound();

  return (
    <FormBuilderPage
      formConfig={formConfig as FormConfig}
      tenantSlug={tenantData.tenant.slug}
    />
  );
}
