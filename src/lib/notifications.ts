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
} as const;
