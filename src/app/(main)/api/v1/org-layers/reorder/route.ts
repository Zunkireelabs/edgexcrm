import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiError,
  apiValidationError,
} from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";

export async function PATCH(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "PATCH", path: "/api/v1/org-layers/reorder" });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ body: ["Invalid JSON body"] });
  }

  if (!Array.isArray(body.order) || body.order.some((v) => typeof v !== "string")) {
    return apiValidationError({ order: ["must be an array of layer id strings"] });
  }

  const order = body.order as string[];
  const db = await scopedClient(auth);

  // Fetch tenant's real layer ids
  const { data: layers, error } = await db
    .from("org_layers")
    .select("id");

  if (error) return apiError("DB_ERROR", "Failed to fetch org layers", 500);

  const existingIds = new Set((layers ?? []).map((l) => (l as unknown as { id: string }).id));
  const submittedIds = new Set(order);

  const setsMatch =
    existingIds.size === submittedIds.size &&
    [...existingIds].every((id) => submittedIds.has(id));

  if (!setsMatch) {
    return apiValidationError({ order: ["must contain exactly the tenant's layers"] });
  }

  // Update sort_order for each layer
  for (let i = 0; i < order.length; i++) {
    await db
      .from("org_layers")
      .update({ sort_order: i, updated_at: new Date().toISOString() })
      .eq("id", order[i]);
  }

  // Return reordered list
  const { data: reordered } = await db
    .from("org_layers")
    .select("*")
    .order("sort_order", { ascending: true });

  log.info({ count: order.length }, "Org layers reordered");
  return apiSuccess(reordered);
}
