import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiValidationError,
  apiConflict,
  apiInternalError,
} from "@/lib/api/response";
import type { TenantEntity } from "@/types/database";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/v1/entities/[id]
 * Get a single entity
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const auth = await authenticateRequest();
    if (!auth) {
      return apiUnauthorized();
    }

    const { id } = await params;
    const supabase = await createServiceClient();

    const { data, error } = await supabase
      .from("tenant_entities")
      .select("*")
      .eq("id", id)
      .eq("tenant_id", auth.tenantId)
      .single();

    if (error || !data) {
      return apiNotFound("Entity");
    }

    return apiSuccess(data as TenantEntity);
  } catch (error) {
    console.error("Get entity error:", error);
    return apiInternalError();
  }
}

/**
 * PATCH /api/v1/entities/[id]
 * Update an entity (admin only)
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const auth = await authenticateRequest();
    if (!auth) {
      return apiUnauthorized();
    }

    if (!requireAdmin(auth)) {
      return apiForbidden();
    }

    const { id } = await params;
    const body = await request.json();
    const { name, description, metadata, is_active, position } = body;

    // Validation
    const errors: Record<string, string[]> = {};

    if (name !== undefined) {
      if (typeof name !== "string" || name.trim().length === 0) {
        errors.name = ["Name is required"];
      } else if (name.trim().length > 255) {
        errors.name = ["Name must be 255 characters or less"];
      }
    }

    if (description !== undefined && description !== null && typeof description !== "string") {
      errors.description = ["Description must be a string"];
    }

    if (position !== undefined && (typeof position !== "number" || position < 0)) {
      errors.position = ["Position must be a non-negative number"];
    }

    if (Object.keys(errors).length > 0) {
      return apiValidationError(errors);
    }

    const supabase = await createServiceClient();

    // Check entity exists and belongs to tenant
    const { data: existing } = await supabase
      .from("tenant_entities")
      .select("id")
      .eq("id", id)
      .eq("tenant_id", auth.tenantId)
      .single();

    if (!existing) {
      return apiNotFound("Entity");
    }

    // Build update object
    const updates: Partial<TenantEntity> = {};
    if (name !== undefined) {
      updates.name = name.trim();
      // Update slug when name changes
      updates.slug = name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
    }
    if (description !== undefined) {
      updates.description = description?.trim() || null;
    }
    if (metadata !== undefined) {
      updates.metadata = metadata;
    }
    if (is_active !== undefined) {
      updates.is_active = Boolean(is_active);
    }
    if (position !== undefined) {
      updates.position = position;
    }

    const { data, error } = await supabase
      .from("tenant_entities")
      .update(updates)
      .eq("id", id)
      .eq("tenant_id", auth.tenantId)
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        return apiConflict("An entity with this name already exists");
      }
      console.error("Failed to update entity:", error);
      return apiInternalError();
    }

    return apiSuccess(data as TenantEntity);
  } catch (error) {
    console.error("Update entity error:", error);
    return apiInternalError();
  }
}

/**
 * DELETE /api/v1/entities/[id]
 * Delete an entity (admin only)
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const auth = await authenticateRequest();
    if (!auth) {
      return apiUnauthorized();
    }

    if (!requireAdmin(auth)) {
      return apiForbidden();
    }

    const { id } = await params;
    const supabase = await createServiceClient();

    // Check entity exists and belongs to tenant
    const { data: existing } = await supabase
      .from("tenant_entities")
      .select("id")
      .eq("id", id)
      .eq("tenant_id", auth.tenantId)
      .single();

    if (!existing) {
      return apiNotFound("Entity");
    }

    const { error } = await supabase
      .from("tenant_entities")
      .delete()
      .eq("id", id)
      .eq("tenant_id", auth.tenantId);

    if (error) {
      console.error("Failed to delete entity:", error);
      return apiInternalError();
    }

    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("Delete entity error:", error);
    return apiInternalError();
  }
}
