import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiError,
  apiValidationError,
} from "@/lib/api/response";
import { validate, required } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getAgentDefinitionsForIndustry } from "@/lib/ai/agents/registry";

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: "/api/v1/agent-identities" });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const { valid, errors } = validate(body, {
    agentKey: [required("agentKey")],
    positionId: [required("positionId")],
  });
  if (!valid) return apiValidationError(errors);

  // Never trust the client's agentKey — it must be a real registry def
  // available to this tenant's own industry (universal or industry-matched).
  const def = getAgentDefinitionsForIndustry(auth.industryId).find((d) => d.key === body.agentKey);
  if (!def) {
    return apiValidationError({ agentKey: ["Unknown agent for this tenant's industry"] });
  }

  const db = await scopedClient(auth);

  const { data: position } = await db
    .from("positions")
    .select("id")
    .eq("id", body.positionId as string)
    .maybeSingle();
  if (!position) return apiValidationError({ positionId: ["Position not found in this tenant"] });

  const displayName =
    typeof body.displayName === "string" && body.displayName.trim() ? body.displayName.trim() : def.name;

  const { data, error } = await db
    .from("agent_identities")
    .insert({
      agent_key: def.key,
      display_name: displayName,
      position_id: body.positionId,
      status: "active",
    })
    .select("id, agent_key, display_name, position_id, status, created_at")
    .single();

  if (error) {
    if ((error as { code?: string }).code === "23505") {
      return apiValidationError({ agentKey: ["This agent is already hired for this tenant"] });
    }
    log.error({ error }, "Failed to hire agent");
    return apiError("DB_ERROR", "Failed to hire agent", 500);
  }

  log.info({ agentIdentityId: (data as { id: string }).id }, "Agent hired");
  return apiSuccess(data, 201);
}
