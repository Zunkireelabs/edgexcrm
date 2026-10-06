"use client";

import { Fragment } from "react";
import {
  Bell,
  Check,
  UserPlus,
  UserMinus,
  UserCheck,
  Sparkles,
  ArrowRightLeft,
  Mail,
  CalendarDays,
  CircleCheck,
  CircleX,
  ListChecks,
  MessageSquare,
  Send,
  type LucideIcon,
} from "lucide-react";

// Shared by the bell panel (notifications-dropdown.tsx) and the full /notifications page, so the
// two always look the same.

export interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

// Buckets a notification date into a section-header label.
export function dateBucket(date: Date): "Today" | "Yesterday" | "Earlier" {
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startYesterday = new Date(startToday);
  startYesterday.setDate(startYesterday.getDate() - 1);
  if (date >= startToday) return "Today";
  if (date >= startYesterday) return "Yesterday";
  return "Earlier";
}

// Simple relative time formatter (avoids date-fns dependency)
export function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// Icon, tint and the label of the "open it" button for each notification type.
const NOTIFICATION_META: Record<string, { Icon: LucideIcon; tint: string; action: string }> = {
  "lead.assigned": { Icon: UserPlus, tint: "bg-blue-50 text-blue-600", action: "View lead" },
  "lead.unassigned": { Icon: UserMinus, tint: "bg-amber-50 text-amber-600", action: "View lead" },
  "lead.created": { Icon: Sparkles, tint: "bg-emerald-50 text-emerald-600", action: "View lead" },
  "lead.stage_changed": { Icon: ArrowRightLeft, tint: "bg-purple-50 text-purple-600", action: "View lead" },
  "invite.accepted": { Icon: UserCheck, tint: "bg-green-50 text-green-600", action: "View team" },
  "team.member_joined": { Icon: UserCheck, tint: "bg-green-50 text-green-600", action: "View team" },
  "email.received": { Icon: Mail, tint: "bg-sky-50 text-sky-600", action: "View email" },
  "leave.requested": { Icon: CalendarDays, tint: "bg-amber-50 text-amber-600", action: "View request" },
  "leave.approved": { Icon: CircleCheck, tint: "bg-green-50 text-green-600", action: "View request" },
  "leave.rejected": { Icon: CircleX, tint: "bg-red-50 text-red-600", action: "View request" },
  "task.reminder": { Icon: ListChecks, tint: "bg-indigo-50 text-indigo-600", action: "View task" },
  "task.assigned": { Icon: ListChecks, tint: "bg-indigo-50 text-indigo-600", action: "View task" },
  "task.completed": { Icon: ListChecks, tint: "bg-green-50 text-green-600", action: "View task" },
  "task.commented": { Icon: MessageSquare, tint: "bg-indigo-50 text-indigo-600", action: "View task" },
  "outreach.draft_due": { Icon: Send, tint: "bg-sky-50 text-sky-600", action: "Open outreach" },
};
const DEFAULT_META = { Icon: Bell, tint: "bg-gray-100 text-gray-500", action: "View" };

export function NotificationEmptyState({ unreadTab }: { unreadTab: boolean }) {
  return (
    <div className="py-12 text-center">
      {/* Stacked-cards illustration */}
      <div className="relative mx-auto mb-5 h-24 w-40">
        <div className="absolute inset-x-0 top-0 mx-auto h-14 w-32 -rotate-[10deg] rounded-xl border border-gray-100 bg-white shadow-sm" />
        <div className="absolute inset-x-0 top-1.5 mx-auto h-14 w-32 rotate-[6deg] rounded-xl border border-gray-100 bg-white shadow-sm" />
        <div className="absolute inset-x-0 top-3 mx-auto flex h-14 w-32 flex-col justify-center gap-2 rounded-xl border border-gray-100 bg-white px-3 shadow">
          <div className="h-2 w-20 rounded-full bg-gray-200" />
          <div className="h-2 w-14 rounded-full bg-gray-100" />
        </div>
      </div>
      <p className="text-sm font-medium text-gray-900 mb-1">
        {unreadTab ? "You don't have any unread notifications" : "No notifications"}
      </p>
      <p className="text-sm text-gray-500">{unreadTab ? "You're all caught up." : "No notifications found"}</p>
    </div>
  );
}

/** The list body: date headers + cards. */
export function NotificationList({
  notifications,
  onOpen,
  onMarkRead,
  stickyHeaders = false,
}: {
  notifications: Notification[];
  onOpen: (n: Notification) => void;
  onMarkRead: (id: string) => void;
  stickyHeaders?: boolean;
}) {
  return (
    <div className="pb-2">
      {notifications.map((notification, index) => {
        const unread = !notification.read_at;
        const bucket = dateBucket(new Date(notification.created_at));
        const showHeader = index === 0 || bucket !== dateBucket(new Date(notifications[index - 1].created_at));
        const { Icon, tint, action } = NOTIFICATION_META[notification.type] ?? DEFAULT_META;
        return (
          <Fragment key={notification.id}>
            {showHeader && (
              <p
                className={`px-5 pb-2 pt-4 text-[11px] font-semibold uppercase tracking-wider text-gray-400 ${
                  stickyHeaders ? "sticky top-0 z-10 bg-white/95 backdrop-blur" : ""
                }`}
              >
                {bucket}
              </p>
            )}
            <div
              className={`mx-4 mb-2.5 rounded-xl border px-4 py-3 transition-shadow hover:shadow-sm ${
                unread ? "border-blue-100 bg-blue-50/40" : "border-gray-200 bg-white"
              }`}
            >
              <div className="flex gap-3">
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${tint}`}>
                  <Icon className="h-[18px] w-[18px]" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p
                      className={`text-sm leading-snug ${
                        unread ? "font-semibold text-gray-900" : "font-medium text-gray-700"
                      }`}
                    >
                      {notification.title}
                    </p>
                    <span className="mt-0.5 flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-gray-400">
                      {unread && <span className="h-2 w-2 rounded-full bg-blue-500" aria-label="Unread" />}
                      {formatRelativeTime(new Date(notification.created_at))}
                    </span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-sm leading-snug text-gray-500">{notification.message}</p>
                  {(notification.link || unread) && (
                    <div className="mt-2.5 flex items-center gap-2">
                      {notification.link && (
                        <button
                          type="button"
                          onClick={() => onOpen(notification)}
                          className="rounded-full border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-800 transition-colors hover:bg-gray-50"
                        >
                          {action}
                        </button>
                      )}
                      {unread && (
                        <button
                          type="button"
                          title="Mark as read"
                          aria-label="Mark as read"
                          onClick={() => onMarkRead(notification.id)}
                          className="flex h-7 w-7 items-center justify-center rounded-full border border-gray-300 bg-white text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-900"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}
