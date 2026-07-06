"use client";

import { useState, useEffect, useCallback, useRef, Fragment } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck, Settings } from "lucide-react";

// Buckets a notification date into a section-header label.
function dateBucket(date: Date): "Today" | "Yesterday" | "Earlier" {
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startYesterday = new Date(startToday);
  startYesterday.setDate(startYesterday.getDate() - 1);
  if (date >= startToday) return "Today";
  if (date >= startYesterday) return "Yesterday";
  return "Earlier";
}

// Simple relative time formatter (avoids date-fns dependency)
function formatRelativeTime(date: Date): string {
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
  return date.toLocaleDateString();
}

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export function NotificationsDropdown() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading] = useState(false);
  const [markingAllRead, setMarkingAllRead] = useState(false);
  const [tab, setTab] = useState<"all" | "unread">("all");

  const inflightRef = useRef(false);
  const fetchNotifications = useCallback(async () => {
    if (inflightRef.current) return;
    inflightRef.current = true;
    try {
      const res = await fetch("/api/v1/notifications?limit=10");
      if (!res.ok) return;

      const json = await res.json();
      setNotifications(json.data?.notifications || []);
      setUnreadCount(json.data?.unread_count || 0);
    } catch (error) {
      console.error("Failed to fetch notifications:", error);
    } finally {
      inflightRef.current = false;
    }
  }, []);

  // Fetch notifications on mount and when dropdown opens
  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  useEffect(() => {
    if (isOpen) {
      fetchNotifications();
    }
  }, [isOpen, fetchNotifications]);

  // Poll for new notifications every 30 seconds
  useEffect(() => {
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  const markAsRead = async (id: string) => {
    try {
      await fetch(`/api/v1/notifications/${id}/read`, { method: "POST" });
      setNotifications((prev) =>
        prev.map((n) =>
          n.id === id ? { ...n, read_at: new Date().toISOString() } : n
        )
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (error) {
      console.error("Failed to mark notification as read:", error);
    }
  };

  const markAllAsRead = async () => {
    setMarkingAllRead(true);
    try {
      await fetch("/api/v1/notifications/read-all", { method: "POST" });
      setNotifications((prev) =>
        prev.map((n) => ({ ...n, read_at: n.read_at || new Date().toISOString() }))
      );
      setUnreadCount(0);
    } catch (error) {
      console.error("Failed to mark all as read:", error);
    } finally {
      setMarkingAllRead(false);
    }
  };

  const handleNotificationClick = async (notification: Notification) => {
    if (!notification.read_at) {
      await markAsRead(notification.id);
    }

    if (notification.link) {
      router.push(notification.link);
      setIsOpen(false);
    }
  };

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case "lead.assigned":
        return (
          <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center">
            <span className="text-base">👤</span>
          </div>
        );
      case "lead.unassigned":
        return (
          <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center">
            <span className="text-base">👋</span>
          </div>
        );
      case "invite.accepted":
      case "team.member_joined":
        return (
          <div className="w-9 h-9 rounded-full bg-green-100 flex items-center justify-center">
            <span className="text-base">🎉</span>
          </div>
        );
      case "lead.created":
        return (
          <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center">
            <span className="text-base">✨</span>
          </div>
        );
      case "lead.stage_changed":
        return (
          <div className="w-9 h-9 rounded-full bg-purple-100 flex items-center justify-center">
            <span className="text-base">📊</span>
          </div>
        );
      case "email.received":
        return (
          <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center">
            <span className="text-base">✉️</span>
          </div>
        );
      case "leave.requested":
        return (
          <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center">
            <span className="text-base">🌴</span>
          </div>
        );
      case "leave.approved":
        return (
          <div className="w-9 h-9 rounded-full bg-green-100 flex items-center justify-center">
            <span className="text-base">✅</span>
          </div>
        );
      case "leave.rejected":
        return (
          <div className="w-9 h-9 rounded-full bg-red-100 flex items-center justify-center">
            <span className="text-base">🚫</span>
          </div>
        );
      default:
        return (
          <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center">
            <span className="text-base">📬</span>
          </div>
        );
    }
  };

  return (
    <div className="relative">
      {/* Bell Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 hover:bg-gray-100 rounded-lg transition-colors group"
      >
        <Bell className="w-5 h-5 text-gray-600 group-hover:text-gray-900" />
        {/* Notification Badge */}
        {unreadCount > 0 && (
          <span className="absolute top-0.5 right-0.5 min-w-[18px] h-[18px] bg-red-500 rounded-full flex items-center justify-center text-[10px] font-medium text-white border-2 border-[#f7f7f7]">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />

          {/* Dropdown Content - ElevenLabs style, aligned to header right edge */}
          <div className="fixed right-6 top-[68px] w-[420px] bg-white rounded-2xl shadow-xl border border-gray-200/80 z-50 overflow-hidden">
            {/* Header — bell + title (left), settings gear (right) */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div className="flex items-center gap-2.5">
                <Bell className="w-5 h-5 text-gray-900" />
                <h3 className="text-base font-semibold text-gray-900">Notifications</h3>
              </div>
              <button
                type="button"
                title="Notification settings (coming soon)"
                className="p-1.5 -mr-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              >
                <Settings className="w-[18px] h-[18px]" />
              </button>
            </div>

            {/* Filter tabs (All / Unread) + Mark all as read */}
            <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-gray-100">
              <div className="flex items-center gap-1">
                {(["all", "unread"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTab(t)}
                    className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                      tab === t
                        ? "bg-gray-100 text-gray-900"
                        : "text-gray-500 hover:text-gray-900 hover:bg-gray-50"
                    }`}
                  >
                    {t === "all" ? "All" : "Unread"}
                  </button>
                ))}
              </div>
              {unreadCount > 0 && (
                <button
                  onClick={markAllAsRead}
                  disabled={markingAllRead}
                  className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 font-medium disabled:opacity-50 transition-colors pr-1"
                >
                  <CheckCheck className="w-4 h-4" />
                  Mark all as read
                </button>
              )}
            </div>

            {/* Notifications List */}
            <div className="max-h-[420px] overflow-y-auto">
              {(() => {
                const visible =
                  tab === "unread"
                    ? notifications.filter((n) => !n.read_at)
                    : notifications;
                if (loading) {
                  return (
                    <div className="flex items-center justify-center py-12">
                      <div className="w-6 h-6 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
                    </div>
                  );
                }
                if (visible.length === 0) {
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
                      <p className="text-sm font-medium text-gray-900 mb-1">No notifications</p>
                      <p className="text-sm text-gray-500">No notifications found</p>
                    </div>
                  );
                }
                let lastBucket: string | null = null;
                return (
                  <div className="p-2">
                    {visible.map((notification) => {
                      const unread = !notification.read_at;
                      const bucket = dateBucket(new Date(notification.created_at));
                      const showHeader = bucket !== lastBucket;
                      lastBucket = bucket;
                      return (
                        <Fragment key={notification.id}>
                          {showHeader && (
                            <p className="px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                              {bucket}
                            </p>
                          )}
                          <button
                            onClick={() => handleNotificationClick(notification)}
                            className={`relative w-full text-left rounded-xl px-3 py-2.5 transition-colors ${
                              unread ? "bg-blue-50/60 hover:bg-blue-50" : "hover:bg-gray-50"
                            }`}
                          >
                            {/* Unread accent bar */}
                            {unread && (
                              <span className="absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-full bg-blue-500" />
                            )}
                            <div className="flex gap-3">
                              {/* Type icon */}
                              <div className="shrink-0">
                                {getNotificationIcon(notification.type)}
                              </div>

                              {/* Content */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-start justify-between gap-2">
                                  <p
                                    className={`text-sm leading-snug ${
                                      unread
                                        ? "font-semibold text-gray-900"
                                        : "font-medium text-gray-700"
                                    }`}
                                  >
                                    {notification.title}
                                  </p>
                                  <span className="shrink-0 text-xs text-gray-400 whitespace-nowrap mt-0.5">
                                    {formatRelativeTime(new Date(notification.created_at))}
                                  </span>
                                </div>
                                <p className="text-sm text-gray-500 mt-0.5 line-clamp-2 leading-snug">
                                  {notification.message}
                                </p>
                              </div>
                            </div>
                          </button>
                        </Fragment>
                      );
                    })}
                  </div>
                );
              })()}
            </div>

            {/* Footer */}
            {notifications.length > 0 && (
              <div className="border-t border-gray-100 px-5 py-3 bg-gray-50/50">
                <p className="text-center text-xs text-gray-500">
                  {unreadCount > 0
                    ? `${unreadCount} unread notification${unreadCount !== 1 ? "s" : ""}`
                    : "All caught up!"}
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
