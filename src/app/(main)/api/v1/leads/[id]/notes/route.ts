import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest, requireLeadBranchAccess, isOwnBranchContact } from "@/lib/api/auth";
import { getLeadMembership } from "@/lib/leads/branch-membership";
import { isLeadCollaborator } from "@/lib/leads/collaborators";
import { shouldRestrictToSelf } from "@/lib/api/permissions";
import {
  apiSuccess,
  apiUnauthorized,
  apiNotFound,
  apiValidationError,
  apiServiceUnavailable,
} from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { createLeadNote } from "@/lib/leads/create-lead-note";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "GET",
    path: `/api/v1/leads/${id}/notes`,
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const supabase = await createServiceClient();

  // Verify lead exists, not soft-deleted, tenant scoped
  const { data: lead } = await supabase
    .from("leads")
    .select("id, assigned_to, branch_id, tags")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .single();

  if (!lead) return apiNotFound("Lead");

  // Counselor: own-only; branch-manager: membership-based.
  // Own-scope holders keep access as collaborators (mirrors getLead), so a
  // counsellor who handed the lead off can still read its notes.
  // Exception: walk-in "other" contacts are visible to any user in their branch.
  const membership = await getLeadMembership(supabase, auth.tenantId, id);
  if (
    shouldRestrictToSelf(auth.permissions) &&
    !isOwnBranchContact(auth, lead) &&
    !(membership.some((m) => m.assigned_to === auth.userId) || lead.assigned_to === auth.userId) &&
    !(await isLeadCollaborator(supabase, auth.tenantId, id, auth.userId))
  )
    return apiNotFound("Lead");
  if (!requireLeadBranchAccess(auth, lead, membership)) return apiNotFound("Lead");

  const { data, error } = await supabase
    .from("lead_notes")
    .select("*")
    .eq("lead_id", id)
    .order("created_at", { ascending: false });

  if (error) {
    log.error({ err: error }, "Failed to fetch notes");
    return apiServiceUnavailable("Failed to fetch notes");
  }

  return apiSuccess(data);
}

/**
 * POST /api/v1/leads/[id]/notes
 *
 * Create a note. Body: { content: string, mentioned_user_ids?: string[] }.
 * Each mentioned user that genuinely belongs to the lead's branch gets a
 * "note.mention" notification linking back to the lead. Server-side so the
 * notification helpers (service client) can run and mentions are validated
 * rather than trusting the client.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "POST",
    path: `/api/v1/leads/${id}/notes`,
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const body = await request.json().catch(() => null);
  const content = typeof body?.content === "string" ? body.content.trim() : "";
  const mentionedUserIds: string[] = Array.isArray(body?.mentioned_user_ids)
    ? body.mentioned_user_ids.filter((x: unknown): x is string => typeof x === "string")
    : [];

  const outcome = await createLeadNote(
    auth,
    id,
    { content, mentionedUserIds, createdVia: "human", aiToolCallId: null },
    { requestId },
  );

  switch (outcome.kind) {
    case "not_found":
      return apiNotFound("Lead");
    case "validation":
      return apiValidationError(outcome.errors);
    case "db_error":
      log.error({ err: outcome.error }, "Failed to create note");
      return apiServiceUnavailable("Failed to add note");
    case "ok":
      return apiSuccess(outcome.note, 201);
  }
}
