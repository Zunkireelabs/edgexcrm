import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiError,
  apiValidationError,
} from "@/lib/api/response";
import { validate, required, maxLength, isIn } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { createAuditLog, emitEvent } from "@/lib/api/audit";
import { validatePositionPermissions } from "@/lib/api/permissions";
import type { Position } from "@/types/database";

export async function GET() {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const db = await scopedClient(auth);
  const { data: positions, error } = await db
    .from("positions")
    .select("*")
    .order("base_tier", { ascending: true });

  if (error) return apiError("DB_ERROR", "Failed to fetch positions", 500);

  const positionList = ((positions ?? []) as unknown) as Position[];

  // Rollup member counts in JS (mirror KB's pattern)
  const memberCounts: Record<string, number> = {};
  if (positionList.length > 0) {
    const { data: memberships } = await db
      .raw()
      .from("tenant_users")
      .select("position_id")
      .eq("tenant_id", auth.tenantId)
      .not("position_id", "is", null);
    for (const m of memberships ?? []) {
      const pid = m.position_id as string;
      memberCounts[pid] = (memberCounts[pid] ?? 0) + 1;
    }
  }

  const result = positionList.map((p) => ({
    ...p,
    member_count: memberCounts[p.id] ?? 0,
  }));

  return apiSuccess(result);
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: "/api/v1/positions" });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ body: ["Invalid JSON body"] });
  }

  const { valid, errors } = validate(body, {
    name: [required("name"), maxLength(60)],
    base_tier: [required("base_tier"), isIn(["admin", "member"])],
    permissions: [required("permissions")],
  });
  if (!valid) return apiValidationError(errors);

  const permError = validatePositionPermissions(body.permissions);
  if (permError) return apiValidationError({ permissions: [permError] });

  const name = String(body.name).trim();

  // Generate slug from name (mirror pipelines slug logic)
  let slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  const db = await scopedClient(auth);

  // Ensure slug uniqueness
  const { data: existing } = await db
    .from("positions")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();

  if (existing) {
    // Append a counter to make it unique
    let counter = 2;
    let uniqueSlug = `${slug}-${counter}`;
    while (true) {
      const { data: conflict } = await db
        .from("positions")
        .select("id")
        .eq("slug", uniqueSlug)
        .maybeSingle();
      if (!conflict) break;
      counter++;
      uniqueSlug = `${slug}-${counter}`;
    }
    slug = uniqueSlug;
  }

  // Optional layer_id: validate it belongs to this tenant if provided
  let layerId: string | null = null;
  if (body.layer_id && typeof body.layer_id === "string") {
    const { data: layer } = await db
      .from("org_layers")
      .select("id")
      .eq("id", body.layer_id)
      .maybeSingle();
    if (!layer) return apiValidationError({ layer_id: ["Layer not found in this tenant"] });
    layerId = body.layer_id;
  }

  const { data: created, error } = await db
    .from("positions")
    .insert({
      name,
      slug,
      base_tier: body.base_tier as string,
      permissions: body.permissions,
      is_system: false,
      ...(layerId !== null ? { layer_id: layerId } : {}),
    })
    .select()
    .single();

  if (error) {
    log.error({ error }, "Failed to create position");
    return apiError("DB_ERROR", "Failed to create position", 500);
  }

  Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "position.created",
      entityType: "position",
      entityId: created.id,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "position.created",
      entityType: "position",
      entityId: created.id,
      payload: { name, base_tier: body.base_tier },
      requestId,
    }),
  ]);

  log.info({ positionId: created.id }, "Position created");
  return apiSuccess(created, 201);
}
