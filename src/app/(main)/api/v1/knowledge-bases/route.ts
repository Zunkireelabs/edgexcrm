import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import { canSeeNav } from "@/lib/api/permissions";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiError,
  apiValidationError,
} from "@/lib/api/response";
import { validate, required, maxLength, optionalMaxLength } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { createAuditLog, emitEvent } from "@/lib/api/audit";

export async function GET() {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!canSeeNav(auth.permissions, "/knowledge-bases")) return apiForbidden();

  const db = await scopedClient(auth);
  const { data: kbs, error } = await db
    .from("knowledge_bases")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return apiError("DB_ERROR", "Failed to fetch knowledge bases", 500);

  const kbList = ((kbs ?? []) as unknown) as Array<{
    id: string;
    [key: string]: unknown;
  }>;

  // Rollup item counts + total size in JS (PostgREST has no easy GROUP-BY via the JS client)
  const rollup: Record<string, { item_count: number; total_size_bytes: number }> = {};
  if (kbList.length > 0) {
    const { data: items } = await db
      .raw()
      .from("knowledge_base_items")
      .select("knowledge_base_id, size_bytes")
      .eq("tenant_id", auth.tenantId);
    for (const item of items ?? []) {
      const kbId = item.knowledge_base_id as string;
      if (!rollup[kbId]) rollup[kbId] = { item_count: 0, total_size_bytes: 0 };
      rollup[kbId].item_count += 1;
      rollup[kbId].total_size_bytes += Number(item.size_bytes ?? 0);
    }
  }

  const result = kbList.map((kb) => ({
    ...kb,
    item_count: rollup[kb.id]?.item_count ?? 0,
    total_size_bytes: rollup[kb.id]?.total_size_bytes ?? 0,
  }));

  return apiSuccess(result);
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: "/api/v1/knowledge-bases" });

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
    name: [required("name"), maxLength(255)],
    description: [optionalMaxLength(2000)],
  });
  if (!valid) return apiValidationError(errors);

  const db = await scopedClient(auth);
  const { data: created, error } = await db
    .from("knowledge_bases")
    .insert({
      name: String(body.name).trim(),
      description: body.description ? String(body.description).trim() : null,
      created_by: auth.userId,
    })
    .select()
    .single();

  if (error) {
    log.error({ error }, "Failed to create knowledge base");
    return apiError("DB_ERROR", "Failed to create knowledge base", 500);
  }

  Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "knowledge_base.created",
      entityType: "knowledge_base",
      entityId: created.id,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "knowledge_base.created",
      entityType: "knowledge_base",
      entityId: created.id,
      requestId,
    }),
  ]);

  log.info({ kbId: created.id }, "Knowledge base created");
  return apiSuccess(created, 201);
}
