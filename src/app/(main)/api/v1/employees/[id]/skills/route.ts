import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { canManageHR } from "@/lib/api/permissions";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiError,
  apiValidationError,
} from "@/lib/api/response";
import { validate, required, isUUID } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { createAuditLog, emitEvent } from "@/lib/api/audit";
import { getSelfTenantUserId, canReadEmployee, canWriteEmployee } from "@/lib/api/hr-scope";

interface Props {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const db = await scopedClient(auth);
  const hasManageHR = canManageHR(auth.permissions);
  const selfId = await getSelfTenantUserId(db, auth);

  const { data: memberRow } = await db.from("tenant_users").select("id").eq("id", id).maybeSingle();
  if (!memberRow) return apiNotFound("Employee");
  if (!(await canReadEmployee(db, selfId, hasManageHR, id))) return apiForbidden();

  const { data, error } = await db
    .from("employee_skills")
    .select("*, skills(id, name, category)")
    .eq("tenant_user_id", id);

  if (error) return apiError("DB_ERROR", "Failed to fetch employee skills", 500);
  return apiSuccess(data ?? []);
}

export async function POST(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: `/api/v1/employees/${id}/skills` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const db = await scopedClient(auth);
  const hasManageHR = canManageHR(auth.permissions);
  const selfId = await getSelfTenantUserId(db, auth);

  const { data: memberRow } = await db.from("tenant_users").select("id").eq("id", id).maybeSingle();
  if (!memberRow) return apiNotFound("Employee");
  if (!canWriteEmployee(selfId, hasManageHR, id)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const { valid, errors } = validate(body, {
    skill_id: [required("skill_id"), isUUID()],
  });
  if (!valid) return apiValidationError(errors);

  if (
    body.proficiency !== undefined &&
    body.proficiency !== null &&
    (typeof body.proficiency !== "number" || body.proficiency < 1 || body.proficiency > 5)
  ) {
    return apiValidationError({ proficiency: ["Must be a number between 1 and 5"] });
  }

  const { data: skillCheck } = await db.from("skills").select("id").eq("id", String(body.skill_id)).maybeSingle();
  if (!skillCheck) return apiNotFound("Skill");

  const { data: created, error } = await db
    .from("employee_skills")
    .insert({
      tenant_user_id: id,
      skill_id: String(body.skill_id),
      proficiency: body.proficiency ?? null,
      years: body.years ?? null,
    })
    .select("*, skills(id, name, category)")
    .single();

  if (error) {
    if (error.code === "23505") return apiError("CONFLICT", "This skill is already attached to the employee", 409);
    log.error({ error }, "Failed to attach skill");
    return apiError("DB_ERROR", "Failed to attach skill", 500);
  }

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "employee_skill.attached",
      entityType: "employee_profile",
      entityId: id,
      changes: { skill_id: { old: null, new: body.skill_id } },
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "employee_skill.attached",
      entityType: "employee_profile",
      entityId: id,
      requestId,
    }),
  ]);

  log.info({ tenantUserId: id, skillId: body.skill_id }, "Skill attached to employee");
  return apiSuccess(created, 201);
}

export async function DELETE(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "DELETE", path: `/api/v1/employees/${id}/skills` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const db = await scopedClient(auth);
  const hasManageHR = canManageHR(auth.permissions);
  const selfId = await getSelfTenantUserId(db, auth);

  const { data: memberRow } = await db.from("tenant_users").select("id").eq("id", id).maybeSingle();
  if (!memberRow) return apiNotFound("Employee");
  if (!canWriteEmployee(selfId, hasManageHR, id)) return apiForbidden();

  const skillId = new URL(request.url).searchParams.get("skill_id");
  if (!skillId) return apiValidationError({ skill_id: ["skill_id query param is required"] });

  const { data: existing } = await db
    .from("employee_skills")
    .select("id")
    .eq("tenant_user_id", id)
    .eq("skill_id", skillId)
    .maybeSingle();
  if (!existing) return apiNotFound("Employee skill");

  const { error } = await db.from("employee_skills").delete().eq("tenant_user_id", id).eq("skill_id", skillId);
  if (error) {
    log.error({ error }, "Failed to detach skill");
    return apiError("DB_ERROR", "Failed to detach skill", 500);
  }

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "employee_skill.detached",
      entityType: "employee_profile",
      entityId: id,
      changes: { skill_id: { old: skillId, new: null } },
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "employee_skill.detached",
      entityType: "employee_profile",
      entityId: id,
      requestId,
    }),
  ]);

  log.info({ tenantUserId: id, skillId }, "Skill detached from employee");
  return apiSuccess({ tenant_user_id: id, skill_id: skillId });
}
