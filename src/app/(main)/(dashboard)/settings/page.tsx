import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { SettingsForm } from "@/components/dashboard/settings-form";
import { ApiKeysManager } from "@/components/dashboard/api-keys-manager";
import { EmailRulesManager } from "@/components/dashboard/settings/email-rules-manager";
import { IndustryInfoCard } from "@/components/dashboard/settings/industry-info-card";
import { IndustryEntitiesManager } from "@/components/dashboard/settings/industry-entities-manager";
import { PositionsManager } from "@/components/dashboard/settings/positions-manager";
import { LeadListsManager } from "@/components/dashboard/settings/lead-lists-manager";
import { AgentsManager } from "@/components/dashboard/settings/agents-manager";
import { BranchesManager } from "@/components/dashboard/settings/branches-manager";
import { ChannelsCard } from "@/components/dashboard/settings/channels-card";
import { EmailSenderCard } from "@/components/dashboard/settings/email-sender-card";
import { InboxConnector } from "@/industries/_shared/features/email/components/inbox-connector";
import { getFeatureAccess, getIndustrySidebarItems } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
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
      .select("id, name, permissions, permissions_detail, created_at, last_used_at, revoked_at")
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

  // Nav catalog: universal items + industry module items
  const UNIVERSAL_NAV = [
    { key: "/dashboard", label: "Dashboard" },
    { key: "/leads", label: "All Leads" },
    { key: "/pipeline", label: "Pipeline" },
    { key: "/knowledge-bases", label: "Knowledge Bases" },
    { key: "/team", label: "Team" },
    { key: "/settings", label: "Settings" },
  ];
  const industryNav = getIndustrySidebarItems(tenantData.tenant.industry_id, "owner").flatMap(
    (entry) => {
      if ("children" in entry) {
        return entry.children.map((child) => ({ key: child.href, label: child.label }));
      }
      return [{ key: entry.href, label: entry.label }];
    }
  );
  const navCatalog = [...UNIVERSAL_NAV, ...industryNav];

  const widgetCatalog = [
    { key: "stats", label: "Stats cards" },
    { key: "leads-by-stage", label: "Leads by stage" },
    { key: "leads-by-source", label: "Leads by source" },
    { key: "leads-by-counselor", label: "Leads by counselor" },
    { key: "utm", label: "UTM attribution" },
  ];

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
      <PositionsManager navCatalog={navCatalog} widgetCatalog={widgetCatalog} />
      {getFeatureAccess(tenantData.tenant.industry_id, FEATURES.LEAD_LISTS) && (
        <LeadListsManager />
      )}
      {getFeatureAccess(tenantData.tenant.industry_id, FEATURES.APPLICATION_TRACKING) && (
        <AgentsManager />
      )}
      <BranchesManager maxBranches={tenantData.entitlements.maxBranches} />
      <EmailRulesManager tenantId={tenantData.tenant.id} />
      <EmailSenderCard />
      <ChannelsCard />
      {getFeatureAccess(tenantData.tenant.industry_id, FEATURES.EMAIL) && (
        <Suspense>
          <InboxConnector />
        </Suspense>
      )}
      <ApiKeysManager
        tenantId={tenantData.tenant.id}
        initialKeys={apiKeys}
        category="integration"
      />
    </div>
  );
}
