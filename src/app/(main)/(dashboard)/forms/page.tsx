import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { createServiceClient } from "@/lib/supabase/server";
import { FormList } from "@/industries/education-consultancy/features/form-builder/components/form-list";
import { ApiKeysManager } from "@/components/dashboard/api-keys-manager";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { canSeeNav } from "@/lib/api/permissions";
import type { FormConfig } from "@/types/database";

export default async function FormsPage() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.FORM_BUILDER)) notFound();
  if (!canSeeNav(tenantData.permissions, "/forms")) redirect("/dashboard");

  if (tenantData.role !== "owner" && tenantData.role !== "admin") {
    return (
      <div className="text-center py-12 text-muted-foreground">
        You don&apos;t have permission to manage forms.
      </div>
    );
  }

  const supabase = await createServiceClient();

  const [formConfigsResult, apiKeysResult] = await Promise.all([
    supabase
      .from("form_configs")
      .select("id, name, slug, is_active, created_at, updated_at, steps, branding, redirect_url, tenant_id")
      .eq("tenant_id", tenantData.tenant.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("integration_keys")
      .select("id, name, permissions, permissions_detail, created_at, last_used_at, revoked_at")
      .eq("tenant_id", tenantData.tenant.id)
      .order("created_at", { ascending: false }),
  ]);

  const apiKeys = (apiKeysResult.data || []).map((k) => ({
    ...k,
    status: (k.revoked_at ? "revoked" : "active") as "active" | "revoked",
  }));

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Forms</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Create and manage your lead collection forms.
          </p>
        </div>
        <Link href="/forms/utm-builder">
          <Button variant="outline" size="sm">
            <Link2 className="h-4 w-4 mr-2" />
            UTM Link Builder
          </Button>
        </Link>
      </div>
      <FormList
        forms={(formConfigsResult.data ?? []) as FormConfig[]}
        tenantSlug={tenantData.tenant.slug}
      />
      <ApiKeysManager
        tenantId={tenantData.tenant.id}
        initialKeys={apiKeys}
        category="form"
      />
    </div>
  );
}
