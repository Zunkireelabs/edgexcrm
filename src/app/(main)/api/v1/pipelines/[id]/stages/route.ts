import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import {
  apiSuccess,
  apiValidationError,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiServiceUnavailable,
} from "@/lib/api/response";
import { validate, required, maxLength, isIn } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/v1/pipelines/:id/stages - Add a new stage to pipeline
export async function POST(request: NextRequest, context: RouteContext) {
  const { id: pipelineId } = await context.params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "POST",
    path: `/api/v1/pipelines/${pipelineId}/stages`,
  });

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
    name: [required("name"), maxLength(100)],
    color: [maxLength(7)],
    terminal_type: [isIn(["won", "lost"])],
  });
  if (!valid) return apiValidationError(errors);

  const name = body.name as string;
  const color = (body.color as string) || "#6b7280";
  const isTerminal = body.is_terminal === true;
  const terminalType = isTerminal ? (body.terminal_type as string | null) : null;
  const isDefault = body.is_default === true;

  log.info({ tenantId: auth.tenantId, pipelineId, name }, "Adding stage to pipeline");

  const supabase = await createServiceClient();

  // Check pipeline exists and belongs to tenant
  const { data: pipeline } = await supabase
    .from("pipelines")
    .select("id")
    .eq("id", pipelineId)
    .eq("tenant_id", auth.tenantId)
    .single();

  if (!pipeline) {
    return apiNotFound("Pipeline");
  }

  // Generate slug from name
  const baseSlug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  // Check for duplicate slug in this pipeline and generate unique one if needed
  let slug = baseSlug;
  let suffix = 1;
  while (true) {
    const { data: existing } = await supabase
      .from("pipeline_stages")
      .select("id")
      .eq("pipeline_id", pipelineId)
      .eq("slug", slug)
      .single();

    if (!existing) break;
    slug = `${baseSlug}-${suffix++}`;
  }

  // Get the next position
  const { data: lastStage } = await supabase
    .from("pipeline_stages")
    .select("position")
    .eq("pipeline_id", pipelineId)
    .order("position", { ascending: false })
    .limit(1)
    .single();

  const position = (lastStage?.position ?? -1) + 1;

  // If this is set as default, unset other defaults
  if (isDefault) {
    await supabase
      .from("pipeline_stages")
      .update({ is_default: false })
      .eq("pipeline_id", pipelineId)
      .eq("is_default", true);
  }

  // Create the stage
  const { data: stage, error: stageError } = await supabase
    .from("pipeline_stages")
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

  if (stageError) {
    log.error({ err: stageError }, "Failed to create stage");
    return apiServiceUnavailable("Failed to create stage");
  }

  log.info({ stageId: stage.id, pipelineId }, "Stage created");
  return apiSuccess({ ...stage, lead_count: 0 }, 201);
}
