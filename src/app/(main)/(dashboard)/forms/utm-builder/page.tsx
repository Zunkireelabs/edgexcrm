import { redirect, notFound } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { UtmLinkBuilder } from "@/industries/education-consultancy/features/form-builder/components/utm-link-builder";

export default async function UtmBuilderPage() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.FORM_BUILDER)) notFound();

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold">UTM Link Builder</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Paste any destination URL and we&apos;ll append the source, medium, and campaign params for you. Share the result in your Facebook ad, email, or social post.
        </p>
      </div>
      <UtmLinkBuilder />
    </div>
  );
}
