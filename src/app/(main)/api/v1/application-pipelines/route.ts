import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import {
  apiSuccess,
  apiValidationError,
  apiUnauthorized,
  apiForbidden,
  apiError,
} from "@/lib/api/response";
import { validate, required, maxLength } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { createAuditLog, emitEvent } from "@/lib/api/audit";
import type { ApplicationPipelineWithCounts } from "@/types/database";

export async function GET() {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "GET", path: "/api/v1/application-pipelines" });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.APPLICATION_TRACKING)) return apiForbidden();

  log.info({ tenantId: auth.tenantId }, "Fetching application pipelines");

  const db = await scopedClient(auth);

  const { data: pipelines, error } = await db
    .from("application_pipelines")
    .select("*")
    .eq("is_active", true)
    .order("position", { ascending: true });

  if (error) {
    log.error({ error }, "Failed to fetch application pipelines");
    return apiError("DB_ERROR", "Failed to fetch application pipelines", 500);
  }

  const pipelineRows = (pipelines || []) as unknown as Array<{ id: string }>;

  const { data: stageCounts } = await db
    .from("application_stages")
    .select("pipeline_id")
    .in("pipeline_id", pipelineRows.map((p) => p.id));
  const { data: appCounts } = await db
    .from("applications")
    .select("pipeline_id")
    .is("deleted_at", null);

  const stageCountMap = new Map<string, number>();
  const appCountMap = new Map<string, number>();

  for (const s of stageCounts || []) {
    const pid = (s as unknown as { pipeline_id: string }).pipeline_id;
    if (pid) stageCountMap.set(pid, (stageCountMap.get(pid) || 0) + 1);
  }
  for (const a of appCounts || []) {
    const pid = (a as unknown as { pipeline_id: string | null }).pipeline_id;
    if (pid) appCountMap.set(pid, (appCountMap.get(pid) || 0) + 1);
  }

  const result: ApplicationPipelineWithCounts[] = (pipelines || []).map((p) => {
    const row = p as unknown as { id: string };
    return {
      ...(p as object),
      stage_count: stageCountMap.get(row.id) || 0,
      application_count: appCountMap.get(row.id) || 0,
    } as ApplicationPipelineWithCounts;
  });

  log.info({ count: result.length }, "Application pipelines fetched");
  return apiSuccess(result);
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: "/api/v1/application-pipelines" });

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
  });
  if (!valid) return apiValidationError(errors);

  const name = body.name as string;
  const template = (body.template as string) || "default";
  const copyFromId = body.copy_from_id as string | undefined;

  log.info({ tenantId: auth.tenantId, name, template }, "Creating application pipeline");

  const db = await scopedClient(auth);

  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  const { data: existing } = await db
    .from("application_pipelines")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();

  if (existing) {
    return apiValidationError({ name: ["A pipeline with this name already exists"] });
  }

  const { data: lastPipeline } = await db
    .from("application_pipelines")
    .select("position")
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const lastRow = lastPipeline as unknown as { position: number } | null;
  const position = (lastRow?.position ?? -1) + 1;

  const { data: pipeline, error: pipelineError } = await db
    .from("application_pipelines")
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

  if (pipelineError || !pipeline) {
    log.error({ error: pipelineError }, "Failed to create application pipeline");
    return apiError("DB_ERROR", "Failed to create application pipeline", 500);
  }

  const pipelineRow = pipeline as unknown as { id: string };
  const pipelineId = pipelineRow.id;

  type StageInsert = {
    tenant_id: string;
    pipeline_id: string;
    name: string;
    slug: string;
    position: number;
    color: string;
    is_default: boolean;
    is_terminal: boolean;
    terminal_type: string | null;
  };

  let stagesToCreate: StageInsert[] = [];

  if (template === "copy" && copyFromId) {
    const { data: sourceStages } = await db
      .from("application_stages")
      .select("*")
      .eq("pipeline_id", copyFromId)
      .order("position", { ascending: true });

    if (sourceStages && sourceStages.length > 0) {
      stagesToCreate = (sourceStages as unknown as Array<{
        name: string; slug: string; position: number; color: string;
        is_default: boolean; is_terminal: boolean; terminal_type: string | null;
      }>).map((s) => ({
        tenant_id: auth.tenantId,
        pipeline_id: pipelineId,
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
    const { data: tenantDefaultPipeline } = await db
      .from("application_pipelines")
      .select("id")
      .eq("is_default", true)
      .maybeSingle();

    const tenantDefaultPipelineRow = tenantDefaultPipeline as unknown as { id: string } | null;

    const { data: defaultStages } = tenantDefaultPipelineRow
      ? await db
          .from("application_stages")
          .select("*")
          .eq("tenant_id", auth.tenantId)
          .eq("pipeline_id", tenantDefaultPipelineRow.id)
          .order("position", { ascending: true })
      : { data: null };

    if (defaultStages && defaultStages.length > 0) {
      stagesToCreate = (defaultStages as unknown as Array<{
        name: string; slug: string; position: number; color: string;
        is_default: boolean; is_terminal: boolean; terminal_type: string | null;
      }>).map((s) => ({
        tenant_id: auth.tenantId,
        pipeline_id: pipelineId,
        name: s.name,
        slug: s.slug,
        position: s.position,
        color: s.color,
        is_default: s.is_default,
        is_terminal: s.is_terminal,
        terminal_type: s.terminal_type,
      }));
    }
  }

  if (stagesToCreate.length > 0) {
    const { error: stagesError } = await db.from("application_stages").insert(stagesToCreate);
    if (stagesError) {
      log.error({ error: stagesError }, "Failed to create stages, rolling back pipeline");
      await db.from("application_pipelines").delete().eq("id", pipelineId);
      return apiError("DB_ERROR", "Failed to create pipeline stages", 500);
    }
  }

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "application_pipeline.created",
      entityType: "application_pipeline",
      entityId: pipelineId,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "application_pipeline.created",
      entityType: "application_pipeline",
      entityId: pipelineId,
      requestId,
    }),
  ]);

  log.info({ pipelineId }, "Application pipeline created");
  return apiSuccess(
    { ...pipeline, stage_count: stagesToCreate.length, application_count: 0 },
    201
  );
}