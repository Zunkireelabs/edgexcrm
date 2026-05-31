import { redirect, notFound } from "next/navigation";
import { getCurrentUserTenant, getFormConfigsForTenant } from "@/lib/supabase/queries";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { UtmLinkBuilder } from "@/industries/education-consultancy/features/form-builder/components/utm-link-builder";

export default async function UtmBuilderPage() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.FORM_BUILDER)) notFound();

  const forms = await getFormConfigsForTenant(tenantData.tenant.id);

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold">UTM Link Builder</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Pick one of your forms or paste any destination URL, then add UTM params. Share the result in your Facebook ad, email, or social post.
        </p>
      </div>
      <UtmLinkBuilder
        tenantSlug={tenantData.tenant.slug}
        forms={forms.map((f) => ({ id: f.id, name: f.name, slug: f.slug }))}
      />
    </div>
  );
}
