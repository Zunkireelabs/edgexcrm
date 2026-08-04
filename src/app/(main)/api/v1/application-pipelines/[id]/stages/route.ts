import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import {
  apiSuccess,
  apiValidationError,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiError,
} from "@/lib/api/response";
import { validate, required, maxLength, isIn } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { id: pipelineId } = await context.params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "GET", path: `/api/v1/application-pipelines/${pipelineId}/stages` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.APPLICATION_TRACKING)) return apiForbidden();

  const db = await scopedClient(auth);

  const { data: pipeline } = await db
    .from("application_pipelines")
    .select("id")
    .eq("id", pipelineId)
    .maybeSingle();

  if (!pipeline) return apiNotFound("Application pipeline");

  const { data: stages, error } = await db
    .from("application_stages")
    .select("*")
    .eq("pipeline_id", pipelineId)
    .order("position", { ascending: true });

  if (error) {
    log.error({ error }, "Failed to fetch stages");
    return apiError("DB_ERROR", "Failed to fetch stages", 500);
  }

  log.info({ pipelineId, stageCount: stages?.length ?? 0 }, "Application stages fetched");
  return apiSuccess(stages ?? []);
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { id: pipelineId } = await context.params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: `/api/v1/application-pipelines/${pipelineId}/stages` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.APPLICATION_TRACKING)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ body: ["Invalid JSON body"] });
  }

  const { valid, errors } = validate(body, {
    name: [required("name"), maxLength(100)],
    color: [maxLength(7)],
    terminal_type: [isIn(["won", "lost"])],
  });
  if (!valid) return apiValidationError(errors);

  const db = await scopedClient(auth);

  const { data: pipeline } = await db
    .from("application_pipelines")
    .select("id")
    .eq("id", pipelineId)
    .maybeSingle();

  if (!pipeline) return apiNotFound("Application pipeline");

  const name = body.name as string;
  const color = (body.color as string) || "#6b7280";
  const isTerminal = body.is_terminal === true;
  const terminalType = isTerminal ? (body.terminal_type as string | null) : null;
  const isDefault = body.is_default === true;

  const baseSlug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  let slug = baseSlug;
  let suffix = 1;
  while (true) {
    const { data: existing } = await db
      .from("application_stages")
      .select("id")
      .eq("pipeline_id", pipelineId)
      .eq("slug", slug)
      .maybeSingle();
    if (!existing) break;
    slug = `${baseSlug}-${suffix++}`;
  }

  const { data: lastStage } = await db
    .from("application_stages")
    .select("position")
    .eq("pipeline_id", pipelineId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const lastRow = lastStage as unknown as { position: number } | null;
  const position = (lastRow?.position ?? -1) + 1;

  if (isDefault) {
    await db
      .from("application_stages")
      .update({ is_default: false })
      .eq("pipeline_id", pipelineId)
      .eq("is_default", true);
  }

  const { data: stage, error } = await db
    .from("application_stages")
    .insert({
      tenant_id: auth.tenantId,
      pipeline_id: pipelineId,
      name,
      slug,
      position,
      color,
      is_default: isDefault,
      is_terminal: isTerminal,
      terminal_type: terminalType,
    })
    .select()
    .single();

  if (error) {
    log.error({ error }, "Failed to create application stage");
    return apiError("DB_ERROR", "Failed to create stage", 500);
  }

  log.info({ stageId: (stage as unknown as { id: string }).id, pipelineId }, "Application stage created");
  return apiSuccess(stage, 201);
}