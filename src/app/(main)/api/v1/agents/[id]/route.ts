import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiError,
  apiValidationError,
} from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

const VALID_AGENT_TYPES = ["agent", "super_agent"] as const;

interface Props {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "PATCH", path: `/api/v1/agents/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.APPLICATION_TRACKING)) return apiForbidden();
  if (auth.role !== "owner" && auth.role !== "admin") return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const db = await scopedClient(auth);

  const { data: existing } = await db
    .from("agents")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return apiNotFound("Agent");

  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const trimmed = String(body.name ?? "").trim();
    if (!trimmed) return apiValidationError({ name: ["name is required"] });
    patch.name = trimmed;
  }
  if (body.agent_type !== undefined) {
    if (!VALID_AGENT_TYPES.includes(body.agent_type as (typeof VALID_AGENT_TYPES)[number])) {
      return apiValidationError({ agent_type: ["agent_type must be 'agent' or 'super_agent'"] });
    }
    patch.agent_type = body.agent_type;
  }
  if (body.is_active !== undefined) patch.is_active = Boolean(body.is_active);

  if (Object.keys(patch).length === 0) {
    const { data: unchanged } = await db.from("agents").select("id, name, agent_type, is_active").eq("id", id).maybeSingle();
    return apiSuccess(unchanged);
  }

  const { data, error } = await db
    .from("agents")
    .update(patch)
    .eq("id", id)
    .select("id, name, agent_type, is_active")
    .single();

  if (error) {
    if (error.code === "23505") {
      return apiValidationError({ name: ["An agent with this name already exists"] });
    }
    log.error({ error }, "Failed to update agent");
    return apiError("DB_ERROR", "Failed to update agent", 500);
  }

  log.info({ agentId: id }, "Agent updated");
  return apiSuccess(data);
}

export async function DELETE(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "DELETE", path: `/api/v1/agents/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.APPLICATION_TRACKING)) return apiForbidden();
  if (auth.role !== "owner" && auth.role !== "admin") return apiForbidden();

  const db = await scopedClient(auth);

  const { data: existing } = await db
    .from("agents")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return apiNotFound("Agent");

  const { error } = await db.from("agents").delete().eq("id", id);

  if (error) {
    log.error({ error }, "Failed to delete agent");
    return apiError("DB_ERROR", "Failed to delete agent", 500);
  }

  log.info({ agentId: id }, "Agent deleted");
  return apiSuccess({ id });
}
