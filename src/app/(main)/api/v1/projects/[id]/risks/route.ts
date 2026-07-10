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
import { validate, required, maxLength, optionalMaxLength, isIn, isUUID } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { recordProjectEvent } from "@/lib/projects/events";

const RISK_LEVELS = ["low", "medium", "high"];

interface Props {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.PROJECT_BOARD)) return apiForbidden();

  const db = await scopedClient(auth);
  const { data: project } = await db.from("projects").select("id").eq("id", id).maybeSingle();
  if (!project) return apiNotFound("Project");

  const { data: risks, error } = await db
    .from("project_risks")
    .select("*")
    .eq("project_id", id)
    .order("opened_at", { ascending: false });

  if (error) return apiError("DB_ERROR", "Failed to fetch risks", 500);
  return apiSuccess(risks ?? []);
}

export async function POST(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: `/api/v1/projects/${id}/risks` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.PROJECT_BOARD)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const { valid, errors } = validate(body, {
    title: [required("title"), maxLength(255)],
    description: [optionalMaxLength(2000)],
    probability: [isIn(RISK_LEVELS)],
    impact: [isIn(RISK_LEVELS)],
    mitigation: [optionalMaxLength(2000)],
    owner_id: [isUUID()],
  });
  if (!valid) return apiValidationError(errors);

  const db = await scopedClient(auth);
  const { data: project } = await db.from("projects").select("id").eq("id", id).maybeSingle();
  if (!project) return apiNotFound("Project");

  if (body.owner_id) {
    const { data: member } = await db
      .from("tenant_users")
      .select("user_id")
      .eq("user_id", String(body.owner_id))
      .maybeSingle();
    if (!member) return apiValidationError({ owner_id: ["Not a member of this tenant"] });
  }

  const probability = body.probability ? String(body.probability) : "medium";
  const impact = body.impact ? String(body.impact) : "medium";

  const { data: created, error } = await db
    .from("project_risks")
    .insert({
      project_id: id,
      title: String(body.title).trim(),
      description: body.description ? String(body.description).trim() : null,
      probability,
      impact,
      mitigation: body.mitigation ? String(body.mitigation).trim() : null,
      owner_id: body.owner_id ?? null,
      review_date: body.review_date ?? null,
    })
    .select()
    .single();

  if (error) {
    log.error({ error }, "Failed to create risk");
    return apiError("DB_ERROR", "Failed to create risk", 500);
  }

  await recordProjectEvent(db, {
    projectId: id,
    eventType: "risk_raised",
    actorId: auth.userId,
    summary: `Risk raised: ${created.title}`,
    payload: { risk_id: created.id, probability, impact },
    subjectType: "risk",
    subjectId: created.id,
  });

  log.info({ riskId: created.id }, "Risk created");
  return apiSuccess(created, 201);
}
