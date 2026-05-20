import { notFound } from "next/navigation";
import { getFormConfigByTenantSlug } from "@/lib/supabase/queries";
import { PublicForm } from "@/components/form/public-form";

// Always fetch fresh form config — enables real-time form updates from builder
export const dynamic = "force-dynamic";

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
