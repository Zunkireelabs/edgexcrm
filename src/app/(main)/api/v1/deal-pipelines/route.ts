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
import { DEFAULT_DEAL_STAGES } from "@/lib/deals/stages";
import type { DealPipelineWithCounts } from "@/types/database";

export async function GET() {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "GET", path: "/api/v1/deal-pipelines" });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.DEALS)) return apiForbidden();

  log.info({ tenantId: auth.tenantId }, "Fetching deal pipelines");

  const db = await scopedClient(auth);

  const { data: pipelines, error } = await db
    .from("deal_pipelines")
    .select("*")
    .eq("is_active", true)
    .order("position", { ascending: true });

  if (error) {
    log.error({ error }, "Failed to fetch deal pipelines");
    return apiError("DB_ERROR", "Failed to fetch deal pipelines", 500);
  }

  const { data: stageCounts } = await db.from("deal_stages").select("pipeline_id");
  const { data: dealCounts } = await db
    .from("deals")
    .select("pipeline_id")
    .is("deleted_at", null);

  const stageCountMap = new Map<string, number>();
  const dealCountMap = new Map<string, number>();

  for (const s of stageCounts || []) {
    const pid = (s as unknown as { pipeline_id: string }).pipeline_id;
    if (pid) stageCountMap.set(pid, (stageCountMap.get(pid) || 0) + 1);
  }
  for (const d of dealCounts || []) {
    const pid = (d as unknown as { pipeline_id: string | null }).pipeline_id;
    if (pid) dealCountMap.set(pid, (dealCountMap.get(pid) || 0) + 1);
  }

  const result: DealPipelineWithCounts[] = (pipelines || []).map((p) => {
    const row = p as unknown as { id: string };
    return {
      ...(p as object),
      stage_count: stageCountMap.get(row.id) || 0,
      deal_count: dealCountMap.get(row.id) || 0,
    } as DealPipelineWithCounts;
  });

  log.info({ count: result.length }, "Deal pipelines fetched");
  return apiSuccess(result);
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: "/api/v1/deal-pipelines" });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.DEALS)) return apiForbidden();
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

  log.info({ tenantId: auth.tenantId, name, template }, "Creating deal pipeline");

  const db = await scopedClient(auth);

  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  const { data: existing } = await db
    .from("deal_pipelines")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();

  if (existing) {
    return apiValidationError({ name: ["A pipeline with this name already exists"] });
  }

  const { data: lastPipeline } = await db
    .from("deal_pipelines")
    .select("position")
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const lastRow = lastPipeline as unknown as { position: number } | null;
  const position = (lastRow?.position ?? -1) + 1;

  const { data: pipeline, error: pipelineError } = await db
    .from("deal_pipelines")
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
    log.error({ error: pipelineError }, "Failed to create deal pipeline");
    return apiError("DB_ERROR", "Failed to create deal pipeline", 500);
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
      .from("deal_stages")
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
    stagesToCreate = DEFAULT_DEAL_STAGES.map((s) => ({
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
  // template === "empty" → no stages

  if (stagesToCreate.length > 0) {
    const { error: stagesError } = await db.from("deal_stages").insert(stagesToCreate);
    if (stagesError) {
      log.error({ error: stagesError }, "Failed to create stages, rolling back pipeline");
      await db.from("deal_pipelines").delete().eq("id", pipelineId);
      return apiError("DB_ERROR", "Failed to create pipeline stages", 500);
    }
  }

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "deal_pipeline.created",
      entityType: "deal_pipeline",
      entityId: pipelineId,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "deal_pipeline.created",
      entityType: "deal_pipeline",
      entityId: pipelineId,
      requestId,
    }),
  ]);

  log.info({ pipelineId }, "Deal pipeline created");
  return apiSuccess(
    { ...pipeline, stage_count: stagesToCreate.length, deal_count: 0 },
    201
  );
}
