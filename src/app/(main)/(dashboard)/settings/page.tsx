import { redirect } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { SettingsForm } from "@/components/dashboard/settings-form";
import { ApiKeysManager } from "@/components/dashboard/api-keys-manager";
import type { FormConfig } from "@/types/database";

export default async function SettingsPage() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");

  if (tenantData.role !== "owner" && tenantData.role !== "admin") {
    return (
      <div className="text-center py-12 text-muted-foreground">
        You don&apos;t have permission to view settings.
      </div>
    );
  }

  const supabase = await createClient();
  const serviceClient = await createServiceClient();

  const [formConfigsResult, apiKeysResult] = await Promise.all([
    supabase
      .from("form_configs")
      .select("*")
      .eq("tenant_id", tenantData.tenant.id)
      .eq("is_active", true)
      .order("created_at", { ascending: true }),
    serviceClient
      .from("integration_keys")
      .select("id, name, permissions, created_at, last_used_at, revoked_at")
      .eq("tenant_id", tenantData.tenant.id)
      .order("created_at", { ascending: false }),
  ]);

  const apiKeys = (apiKeysResult.data || []).map((k) => ({
    ...k,
    status: (k.revoked_at ? "revoked" : "active") as "active" | "revoked",
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground">
          Manage your organization, integrations, and form configuration
        </p>
      </div>
      <SettingsForm
        tenant={tenantData.tenant}
        formConfigs={(formConfigsResult.data || []) as FormConfig[]}
      />
      <ApiKeysManager
        tenantId={tenantData.tenant.id}
        initialKeys={apiKeys}
      />
    </div>
  );
}
