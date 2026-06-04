import { redirect, notFound } from "next/navigation";
import { getCurrentUserTenant, getFormConfigsForTenant } from "@/lib/supabase/queries";
import { createServiceClient } from "@/lib/supabase/server";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { UtmBuilderPageClient } from "@/industries/education-consultancy/features/form-builder/components/utm-builder-page-client";
import { canSeeNav } from "@/lib/api/permissions";
import type { UtmLink } from "@/types/database";

type UtmLinkRow = Omit<UtmLink, "form_name"> & {
  form: { name: string } | null;
};

export default async function UtmBuilderPage() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.FORM_BUILDER)) notFound();
  if (!canSeeNav(tenantData.permissions, "/forms")) redirect("/dashboard");

  const forms = await getFormConfigsForTenant(tenantData.tenant.id);

  const supabase = await createServiceClient();
  const { data: rawLinks } = await supabase
    .from("utm_links")
    .select("*, form:form_configs(name)")
    .eq("tenant_id", tenantData.tenant.id)
    .order("created_at", { ascending: false });

  const initialLinks: UtmLink[] = ((rawLinks ?? []) as UtmLinkRow[]).map(
    ({ form, ...row }) => ({ ...row, form_name: form?.name ?? null }),
  );

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold">UTM Link Builder</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Pick one of your forms or paste any destination URL, then add UTM params. Share the result in your Facebook ad, email, or social post.
        </p>
      </div>
      <UtmBuilderPageClient
        tenantSlug={tenantData.tenant.slug}
        forms={forms.map((f) => ({ id: f.id, name: f.name, slug: f.slug }))}
        initialLinks={initialLinks}
      />
    </div>
  );
}
