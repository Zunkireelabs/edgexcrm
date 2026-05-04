import { redirect } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { SettingsForm } from "@/components/dashboard/settings-form";
import { ApiKeysManager } from "@/components/dashboard/api-keys-manager";
import { EmailRulesManager } from "@/components/dashboard/settings/email-rules-manager";
import { IndustryInfoCard } from "@/components/dashboard/settings/industry-info-card";
import { IndustryEntitiesManager } from "@/components/dashboard/settings/industry-entities-manager";
import type { FormConfig, Industry, TenantEntity } from "@/types/database";

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

  const [formConfigsResult, apiKeysResult, industryResult, entitiesResult] = await Promise.all([
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
    // Fetch industry if tenant has one assigned
    tenantData.tenant.industry_id
      ? serviceClient
          .from("industries")
          .select("*")
          .eq("id", tenantData.tenant.industry_id)
          .single()
      : Promise.resolve({ data: null }),
    // Fetch tenant entities
    serviceClient
      .from("tenant_entities")
      .select("*")
      .eq("tenant_id", tenantData.tenant.id)
      .order("position", { ascending: true }),
  ]);

  const apiKeys = (apiKeysResult.data || []).map((k) => ({
    ...k,
    status: (k.revoked_at ? "revoked" : "active") as "active" | "revoked",
  }));

  const industry = industryResult.data as Industry | null;
  const entities = (entitiesResult.data || []) as TenantEntity[];

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-bold">Settings</h1>
      <SettingsForm
        tenant={tenantData.tenant}
        formConfigs={(formConfigsResult.data || []) as FormConfig[]}
      />
      <IndustryInfoCard industry={industry} />
      {industry && (
        <IndustryEntitiesManager
          industry={industry}
          initialEntities={entities}
        />
      )}
      <EmailRulesManager tenantId={tenantData.tenant.id} />
      <ApiKeysManager
        tenantId={tenantData.tenant.id}
        initialKeys={apiKeys}
      />
    </div>
  );
}
