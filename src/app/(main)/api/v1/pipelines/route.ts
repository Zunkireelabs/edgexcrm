import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import {
  apiSuccess,
  apiValidationError,
  apiUnauthorized,
  apiForbidden,
  apiServiceUnavailable,
} from "@/lib/api/response";
import { validate, required, maxLength } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import type { PipelineWithCounts } from "@/types/database";

// GET /api/v1/pipelines - List all pipelines for tenant
export async function GET() {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "GET",
    path: "/api/v1/pipelines",
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  log.info({ tenantId: auth.tenantId }, "Fetching pipelines");

  const supabase = await createServiceClient();

  // Fetch pipelines with stage and lead counts
  const { data: pipelines, error } = await supabase
    .from("pipelines")
    .select("*")
    .eq("tenant_id", auth.tenantId)
    .eq("is_active", true)
    .order("position", { ascending: true });

  if (error) {
    log.error({ err: error }, "Failed to fetch pipelines");
    return apiServiceUnavailable("Failed to fetch pipelines");
  }

  // Get stage counts per pipeline
  const { data: stageCounts } = await supabase
    .from("pipeline_stages")
    .select("pipeline_id")
    .eq("tenant_id", auth.tenantId);

  // Get lead counts per pipeline
  const { data: leadCounts } = await supabase
    .from("leads")
    .select("pipeline_id")
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null);

  // Aggregate counts
  const stageCountMap = new Map<string, number>();
  const leadCountMap = new Map<string, number>();

  for (const s of stageCounts || []) {
    stageCountMap.set(s.pipeline_id, (stageCountMap.get(s.pipeline_id) || 0) + 1);
  }

  for (const l of leadCounts || []) {
    if (l.pipeline_id) {
      leadCountMap.set(l.pipeline_id, (leadCountMap.get(l.pipeline_id) || 0) + 1);
    }
  }

  const result: PipelineWithCounts[] = (pipelines || []).map((p) => ({
    ...p,
    stage_count: stageCountMap.get(p.id) || 0,
    lead_count: leadCountMap.get(p.id) || 0,
  }));

  log.info({ count: result.length }, "Pipelines fetched");
  return apiSuccess(result);
}

// POST /api/v1/pipelines - Create a new pipeline
export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "POST",
    path: "/api/v1/pipelines",
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
  });
  if (!valid) return apiValidationError(errors);

  const name = body.name as string;
  const template = (body.template as string) || "default";
  const copyFromId = body.copy_from_id as string | undefined;

  log.info({ tenantId: auth.tenantId, name, template }, "Creating pipeline");

  const supabase = await createServiceClient();

  // Generate slug from name
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  // Check for duplicate slug
  const { data: existing } = await supabase
    .from("pipelines")
    .select("id")
    .eq("tenant_id", auth.tenantId)
    .eq("slug", slug)
    .single();

  if (existing) {
    return apiValidationError({ name: ["A pipeline with this name already exists"] });
  }

  // Get the next position
  const { data: lastPipeline } = await supabase
    .from("pipelines")
    .select("position")
    .eq("tenant_id", auth.tenantId)
    .order("position", { ascending: false })
    .limit(1)
    .single();

  const position = (lastPipeline?.position ?? -1) + 1;

  // Create the pipeline
  const { data: pipeline, error: pipelineError } = await supabase
    .from("pipelines")
    .insert({
      tenant_id: auth.tenantId,
      name,
      slug,
      position,
      is_default: false,
      is_active: true,
    })
    .select()
    .single();

  if (pipelineError) {
    log.error({ err: pipelineError }, "Failed to create pipeline");
    return apiServiceUnavailable("Failed to create pipeline");
  }

  // Create stages based on template
  let stagesToCreate: Array<{
    tenant_id: string;
    pipeline_id: string;
    name: string;
    slug: string;
    position: number;
    color: string;
    is_default: boolean;
    is_terminal: boolean;
    terminal_type: string | null;
  }> = [];

  if (template === "copy" && copyFromId) {
    // Copy stages from another pipeline
    const { data: sourceStages } = await supabase
      .from("pipeline_stages")
      .select("*")
      .eq("pipeline_id", copyFromId)
      .eq("tenant_id", auth.tenantId)
      .order("position", { ascending: true });

    if (sourceStages && sourceStages.length > 0) {
      stagesToCreate = sourceStages.map((s) => ({
        tenant_id: auth.tenantId,
        pipeline_id: pipeline.id,
        name: s.name,
        slug: s.slug,
        position: s.position,
        color: s.color,
        is_default: s.is_default,
        is_terminal: s.is_terminal,
        terminal_type: s.terminal_type,
      }));
    }
  } else if (template === "default" || (template === "copy" && !copyFromId)) {
    // Create default stages
    stagesToCreate = [
      {
        tenant_id: auth.tenantId,
        pipeline_id: pipeline.id,
        name: "New",
        slug: "new",
        position: 0,
        color: "#3b82f6",
        is_default: true,
        is_terminal: false,
        terminal_type: null,
      },
      {
        tenant_id: auth.tenantId,
        pipeline_id: pipeline.id,
        name: "Contacted",
        slug: "contacted",
        position: 1,
        color: "#a855f7",
        is_default: false,
        is_terminal: false,
        terminal_type: null,
      },
      {
        tenant_id: auth.tenantId,
        pipeline_id: pipeline.id,
        name: "Won",
        slug: "won",
        position: 2,
        color: "#22c55e",
        is_default: false,
        is_terminal: true,
        terminal_type: "won",
      },
      {
        tenant_id: auth.tenantId,
        pipeline_id: pipeline.id,
        name: "Lost",
        slug: "lost",
        position: 3,
        color: "#ef4444",
        is_default: false,
        is_terminal: true,
        terminal_type: "lost",
      },
    ];
  }
  // template === "empty" means no stages

  if (stagesToCreate.length > 0) {
    const { error: stagesError } = await supabase
      .from("pipeline_stages")
      .insert(stagesToCreate);

    if (stagesError) {
      log.error({ err: stagesError }, "Failed to create stages");
      // Rollback pipeline creation
      await supabase.from("pipelines").delete().eq("id", pipeline.id);
      return apiServiceUnavailable("Failed to create pipeline stages");
    }
  }

  log.info({ pipelineId: pipeline.id }, "Pipeline created");

  return apiSuccess({
    ...pipeline,
    stage_count: stagesToCreate.length,
    lead_count: 0,
  }, 201);
}
