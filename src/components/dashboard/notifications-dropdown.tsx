"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck, Inbox } from "lucide-react";

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

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/notifications?limit=10");
      if (!res.ok) return;

      const json = await res.json();
      setNotifications(json.data?.notifications || []);
      setUnreadCount(json.data?.unread_count || 0);
    } catch (error) {
      console.error("Failed to fetch notifications:", error);
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
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h3 className="text-base font-semibold text-gray-900">Notifications</h3>
              {unreadCount > 0 && (
                <button
                  onClick={markAllAsRead}
                  disabled={markingAllRead}
                  className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 font-medium disabled:opacity-50 transition-colors"
                >
                  <CheckCheck className="w-4 h-4" />
                  Mark all as read
                </button>
              )}
            </div>

            {/* Notifications List */}
            <div className="max-h-[420px] overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="w-6 h-6 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
                </div>
              ) : notifications.length === 0 ? (
                <div className="py-16 text-center">
                  <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-gray-50 flex items-center justify-center">
                    <Inbox className="w-7 h-7 text-gray-300" />
                  </div>
                  <p className="text-sm font-medium text-gray-900 mb-1">No notifications</p>
                  <p className="text-sm text-gray-500">You&apos;re all caught up!</p>
                </div>
              ) : (
                <div>
                  {notifications.map((notification, index) => (
                    <button
                      key={notification.id}
                      onClick={() => handleNotificationClick(notification)}
                      className={`w-full text-left px-5 py-4 hover:bg-gray-50 transition-colors ${
                        !notification.read_at ? "bg-blue-50/40" : ""
                      } ${index !== notifications.length - 1 ? "border-b border-gray-50" : ""}`}
                    >
                      <div className="flex gap-4">
                        {/* Icon with colored background */}
                        <div className="shrink-0">
                          {getNotificationIcon(notification.type)}
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <p
                                className={`text-sm leading-snug ${
                                  !notification.read_at
                                    ? "font-semibold text-gray-900"
                                    : "font-medium text-gray-700"
                                }`}
                              >
                                {notification.title}
                              </p>
                              <p className="text-sm text-gray-500 mt-0.5 line-clamp-2 leading-snug">
                                {notification.message}
                              </p>
                            </div>
                            {/* Unread indicator */}
                            {!notification.read_at && (
                              <span className="shrink-0 w-2.5 h-2.5 bg-blue-500 rounded-full mt-1" />
                            )}
                          </div>
                          {/* Time */}
                          <p className="text-xs text-gray-400 mt-2">
                            {formatRelativeTime(new Date(notification.created_at))}
                          </p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
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
