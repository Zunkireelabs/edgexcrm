import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/server";

export interface CreateNotificationParams {
  tenantId: string;
  userId: string;
  type: string;
  title: string;
  message: string;
  link?: string;
}

/**
 * Create a notification for a user
 * Call this from API routes when events happen
 */
export async function createNotification(params: CreateNotificationParams) {
  const { tenantId, userId, type, title, message, link } = params;

  const supabase = await createServiceClient();

  const { data, error } = await supabase
    .from("notifications")
    .insert({
      tenant_id: tenantId,
      user_id: userId,
      type,
      title,
      message,
      link,
    })
    .select()
    .single();

  if (error) {
    console.error("Failed to create notification:", error);
    return null;
  }

  return data;
}

/**
 * Create notifications for multiple users
 */
export async function createNotifications(
  notifications: CreateNotificationParams[]
) {
  if (notifications.length === 0) return [];

  const supabase = await createServiceClient();

  const { data, error } = await supabase
    .from("notifications")
    .insert(
      notifications.map((n) => ({
        tenant_id: n.tenantId,
        user_id: n.userId,
        type: n.type,
        title: n.title,
        message: n.message,
        link: n.link,
      }))
    )
    .select();

  if (error) {
    console.error("Failed to create notifications:", error);
    return [];
  }

  return data || [];
}

/**
 * Notification types
 */
export const NotificationTypes = {
  LEAD_ASSIGNED: "lead.assigned",
  LEAD_UNASSIGNED: "lead.unassigned",
  INVITE_ACCEPTED: "invite.accepted",
  TEAM_MEMBER_JOINED: "team.member_joined",
  EMAIL_RECEIVED: "email.received",
  LEAD_CREATED: "lead.created",
  LEAD_STAGE_CHANGED: "lead.stage_changed",
  INBOX_MESSAGE_RECEIVED: "inbox.message_received",
} as const;

/**
 * Create notifications for multiple users, excluding the actor to suppress self-pings.
 * De-dups by userId (keeps first occurrence).
 */
export async function createNotificationsExcept(
  actorUserId: string | null,
  params: CreateNotificationParams[]
) {
  const seen = new Set<string>();
  const filtered = params.filter((p) => {
    if (p.userId === actorUserId) return false;
    if (seen.has(p.userId)) return false;
    seen.add(p.userId);
    return true;
  });
  return createNotifications(filtered);
}

/**
 * Fetch user IDs of all owners and admins for a tenant.
 */
export async function getTenantAdminRecipients(
  supabase: SupabaseClient,
  tenantId: string
): Promise<string[]> {
  const { data } = await supabase
    .from("tenant_users")
    .select("user_id")
    .eq("tenant_id", tenantId)
    .in("role", ["owner", "admin"]);
  return ((data ?? []) as unknown as { user_id: string }[]).map((r) => r.user_id);
}

/**
 * Upsert a thread-level notification: if an unread notification of the same
 * type + userId + link exists within the last 15 minutes, bump its title/message
 * and updated_at instead of inserting a new row. Falls back to insert.
 */
export async function upsertThreadNotification(params: CreateNotificationParams) {
  const supabase = await createServiceClient();
  const windowStart = new Date(Date.now() - 15 * 60 * 1000).toISOString();

  const { data: existing } = await supabase
    .from("notifications")
    .select("id")
    .eq("tenant_id", params.tenantId)
    .eq("user_id", params.userId)
    .eq("type", params.type)
    .eq("link", params.link ?? "")
    .is("read_at", null)
    .gte("created_at", windowStart)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    await supabase
      .from("notifications")
      .update({ title: params.title, message: params.message, created_at: new Date().toISOString() })
      .eq("id", existing.id);
    return;
  }

  await createNotification(params);
}
