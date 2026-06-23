import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { apiUnauthorized, apiForbidden } from "@/lib/api/response";
import { buildNavCatalog, WIDGET_CATALOG } from "@/lib/settings/catalogs";
import { resolveEntitlements } from "@/lib/api/entitlements";
import type { Industry } from "@/types/database";

export async function GET() {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (auth.role !== "owner" && auth.role !== "admin") return apiForbidden();

  const supabase = await createServiceClient();

  const [industryResult, tenantResult] = await Promise.all([
    auth.industryId
      ? supabase.from("industries").select("*").eq("id", auth.industryId).single()
      : Promise.resolve({ data: null }),
    supabase
      .from("tenants")
      .select("plan, entitlement_overrides")
      .eq("id", auth.tenantId)
      .single(),
  ]);

  const entitlements = resolveEntitlements(tenantResult.data ?? {});

  return NextResponse.json({
    data: {
      industry: (industryResult.data ?? null) as Industry | null,
      navCatalog: buildNavCatalog(auth.industryId),
      widgetCatalog: WIDGET_CATALOG,
      maxBranches: entitlements.maxBranches,
    },
  });
}
