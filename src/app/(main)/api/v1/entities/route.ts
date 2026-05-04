import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiValidationError,
  apiConflict,
  apiInternalError,
} from "@/lib/api/response";
import type { TenantEntity } from "@/types/database";

/**
 * GET /api/v1/entities
 * List tenant's entities
 * Query params:
 *   - active: "true" to filter only active entities (useful for public forms)
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest();
    if (!auth) {
      return apiUnauthorized();
    }

    const { searchParams } = new URL(request.url);
    const activeOnly = searchParams.get("active") === "true";

    const supabase = await createServiceClient();

    let query = supabase
      .from("tenant_entities")
      .select("*")
      .eq("tenant_id", auth.tenantId)
      .order("position", { ascending: true });

    if (activeOnly) {
      query = query.eq("is_active", true);
    }

    const { data, error } = await query;

    if (error) {
      console.error("Failed to fetch entities:", error);
      return apiInternalError();
    }

    return apiSuccess(data as TenantEntity[]);
  } catch (error) {
    console.error("Entities API error:", error);
    return apiInternalError();
  }
}

/**
 * POST /api/v1/entities
 * Create a new entity (admin only)
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateRequest();
    if (!auth) {
      return apiUnauthorized();
    }

    if (!requireAdmin(auth)) {
      return apiForbidden();
    }

    const body = await request.json();
    const { name, description, metadata, is_active } = body;

    // Validation
    const errors: Record<string, string[]> = {};

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      errors.name = ["Name is required"];
    } else if (name.trim().length > 255) {
      errors.name = ["Name must be 255 characters or less"];
    }

    if (description && typeof description !== "string") {
      errors.description = ["Description must be a string"];
    }

    if (Object.keys(errors).length > 0) {
      return apiValidationError(errors);
    }

    // Generate slug from name
    const slug = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    const supabase = await createServiceClient();

    // Get the next position
    const { data: existing } = await supabase
      .from("tenant_entities")
      .select("position")
      .eq("tenant_id", auth.tenantId)
      .order("position", { ascending: false })
      .limit(1);

    const nextPosition = existing && existing.length > 0 ? existing[0].position + 1 : 0;

    const { data, error } = await supabase
      .from("tenant_entities")
      .insert({
        tenant_id: auth.tenantId,
        name: name.trim(),
        slug,
        description: description?.trim() || null,
        metadata: metadata || {},
        is_active: is_active !== false,
        position: nextPosition,
      })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        return apiConflict("An entity with this name already exists");
      }
      console.error("Failed to create entity:", error);
      return apiInternalError();
    }

    return apiSuccess(data as TenantEntity, 201);
  } catch (error) {
    console.error("Create entity error:", error);
    return apiInternalError();
  }
}
