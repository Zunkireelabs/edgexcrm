import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiError,
  apiValidationError,
} from "@/lib/api/response";
import { validate, required, maxLength } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { createAuditLog, emitEvent } from "@/lib/api/audit";
import { canSeeNav } from "@/lib/api/permissions";
import type { OrgLayer, Position } from "@/types/database";

interface OrgMember {
  user_id: string;
  name: string | null;
  email: string;
  role: string;
}

export interface OrgLayerWithPositions extends OrgLayer {
  positions: (Position & { member_count: number; members: OrgMember[] })[];
}

export async function GET() {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!canSeeNav(auth.permissions, "/team")) return apiForbidden();

  const db = await scopedClient(auth);

  // Query 1: org layers ordered
  const { data: layers, error: layersError } = await db
    .from("org_layers")
    .select("*")
    .order("sort_order", { ascending: true });

  if (layersError) return apiError("DB_ERROR", "Failed to fetch org layers", 500);

  // Query 2: all positions
  const { data: positions, error: positionsError } = await db
    .from("positions")
    .select("*");

  if (positionsError) return apiError("DB_ERROR", "Failed to fetch positions", 500);

  // Query 3: members (all, including position_id NULL) + email enrichment
  const { data: membersRaw } = await db
    .from("tenant_users")
    .select("user_id, role, position_id")
    .order("created_at", { ascending: true });

  // perPage:1000 future-proofs against silent truncation as the tenant grows.
  const { data: authData } = await db.raw().auth.admin.listUsers({ perPage: 1000 });
  const emailMap = new Map<string, string>();
  const nameMap = new Map<string, string | null>();
  for (const u of authData?.users ?? []) {
    emailMap.set(u.id, u.email || "");
    const meta = u.user_metadata as Record<string, unknown> | undefined;
    nameMap.set(u.id, (meta?.name ?? meta?.full_name ?? null) as string | null);
  }

  const membersByPosition: Record<string, OrgMember[]> = {};
  const unassignedMembers: OrgMember[] = [];
  for (const m of (membersRaw ?? []) as unknown as Array<{ user_id: string; role: string; position_id: string | null }>) {
    const member: OrgMember = { user_id: m.user_id, name: nameMap.get(m.user_id) ?? null, email: emailMap.get(m.user_id) || "Unknown", role: m.role };
    if (m.position_id) (membersByPosition[m.position_id] ??= []).push(member);
    else unassignedMembers.push(member);
  }

  const positionList = ((positions ?? []) as unknown as Position[]).map((p) => ({
    ...p,
    member_count: (membersByPosition[p.id] ?? []).length,
    members: membersByPosition[p.id] ?? [],
  }));

  // Group positions by layer_id
  const positionsByLayer: Record<string, typeof positionList> = {};
  const unassigned: typeof positionList = [];

  for (const p of positionList) {
    if (p.layer_id) {
      if (!positionsByLayer[p.layer_id]) positionsByLayer[p.layer_id] = [];
      positionsByLayer[p.layer_id].push(p);
    } else {
      unassigned.push(p);
    }
  }

  const result: OrgLayerWithPositions[] = ((layers ?? []) as unknown as OrgLayer[]).map((l) => ({
    ...l,
    positions: positionsByLayer[l.id] ?? [],
  }));

  // Synthetic Unassigned bucket — only when non-empty
  if (unassigned.length > 0) {
    result.push({
      id: "__unassigned__",
      tenant_id: auth.tenantId,
      name: "Unassigned",
      description: null,
      sort_order: 9999,
      created_at: "",
      updated_at: "",
      positions: unassigned,
    });
  }

  return apiSuccess({ layers: result, unassigned_members: unassignedMembers });
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: "/api/v1/org-layers" });

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
  });
  if (!valid) return apiValidationError(errors);

  const db = await scopedClient(auth);

  // Compute new sort_order = max + 1
  const { data: maxRow } = await db
    .from("org_layers")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextOrder = maxRow ? ((maxRow as unknown as { sort_order: number }).sort_order) + 1 : 0;

  const { data: created, error } = await db
    .from("org_layers")
    .insert({
      name: String(body.name).trim(),
      description: body.description ? String(body.description).trim() : null,
      sort_order: nextOrder,
    })
    .select()
    .single();

  if (error) {
    log.error({ error }, "Failed to create org layer");
    return apiError("DB_ERROR", "Failed to create org layer", 500);
  }

  Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "org_layer.created",
      entityType: "org_layer",
      entityId: created.id,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "org_layer.created",
      entityType: "org_layer",
      entityId: created.id,
      payload: { name: body.name },
      requestId,
    }),
  ]);

  log.info({ layerId: created.id }, "Org layer created");
  return apiSuccess(created, 201);
}
