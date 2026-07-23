import { NextRequest } from "next/server";
import { z } from "zod";
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

const DECISIONS = ["accept", "dismiss"] as const;

// Mirrors the AI SDK tool input schemas in draft-tools.ts — kept as a separate
// literal here rather than imported so this route's validation doesn't couple
// to the model-facing tool definitions.
const EDITED_PAYLOAD_SCHEMAS: Record<string, z.ZodTypeAny> = {
  score_suggestion: z.object({
    score: z.number().int().min(0).max(100),
    reasoning: z.string().trim().min(1).max(2000),
  }),
  task_suggestion: z.object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000).optional(),
    dueDate: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
      .optional(),
  }),
  draft_email: z.object({
    subject: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(5000),
  }),
};

interface Props {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "PATCH", path: `/api/v1/agent-outputs/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  if (!DECISIONS.includes(body.decision as (typeof DECISIONS)[number])) {
    return apiValidationError({ decision: ["decision must be 'accept' or 'dismiss'"] });
  }

  const db = await scopedClient(auth);

  const { data: existingRaw } = await db.from("agent_outputs").select("id, kind, status").eq("id", id).maybeSingle();
  const existing = existingRaw as unknown as { id: string; kind: string; status: string } | null;
  if (!existing) return apiNotFound("Agent output");

  if (existing.status !== "proposed") {
    return apiValidationError({ decision: ["This output has already been reviewed"] });
  }

  let editedPayload: Record<string, unknown> | undefined;
  if (body.editedPayload !== undefined) {
    if (body.decision !== "accept") {
      return apiValidationError({ editedPayload: ["editedPayload is only valid alongside decision 'accept'"] });
    }
    const schema = EDITED_PAYLOAD_SCHEMAS[existing.kind as string];
    if (!schema) {
      return apiValidationError({ editedPayload: [`Output kind '${existing.kind}' has no editor`] });
    }
    const parsed = schema.safeParse(body.editedPayload);
    if (!parsed.success) {
      return apiValidationError({ editedPayload: parsed.error.issues.map((i) => i.message) });
    }
    editedPayload = parsed.data as Record<string, unknown>;
  }

  const nextStatus = body.decision === "dismiss" ? "dismissed" : editedPayload ? "edited_accepted" : "accepted";

  const update: Record<string, unknown> = {
    status: nextStatus,
    reviewed_by: auth.userId,
    reviewed_at: new Date().toISOString(),
  };
  if (editedPayload) update.payload = editedPayload;

  const { data, error } = await db
    .from("agent_outputs")
    .update(update)
    .eq("id", id)
    .select("id, kind, subject_type, subject_id, payload, status, reviewed_by, reviewed_at, created_at")
    .single();

  if (error) {
    log.error({ error }, "Failed to update agent output");
    return apiError("DB_ERROR", "Failed to update agent output", 500);
  }

  log.info({ agentOutputId: id, status: nextStatus }, "Agent output reviewed");
  return apiSuccess(data);
}
