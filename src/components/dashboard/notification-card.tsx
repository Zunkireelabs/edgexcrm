"use client";

import { Fragment } from "react";
import { NOTIFICATION_CATEGORIES, type NotificationCategoryKey } from "@/lib/notification-categories";
import {
  AtSign,
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
export function dateBucket(date: Date): "Today" | "Yesterday" | "This week" | "Earlier" {
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startYesterday = new Date(startToday);
  startYesterday.setDate(startYesterday.getDate() - 1);
  const startWeek = new Date(startToday);
  startWeek.setDate(startWeek.getDate() - 7);
  if (date >= startToday) return "Today";
  if (date >= startYesterday) return "Yesterday";
  if (date >= startWeek) return "This week";
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
  "inbox.message_received": { Icon: MessageSquare, tint: "bg-sky-50 text-sky-600", action: "View message" },
  "inbox.assigned": { Icon: MessageSquare, tint: "bg-blue-50 text-blue-600", action: "View message" },
  "note.mention": { Icon: AtSign, tint: "bg-purple-50 text-purple-600", action: "View note" },
  "outreach.draft_due": { Icon: Send, tint: "bg-sky-50 text-sky-600", action: "Open outreach" },
};
const DEFAULT_META = { Icon: Bell, tint: "bg-gray-100 text-gray-500", action: "View" };

export function NotificationEmptyState({ unreadTab, filtered = false }: { unreadTab: boolean; filtered?: boolean }) {
  return (
    <div className="py-10 text-center">
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
        {filtered
          ? "Nothing in this category"
          : unreadTab
            ? "You don't have any unread notifications"
            : "No notifications"}
      </p>
      <p className="text-sm text-gray-500">
        {filtered ? "Try another filter." : unreadTab ? "You're all caught up." : "No notifications found"}
      </p>
    </div>
  );
}

/** The list body: date headers + compact rows. */
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
    <div>
      {notifications.map((notification, index) => {
        const unread = !notification.read_at;
        const bucket = dateBucket(new Date(notification.created_at));
        const showHeader = index === 0 || bucket !== dateBucket(new Date(notifications[index - 1].created_at));
        const { Icon, tint, action } = NOTIFICATION_META[notification.type] ?? DEFAULT_META;
        const openable = !!notification.link;
        return (
          <Fragment key={notification.id}>
            {showHeader && (
              <p
                className={`border-b border-gray-100 bg-white px-3 pb-1.5 pt-4 text-[11px] font-semibold uppercase tracking-wider text-gray-500 sm:px-4 ${
                  stickyHeaders ? "sticky top-0 z-10" : ""
                }`}
              >
                {bucket}
              </p>
            )}
            {/* The whole row opens the notification; the check button marks it read without opening. */}
            <div
              role={openable ? "button" : undefined}
              tabIndex={openable ? 0 : undefined}
              aria-label={openable ? `${action}: ${notification.title}` : undefined}
              title={openable ? action : undefined}
              onClick={openable ? () => onOpen(notification) : undefined}
              onKeyDown={
                openable
                  ? (e) => {
                      if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                        e.preventDefault();
                        onOpen(notification);
                      }
                    }
                  : undefined
              }
              className={`group relative flex gap-3 border-b border-gray-100 bg-white px-3 py-2.5 transition-colors hover:bg-gray-50 focus-visible:bg-gray-50 focus-visible:outline-none sm:px-4 ${
                openable ? "cursor-pointer" : ""
              } ${unread ? "before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-blue-500" : ""}`}
            >
              <div
                className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${tint} ${
                  unread ? "" : "opacity-60"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <p
                    className={`truncate text-sm leading-5 ${
                      unread ? "font-semibold text-gray-900" : "font-normal text-gray-600"
                    }`}
                  >
                    {notification.title}
                  </p>
                  <span className="shrink-0 whitespace-nowrap text-xs text-gray-400">
                    {formatRelativeTime(new Date(notification.created_at))}
                  </span>
                </div>
                <p
                  className={`line-clamp-2 text-[13px] leading-5 sm:line-clamp-1 ${
                    unread ? "pr-8 text-gray-600" : "text-gray-400"
                  }`}
                >
                  {notification.message}
                </p>
              </div>
              {/* Mark-as-read sits over the row's end (the message reserves pr-8 for it, so it never covers
                  text). Shown on hover/focus; always visible on touch screens, which have no hover. */}
              {unread && (
                <button
                  type="button"
                  title="Mark as read"
                  aria-label="Mark as read"
                  onClick={(e) => {
                    e.stopPropagation();
                    onMarkRead(notification.id);
                  }}
                  className="absolute bottom-2 right-3 flex h-6 w-6 items-center justify-center rounded-full border border-gray-300 bg-white text-gray-500 opacity-0 transition-opacity hover:bg-gray-100 hover:text-gray-900 focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100 sm:right-4"
                >
                  <Check className="h-3 w-3" />
                </button>
              )}
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

/** Category chips for the /notifications page. Scrolls sideways on narrow screens instead of wrapping. */
export function NotificationFilters({
  value,
  onChange,
}: {
  value: NotificationCategoryKey | null;
  onChange: (next: NotificationCategoryKey | null) => void;
}) {
  const chips: { key: NotificationCategoryKey | null; label: string }[] = [
    { key: null, label: "All types" },
    ...NOTIFICATION_CATEGORIES.map((c) => ({ key: c.key, label: c.label })),
  ];
  return (
    <div
      role="group"
      aria-label="Filter by type"
      className="flex gap-2 overflow-x-auto px-3 py-2.5 [scrollbar-width:none] sm:px-4 [&::-webkit-scrollbar]:hidden"
    >
      {chips.map((chip) => {
        const active = value === chip.key;
        return (
          <button
            key={chip.label}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(chip.key)}
            className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              active
                ? "border-gray-900 bg-gray-900 text-white"
                : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:text-gray-900"
            }`}
          >
            {chip.label}
          </button>
        );
      })}
    </div>
  );
}

/** Placeholder rows shown while the first page loads. */
export function NotificationSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex animate-pulse gap-3 border-b border-gray-100 px-3 py-3 sm:px-4">
          <div className="h-7 w-7 shrink-0 rounded-full bg-gray-100" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-1/3 rounded bg-gray-100" />
            <div className="h-3 w-2/3 rounded bg-gray-100" />
          </div>
        </div>
      ))}
    </div>
  );
}
