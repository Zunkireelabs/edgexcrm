import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
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
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

const VALID_AGENT_TYPES = ["agent", "super_agent"] as const;

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.APPLICATION_TRACKING)) return apiForbidden();

  const { searchParams } = new URL(request.url);
  const includeInactive = searchParams.get("all") === "true";

  const db = await scopedClient(auth);
  let query = db
    .from("agents")
    .select("id, name, agent_type, is_active")
    .order("name", { ascending: true });
  if (!includeInactive) query = query.eq("is_active", true);
  const { data, error } = await query;

  if (error) return apiError("DB_ERROR", "Failed to fetch agents", 500);
  return apiSuccess(data ?? []);
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: "/api/v1/agents" });

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

  const { valid, errors } = validate(body, {
    name: [required("name"), maxLength(255)],
  });
  if (!valid) return apiValidationError(errors);

  const agentType = body.agent_type ?? "agent";
  if (!VALID_AGENT_TYPES.includes(agentType as (typeof VALID_AGENT_TYPES)[number])) {
    return apiValidationError({ agent_type: ["agent_type must be 'agent' or 'super_agent'"] });
  }

  const db = await scopedClient(auth);
  const insert: Record<string, unknown> = {
    name: String(body.name).trim(),
    agent_type: agentType,
  };
  if (body.is_active !== undefined) insert.is_active = Boolean(body.is_active);

  const { data, error } = await db
    .from("agents")
    .insert(insert)
    .select("id, name, agent_type, is_active")
    .single();

  if (error) {
    if (error.code === "23505") {
      return apiValidationError({ name: ["An agent with this name already exists"] });
    }
    log.error({ error }, "Failed to create agent");
    return apiError("DB_ERROR", "Failed to create agent", 500);
  }

  log.info({ agentId: (data as { id: string }).id }, "Agent created");
  return apiSuccess(data, 201);
}
