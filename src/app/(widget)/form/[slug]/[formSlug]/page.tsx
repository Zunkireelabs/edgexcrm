import { notFound } from "next/navigation";
import { getFormConfigByTenantSlug } from "@/lib/supabase/queries";
import { createServiceClient } from "@/lib/supabase/server";
import { PublicForm } from "@/components/form/public-form";

// Revalidate cached page every 1 hour (ISR)
export const revalidate = 3600;

// Pre-build form pages at build time
export async function generateStaticParams() {
  try {
    const supabase = await createServiceClient();
    const { data: tenants } = await supabase
      .from("tenants")
      .select("id, slug");
    if (!tenants) return [];

    const params: { slug: string; formSlug: string }[] = [];
    for (const tenant of tenants) {
      const { data: forms } = await supabase
        .from("form_configs")
        .select("slug")
        .eq("tenant_id", tenant.id)
        .eq("is_active", true);
      for (const form of forms || []) {
        if (form.slug) {
          params.push({ slug: tenant.slug, formSlug: form.slug });
        }
      }
    }
    return params;
  } catch {
    return [];
  }
}

// bg param is read client-side to keep the page static
export default async function FormSlugPage({
  params,
}: {
  params: Promise<{ slug: string; formSlug: string }>;
}) {
  const { slug, formSlug } = await params;

  const result = await getFormConfigByTenantSlug(slug, formSlug);
  if (!result) notFound();

  return (
    <PublicForm
      tenant={result.tenant}
      formConfig={result.formConfig}
    />
  );
}
