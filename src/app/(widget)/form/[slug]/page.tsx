import { notFound } from "next/navigation";
import { getFormConfigByTenantSlug } from "@/lib/supabase/queries";
import { createServiceClient } from "@/lib/supabase/server";
import { PublicForm } from "@/components/form/public-form";

// Revalidate cached page every 1 hour (ISR) — form config rarely changes
export const revalidate = 3600;

// Pre-build form pages at build time — eliminates cold-start TTFB
export async function generateStaticParams() {
  try {
    const supabase = await createServiceClient();
    const { data: tenants } = await supabase
      .from("tenants")
      .select("slug");
    return (tenants || []).map((t) => ({ slug: t.slug }));
  } catch {
    // Build continues even if DB is unreachable
    return [];
  }
}

// bg param is read client-side to keep the page static
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
