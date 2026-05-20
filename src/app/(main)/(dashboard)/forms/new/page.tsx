import { redirect } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { TemplatePicker } from "@/features/form-builder/components/template-picker";

export default async function NewFormPage() {
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
        You don&apos;t have permission to create forms.
      </div>
    );
  }

  return <TemplatePicker />;
}
