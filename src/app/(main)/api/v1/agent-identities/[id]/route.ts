import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
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

const VALID_STATUSES = ["active", "paused"] as const;

interface Props {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "PATCH", path: `/api/v1/agent-identities/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  if (!VALID_STATUSES.includes(body.status as (typeof VALID_STATUSES)[number])) {
    return apiValidationError({ status: ["status must be 'active' or 'paused'"] });
  }

  const db = await scopedClient(auth);

  const { data: existing } = await db.from("agent_identities").select("id").eq("id", id).maybeSingle();
  if (!existing) return apiNotFound("Agent");

  const { data, error } = await db
    .from("agent_identities")
    .update({ status: body.status })
    .eq("id", id)
    .select("id, agent_key, display_name, position_id, status, created_at")
    .single();

  if (error) {
    log.error({ error }, "Failed to update agent identity");
    return apiError("DB_ERROR", "Failed to update agent identity", 500);
  }

  log.info({ agentIdentityId: id, status: body.status }, "Agent identity updated");
  return apiSuccess(data);
}
