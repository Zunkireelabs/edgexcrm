import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { apiSuccess, apiValidationError, apiInternalError } from "@/lib/api/response";
import type { TenantEntity } from "@/types/database";

/**
 * GET /api/v1/entities/public
 * List active entities for a tenant (public endpoint for forms)
 * Query params:
 *   - tenant_id: Required tenant ID
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenant_id");

    if (!tenantId) {
      return apiValidationError({ tenant_id: ["tenant_id is required"] });
    }

    const supabase = await createServiceClient();

    const { data, error } = await supabase
      .from("tenant_entities")
      .select("id, name, slug, description")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .order("position", { ascending: true });

    if (error) {
      console.error("Failed to fetch public entities:", error);
      return apiInternalError();
    }

    return apiSuccess(data as Pick<TenantEntity, "id" | "name" | "slug" | "description">[]);
  } catch (error) {
    console.error("Public entities API error:", error);
    return apiInternalError();
  }
}
