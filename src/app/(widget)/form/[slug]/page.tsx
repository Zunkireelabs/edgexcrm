import { notFound } from "next/navigation";
import { getFormConfigByTenantSlug } from "@/lib/supabase/queries";
import { PublicForm } from "@/components/form/public-form";

// Always fetch fresh form config — enables real-time form updates from builder
export const dynamic = "force-dynamic";


export default async function FormPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const result = await getFormConfigByTenantSlug(slug);
  if (!result) notFound();

  return (
    <PublicForm
      tenant={result.tenant}
      formConfig={result.formConfig}
    />
  );
}
