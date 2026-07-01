import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest, requireLeadAccess } from "@/lib/api/auth";
import { getLeadMembership } from "@/lib/leads/branch-membership";
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

/**
 * PATCH /api/v1/leads/[id]/notes/[noteId]
 *
 * Edit a note's content. Allowed for owner/admin, a branch-manager whose
 * branch contains the lead, the lead's own-scope assignee (requireLeadAccess
 * covers all three), or the note's original author editing their own note.
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

  const { data: lead } = await supabase
    .from("leads")
    .select("id, assigned_to, branch_id")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .single();
  if (!lead) return apiNotFound("Lead");

  const { data: note } = await supabase
    .from("lead_notes")
    .select("id, lead_id, user_id, content")
    .eq("id", noteId)
    .eq("lead_id", id)
    .maybeSingle();
  if (!note) return apiNotFound("Note");

  const membership = await getLeadMembership(supabase, auth.tenantId, id);
  const isAuthor = note.user_id === auth.userId;
  if (!requireLeadAccess(auth, lead, membership) && !isAuthor) {
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
    .update({ content })
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
