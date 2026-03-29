import { redirect } from "next/navigation";
import { getCurrentUserTenant, getFormConfigsForTenant } from "@/lib/supabase/queries";
import { createClient } from "@/lib/supabase/server";
import { DashboardShell } from "@/components/dashboard/shell";
import { AIAssistantProvider } from "@/contexts/ai-assistant-context";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const tenantData = await getCurrentUserTenant();
  if (!tenantData) {
    // User is authenticated but has no tenant — don't redirect to /login (causes loop)
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center space-y-2">
          <h1 className="text-xl font-semibold">No Organization Found</h1>
          <p className="text-muted-foreground text-sm">
            Your account is not linked to any organization yet.
          </p>
        </div>
      </div>
    );
  }

  const formConfigs = await getFormConfigsForTenant(tenantData.tenant.id);

  return (
    <AIAssistantProvider>
      <DashboardShell
        user={user}
        tenant={tenantData.tenant}
        role={tenantData.role}
        formConfigs={formConfigs.map((f) => ({ name: f.name, slug: f.slug }))}
      >
        {children}
      </DashboardShell>
    </AIAssistantProvider>
  );
}
