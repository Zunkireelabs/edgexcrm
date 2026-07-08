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

const ISSUE_KINDS = ["query", "issue", "blocker"];
const ISSUE_SEVERITIES = ["low", "medium", "high"];
const ISSUE_SOURCES = ["internal", "client"];

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

  const { data: issues, error } = await db
    .from("project_issues")
    .select("*")
    .eq("project_id", id)
    .order("opened_at", { ascending: false });

  if (error) return apiError("DB_ERROR", "Failed to fetch issues", 500);
  return apiSuccess(issues ?? []);
}

export async function POST(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: `/api/v1/projects/${id}/issues` });

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
    kind: [isIn(ISSUE_KINDS)],
    severity: [isIn(ISSUE_SEVERITIES)],
    source: [isIn(ISSUE_SOURCES)],
    raised_by_label: [optionalMaxLength(255)],
    raised_by_contact_id: [isUUID()],
    assigned_to: [isUUID()],
  });
  if (!valid) return apiValidationError(errors);

  const db = await scopedClient(auth);
  const { data: project } = await db.from("projects").select("id").eq("id", id).maybeSingle();
  if (!project) return apiNotFound("Project");

  if (body.raised_by_contact_id) {
    const { data: contact } = await db
      .from("contacts")
      .select("id")
      .eq("id", String(body.raised_by_contact_id))
      .maybeSingle();
    if (!contact) return apiValidationError({ raised_by_contact_id: ["Not a contact in this tenant"] });
  }

  if (body.assigned_to) {
    const { data: member } = await db
      .from("tenant_users")
      .select("user_id")
      .eq("user_id", String(body.assigned_to))
      .maybeSingle();
    if (!member) return apiValidationError({ assigned_to: ["Not a member of this tenant"] });
  }

  const kind = body.kind ? String(body.kind) : "query";
  const severity = body.severity ? String(body.severity) : "medium";

  const { data: created, error } = await db
    .from("project_issues")
    .insert({
      project_id: id,
      title: String(body.title).trim(),
      description: body.description ? String(body.description).trim() : null,
      kind,
      severity,
      source: body.source ? String(body.source) : "internal",
      raised_by_label: body.raised_by_label ? String(body.raised_by_label).trim() : null,
      raised_by_contact_id: body.raised_by_contact_id ?? null,
      assigned_to: body.assigned_to ?? null,
    })
    .select()
    .single();

  if (error) {
    log.error({ error }, "Failed to create issue");
    return apiError("DB_ERROR", "Failed to create issue", 500);
  }

  await recordProjectEvent(db, {
    projectId: id,
    eventType: "issue_raised",
    actorId: auth.userId,
    summary: `${kind[0].toUpperCase()}${kind.slice(1)} raised: ${created.title}`,
    payload: { issue_id: created.id, kind, severity },
    subjectType: "issue",
    subjectId: created.id,
  });

  log.info({ issueId: created.id }, "Issue created");
  return apiSuccess(created, 201);
}
