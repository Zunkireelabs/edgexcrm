import type { SupabaseClient } from "@supabase/supabase-js";
import { getTenantAdminRecipients } from "@/lib/notifications";
import { listInboxMemberIds, ownerOf, requiresClaim } from "@/lib/inbox/claim";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any>;

export interface InboundRecipientInput {
  tenantId: string;
  provider: string;
  assigneeType: string | null;
  assignedToUserId: string | null;
  leadId: string | null;
}

/**
 * Who gets the bell when a visitor/customer message arrives, and what it says.
 *
 * Website chat (needs accepting):
 *   - nobody owns it yet: EVERYONE who can open the Inbox is told ("waiting to accept"), so the first free person takes it;
 *   - someone owns it: ONLY the owner is told. The lead's counsellor and everyone else are left alone, so a chat has one voice.
 * Every other channel: unchanged. The assigned human, plus the lead's counsellor.
 * If that leaves nobody, the tenant's owners and admins are told.
 */
export async function resolveInboundRecipients(
  db: Db,
  input: InboundRecipientInput,
): Promise<{ userIds: string[]; title: string }> {
  const recipients = new Set<string>();
  let title = "New message";

  if (requiresClaim(input.provider)) {
    const owner = ownerOf({ assignee_type: input.assigneeType, assigned_to_user_id: input.assignedToUserId });
    if (owner) {
      recipients.add(owner);
    } else {
      title = "New website chat · waiting to accept";
      (await listInboxMemberIds(db, input.tenantId)).forEach((id) => recipients.add(id));
    }
  } else {
    if (input.assigneeType === "human" && input.assignedToUserId) recipients.add(input.assignedToUserId);

    if (input.leadId) {
      const { data: leadRow } = await db
        .from("leads")
        .select("assigned_to")
        .eq("id", input.leadId)
        .eq("tenant_id", input.tenantId)
        .maybeSingle();
      const assignedTo = (leadRow as { assigned_to?: string | null } | null)?.assigned_to;
      if (assignedTo) recipients.add(assignedTo);
    }
  }

  if (recipients.size === 0) {
    (await getTenantAdminRecipients(db, input.tenantId)).forEach((id) => recipients.add(id));
  }

  return { userIds: [...recipients], title };
}
