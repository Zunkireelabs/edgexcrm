import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest, requireLeadBranchAccess } from "@/lib/api/auth";
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
import {
  createNotificationsExcept,
  NotificationTypes,
} from "@/lib/notifications";
import { createAuditLog } from "@/lib/api/audit";
import { createRequestLogger } from "@/lib/logger";

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
    .select("id, assigned_to, branch_id")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .single();

  if (!lead) return apiNotFound("Lead");

  // Counselor: own-only; branch-manager: membership-based.
  // Own-scope holders keep access as collaborators (mirrors getLead), so a
  // counsellor who handed the lead off can still read its notes.
  const membership = await getLeadMembership(supabase, auth.tenantId, id);
  if (
    shouldRestrictToSelf(auth.permissions) &&
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

  const supabase = await createServiceClient();

  const { data: lead } = await supabase
    .from("leads")
    .select("id, first_name, last_name, assigned_to, branch_id")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .single();

  if (!lead) return apiNotFound("Lead");

  const membership = await getLeadMembership(supabase, auth.tenantId, id);
  if (
    shouldRestrictToSelf(auth.permissions) &&
    !(membership.some((m) => m.assigned_to === auth.userId) || lead.assigned_to === auth.userId) &&
    !(await isLeadCollaborator(supabase, auth.tenantId, id, auth.userId))
  )
    return apiNotFound("Lead");
  if (!requireLeadBranchAccess(auth, lead, membership)) return apiNotFound("Lead");

  const body = await request.json().catch(() => null);
  const content = typeof body?.content === "string" ? body.content.trim() : "";
  const mentionedUserIds: string[] = Array.isArray(body?.mentioned_user_ids)
    ? body.mentioned_user_ids.filter((x: unknown): x is string => typeof x === "string")
    : [];

  if (!content) {
    return apiValidationError({ content: ["Note content is required"] });
  }

  const { data: note, error } = await supabase
    .from("lead_notes")
    .insert({
      lead_id: id,
      user_id: auth.userId,
      user_email: auth.email,
      content,
    })
    .select()
    .single();

  if (error || !note) {
    log.error({ err: error }, "Failed to create note");
    return apiServiceUnavailable("Failed to add note");
  }

  // Record the note in the lead's System Activity timeline (audit_logs).
  await createAuditLog({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "lead.note_added",
    entityType: "lead",
    entityId: id,
    changes: { note_id: { old: null, new: note.id } },
    requestId,
  });

  // Notify mentioned users — but only those that genuinely belong to the
  // lead's branch/tenant (don't trust the client's id list blindly).
  if (mentionedUserIds.length > 0) {
    let memberQuery = supabase
      .from("tenant_users")
      .select("user_id")
      .eq("tenant_id", auth.tenantId)
      .in("user_id", mentionedUserIds);
    if (lead.branch_id) memberQuery = memberQuery.eq("branch_id", lead.branch_id);

    const { data: validRows } = await memberQuery;
    const validIds = new Set(
      ((validRows ?? []) as unknown as { user_id: string }[]).map((r) => r.user_id)
    );
    const toNotify = mentionedUserIds.filter((uid) => validIds.has(uid));

    if (toNotify.length > 0) {
      // Resolve the author's display name for the message.
      const { data: authorData } = await supabase.auth.admin.getUserById(auth.userId);
      const meta = authorData?.user?.user_metadata as Record<string, unknown> | undefined;
      const authorName =
        (meta?.name as string) || (meta?.full_name as string) || auth.email || "Someone";
      const leadName =
        [lead.first_name, lead.last_name].filter(Boolean).join(" ") || "a lead";

      await createNotificationsExcept(
        auth.userId,
        toNotify.map((uid) => ({
          tenantId: auth.tenantId,
          userId: uid,
          type: NotificationTypes.NOTE_MENTION,
          title: "You were mentioned in a note",
          message: `${authorName} mentioned you in a note on ${leadName}`,
          link: `/leads/${id}`,
        }))
      );
    }
  }

  return apiSuccess(note, 201);
}
