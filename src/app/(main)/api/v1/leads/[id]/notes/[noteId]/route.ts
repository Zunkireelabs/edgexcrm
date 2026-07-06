import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest } from "@/lib/api/auth";
import { validate, required, maxLength } from "@/lib/api/validation";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiValidationError,
  apiServiceUnavailable,
} from "@/lib/api/response";
import { createAuditLog } from "@/lib/api/audit";
import { createRequestLogger } from "@/lib/logger";

const EDIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

/**
 * PATCH /api/v1/leads/[id]/notes/[noteId]
 *
 * Edit a note's content. Only the original author may edit, and only
 * within 15 minutes of creation. Sets edited_at on save.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; noteId: string }> }
) {
  const { id, noteId } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "PATCH",
    path: `/api/v1/leads/${id}/notes/${noteId}`,
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const supabase = await createServiceClient();

  // Verify lead belongs to tenant
  const { data: lead } = await supabase
    .from("leads")
    .select("id")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .single();
  if (!lead) return apiNotFound("Lead");

  const { data: note } = await supabase
    .from("lead_notes")
    .select("id, lead_id, user_id, content, created_at")
    .eq("id", noteId)
    .eq("lead_id", id)
    .maybeSingle();
  if (!note) return apiNotFound("Note");

  // Only the original author can edit their own note
  if (note.user_id !== auth.userId) return apiForbidden();

  // Only within 15 minutes of creation
  const ageMs = Date.now() - new Date(note.created_at).getTime();
  if (ageMs > EDIT_WINDOW_MS) {
    return apiForbidden();
  }

  const body = await request.json().catch(() => null);
  const { valid, errors } = validate(body ?? {}, {
    content: [required("Content"), maxLength(10000)],
  });
  if (!valid) return apiValidationError(errors);

  const content = (body.content as string).trim();
  if (!content) {
    return apiValidationError({ content: ["Note content is required"] });
  }

  const { data: updated, error } = await supabase
    .from("lead_notes")
    .update({ content, edited_at: new Date().toISOString() })
    .eq("id", noteId)
    .eq("lead_id", id)
    .select()
    .single();

  if (error || !updated) {
    log.error({ err: error }, "Failed to edit note");
    return apiServiceUnavailable("Failed to edit note");
  }

  await createAuditLog({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "lead.note_edited",
    entityType: "lead",
    entityId: id,
    changes: { note_id: { old: null, new: noteId } },
    requestId,
  });

  return apiSuccess(updated);
}
