import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
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
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { createAuditLog, emitEvent } from "@/lib/api/audit";

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.TIME_TRACKING)) return apiForbidden();

  const db = await scopedClient(auth);
  const { searchParams } = new URL(request.url);
  const isActiveParam = searchParams.get("is_active");

  let query = db.from("accounts").select("*");
  if (isActiveParam !== null) {
    query = query.eq("is_active", isActiveParam === "true");
  }
  const { data: accounts, error } = await query.order("name", { ascending: true });
  if (error) return apiError("DB_ERROR", "Failed to fetch accounts", 500);

  const accountList = ((accounts ?? []) as unknown) as Array<{ id: string } & Record<string, unknown>>;

  // Batch-fetch project counts in one query
  const countMap: Record<string, number> = {};
  if (accountList.length > 0) {
    const accountIds = accountList.map((a) => a.id);
    const { data: projects } = await db
      .raw()
      .from("projects")
      .select("account_id")
      .eq("tenant_id", auth.tenantId)
      .in("account_id", accountIds);
    for (const p of projects ?? []) {
      countMap[p.account_id] = (countMap[p.account_id] ?? 0) + 1;
    }
  }

  const result = accountList.map((a) => ({ ...a, project_count: countMap[a.id] ?? 0 }));
  return apiSuccess(result);
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: "/api/v1/accounts" });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.TIME_TRACKING)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const { valid, errors } = validate(body, {
    name: [required("name"), maxLength(255)],
    primary_contact_email: [optionalMaxLength(255)],
    notes: [optionalMaxLength(2000)],
  });
  if (!valid) return apiValidationError(errors);

  const db = await scopedClient(auth);
  const { data: created, error } = await db
    .from("accounts")
    .insert({
      name: String(body.name).trim(),
      primary_contact_email: body.primary_contact_email
        ? String(body.primary_contact_email).trim()
        : null,
      notes: body.notes ? String(body.notes).trim() : null,
      is_active: body.is_active !== false,
    })
    .select()
    .single();

  if (error) {
    log.error({ error }, "Failed to create account");
    return apiError("DB_ERROR", "Failed to create account", 500);
  }

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "account.created",
      entityType: "account",
      entityId: created.id,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "account.created",
      entityType: "account",
      entityId: created.id,
      requestId,
    }),
  ]);

  log.info({ accountId: created.id }, "Account created");
  return apiSuccess(created, 201);
}
