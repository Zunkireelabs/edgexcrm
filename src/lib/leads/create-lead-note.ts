import { createServiceClient } from "@/lib/supabase/server";
import { requireLeadBranchAccess, isOwnBranchContact, type AuthContext } from "@/lib/api/auth";
import { getLeadMembership } from "@/lib/leads/branch-membership";
import { isLeadCollaborator } from "@/lib/leads/collaborators";
import { shouldRestrictToSelf } from "@/lib/api/permissions";
import { createNotificationsExcept, NotificationTypes } from "@/lib/notifications";
import { createAuditLog } from "@/lib/api/audit";
import { createRequestLogger } from "@/lib/logger";

export interface CreateLeadNoteInput {
  content: string;
  /** Never populated by AI tools — mentions notify other humans and the model has no business inventing that list. */
  mentionedUserIds?: string[];
  createdVia?: "human" | "ai_assistant";
  aiToolCallId?: string | null;
}

export interface CreateLeadNoteOpts {
  requestId: string;
}

export type CreateLeadNoteOutcome =
  | { kind: "not_found" }
  | { kind: "validation"; errors: Record<string, string[]> }
  | { kind: "db_error"; error: unknown }
  | { kind: "ok"; note: Record<string, unknown> };

/**
 * The core of `POST /api/v1/leads/[id]/notes` (previously inline in the
 * route), extracted so the create_lead_note AI write tool (Phase 4C) can call
 * the exact same governance/side-effect pipeline instead of reimplementing
 * it. Kept behavior-identical to the pre-extraction route — see
 * route.test.ts for the REST-parity gate.
 *
 * Deliberately still uses createServiceClient() + manual .eq("tenant_id", ...)
 * filters (not scopedClient) — same sanctioned-legacy reasoning as
 * apply-lead-patch.ts, see BRIEF-PHASE-4C-NOTE-AND-KB-WRITES.md §2.
 */
export async function createLeadNote(
  auth: AuthContext,
  leadId: string,
  input: CreateLeadNoteInput,
  opts: CreateLeadNoteOpts,
): Promise<CreateLeadNoteOutcome> {
  const { requestId } = opts;
  const createdVia = input.createdVia ?? "human";
  const aiToolCallId = input.aiToolCallId ?? null;
  const mentionedUserIds = input.mentionedUserIds ?? [];

  const log = createRequestLogger({
    requestId,
    method: "POST",
    path: `/api/v1/leads/${leadId}/notes`,
  });

  const supabase = await createServiceClient();

  const { data: lead } = await supabase
    .from("leads")
    .select("id, first_name, last_name, assigned_to, branch_id, tags")
    .eq("id", leadId)
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .single();

  if (!lead) return { kind: "not_found" };

  // Exception: walk-in "other" contacts are writable by any user in their branch.
  const membership = await getLeadMembership(supabase, auth.tenantId, leadId);
  if (
    shouldRestrictToSelf(auth.permissions) &&
    !isOwnBranchContact(auth, lead) &&
    !(membership.some((m) => m.assigned_to === auth.userId) || lead.assigned_to === auth.userId) &&
    !(await isLeadCollaborator(supabase, auth.tenantId, leadId, auth.userId))
  )
    return { kind: "not_found" };
  if (!requireLeadBranchAccess(auth, lead, membership)) return { kind: "not_found" };

  const content = input.content.trim();
  if (!content) {
    return { kind: "validation", errors: { content: ["Note content is required"] } };
  }

  const { data: note, error } = await supabase
    .from("lead_notes")
    .insert({
      lead_id: leadId,
      user_id: auth.userId,
      user_email: auth.email,
      content,
      created_via: createdVia,
      ai_tool_call_id: aiToolCallId,
    })
    .select()
    .single();

  if (error || !note) {
    log.error({ err: error }, "Failed to create note");
    return { kind: "db_error", error };
  }

  // Record the note in the lead's System Activity timeline (audit_logs).
  await createAuditLog({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "lead.note_added",
    entityType: "lead",
    entityId: leadId,
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
          link: `/leads/${leadId}`,
        }))
      );
    }
  }

  return { kind: "ok", note };
}
