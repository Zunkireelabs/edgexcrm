import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { Link2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { createServiceClient } from "@/lib/supabase/server";
import { FormList } from "@/industries/_shared/features/form-builder/components/form-list";
import { ApiKeysManager } from "@/components/dashboard/api-keys-manager";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { canSeeNav } from "@/lib/api/permissions";
import { createRequestLogger } from "@/lib/logger";
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

  const [formConfigsResult, apiKeysResult, submissionCountsResult] = await Promise.all([
    supabase
      .from("form_configs")
      .select("id, name, slug, is_active, created_at, updated_at, steps, branding, redirect_url, tenant_id")
      .eq("tenant_id", tenantData.tenant.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("integration_keys")
      .select("id, name, permissions, permissions_detail, form_id, created_at, last_used_at, revoked_at")
      .eq("tenant_id", tenantData.tenant.id)
      .order("created_at", { ascending: false }),
    supabase.rpc("form_submission_counts", { p_tenant_id: tenantData.tenant.id }),
  ]);

  if (submissionCountsResult.error) {
    // Swallowed to `[]` below rather than failing the whole page — but a broken
    // deploy (e.g. migration 217 not applied) must not look identical to
    // "this tenant has no submissions", so it's logged server-side.
    createRequestLogger({
      requestId: crypto.randomUUID(),
      method: "GET",
      path: "/forms",
      tenantId: tenantData.tenant.id,
    }).error({ error: submissionCountsResult.error }, "form_submission_counts RPC failed");
  }
  const submissionCounts: Record<string, { total: number; last30d: number }> = {};
  for (const row of submissionCountsResult.data ?? []) {
    const r = row as { form_config_id: string; total: number; last_30d: number };
    submissionCounts[r.form_config_id] = { total: Number(r.total), last30d: Number(r.last_30d) };
  }

  const apiKeys = (apiKeysResult.data || []).map((k) => ({
    ...k,
    form_id: (k.form_id as string | null) ?? null,
    status: (k.revoked_at ? "revoked" : "active") as "active" | "revoked",
  }));

  const formList = (formConfigsResult.data ?? []).map((f) => ({ id: f.id, name: f.name }));

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-lg font-bold">Forms</h1>
        <div className="flex items-center gap-2">
          <Link href="/forms/utm-builder">
            <Button variant="outline" size="sm">
              <Link2 className="h-4 w-4 mr-2" />
              UTM Link Builder
            </Button>
          </Link>
          <Link href="/forms/new">
            <Button size="sm">
              <Plus className="h-4 w-4 mr-2" />
              New Form
            </Button>
          </Link>
        </div>
      </div>
      <FormList
        forms={(formConfigsResult.data ?? []) as FormConfig[]}
        tenantSlug={tenantData.tenant.slug}
        submissionCounts={submissionCounts}
      />
      <ApiKeysManager
        tenantId={tenantData.tenant.id}
        initialKeys={apiKeys}
        category="form"
        forms={formList}
      />
    </div>
  );
}
