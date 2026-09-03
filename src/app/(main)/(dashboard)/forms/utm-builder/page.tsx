import { redirect, notFound } from "next/navigation";
import { getCurrentUserTenant, getFormConfigsForTenant } from "@/lib/supabase/queries";
import { createServiceClient } from "@/lib/supabase/server";
import { scopedClientForTenant } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { UtmBuilderPageClient } from "@/industries/_shared/features/form-builder/components/utm-builder-page-client";
import { canSeeNav } from "@/lib/api/permissions";
import { computeSubmissionCounts, keyOf } from "@/lib/utm/submission-counts";
import type { UtmLink } from "@/types/database";

type UtmLinkRow = Omit<UtmLink, "form_name" | "submission_count"> & {
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

  const rows = (rawLinks ?? []) as UtmLinkRow[];
  console.log("[UTM-DEBUG] tenantData.tenant.id used for this page render:", tenantData.tenant.id, tenantData.tenant.slug);
  const db = await scopedClientForTenant(tenantData.tenant.id);
  const countByKey = await computeSubmissionCounts(db, rows);
  const initialLinks: UtmLink[] = rows.map(({ form, ...row }) => ({
    ...row,
    form_name: form?.name ?? null,
    submission_count: countByKey.get(keyOf(row.utm_source, row.utm_medium, row.utm_campaign)) ?? 0,
  }));

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-lg font-bold">UTM Link Builder</h1>
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
