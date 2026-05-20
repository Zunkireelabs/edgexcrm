import { redirect } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { createServiceClient } from "@/lib/supabase/server";
import { FormList } from "@/features/form-builder/components/form-list";
import type { FormConfig } from "@/types/database";

export default async function FormsPage() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");

  if (tenantData.tenant.industry_id !== "education_consultancy") {
    return (
      <div className="text-center py-12 text-muted-foreground">
        Form builder is only available for Education Consultancy tenants.
      </div>
    );
  }

  if (tenantData.role !== "owner" && tenantData.role !== "admin") {
    return (
      <div className="text-center py-12 text-muted-foreground">
        You don&apos;t have permission to manage forms.
      </div>
    );
  }

  const supabase = await createServiceClient();
  const { data: formConfigs } = await supabase
    .from("form_configs")
    .select("id, name, slug, is_active, created_at, updated_at, steps, branding, redirect_url, tenant_id")
    .eq("tenant_id", tenantData.tenant.id)
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Forms</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Create and manage your lead collection forms.
        </p>
      </div>
      <FormList
        forms={(formConfigs ?? []) as FormConfig[]}
        tenantSlug={tenantData.tenant.slug}
      />
    </div>
  );
}
