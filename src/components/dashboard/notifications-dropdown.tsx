"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck, Settings, X } from "lucide-react";
import {
  NotificationList,
  NotificationEmptyState,
  type Notification,
} from "./notification-card";

// The panel is a quick look at the latest notifications; everything older lives on /notifications.
const PANEL_LIMIT = 30;

export function NotificationsDropdown() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [markingAllRead, setMarkingAllRead] = useState(false);
  const [tab, setTab] = useState<"all" | "unread">("all");

  const tabRef = useRef(tab);
  tabRef.current = tab;
  const inflightRef = useRef(false);

  const fetchNotifications = useCallback(async () => {
    if (inflightRef.current) return;
    inflightRef.current = true;
    const forTab = tabRef.current;
    try {
      const res = await fetch(
        `/api/v1/notifications?limit=${PANEL_LIMIT}${forTab === "unread" ? "&unread=true" : ""}`,
      );
      if (!res.ok) return;
      if (forTab !== tabRef.current) return; // tab changed while the request was in flight

      const json = await res.json();
      setNotifications(json.data?.notifications || []);
      setUnreadCount(json.data?.unread_count || 0);
    } catch (error) {
      console.error("Failed to fetch notifications:", error);
    } finally {
      inflightRef.current = false;
    }
  }, []);

  // Unread count for the bell badge, even while the panel is closed.
  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  // Opening the panel or switching tab reloads that tab's newest notifications.
  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setNotifications([]);
    inflightRef.current = false;
    fetchNotifications().finally(() => setLoading(false));
  }, [isOpen, tab, fetchNotifications]);

  // Poll for new notifications every 30 seconds
  useEffect(() => {
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  // Esc closes the panel
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setIsOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen]);

  const markAsRead = async (id: string) => {
    try {
      await fetch(`/api/v1/notifications/${id}/read`, { method: "POST" });
      setNotifications((prev) =>
        tab === "unread"
          ? prev.filter((n) => n.id !== id)
          : prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n))
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
        tab === "unread"
          ? []
          : prev.map((n) => ({ ...n, read_at: n.read_at || new Date().toISOString() }))
      );
      setUnreadCount(0);
    } catch (error) {
      console.error("Failed to mark all as read:", error);
    } finally {
      setMarkingAllRead(false);
    }
  };

  const handleOpen = async (notification: Notification) => {
    if (!notification.read_at) {
      await markAsRead(notification.id);
    }

    if (notification.link) {
      router.push(notification.link);
      setIsOpen(false);
    }
  };

  return (
    <div className="relative">
      {/* Bell Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative px-1.5 py-1 rounded-[8px] border border-gray-200 bg-white hover:bg-gray-100 transition-colors group"
      >
        <Bell className="w-5 h-5 text-gray-600 group-hover:text-gray-900" />
        {/* Notification Badge */}
        {unreadCount > 0 && (
          <span className="absolute top-0.5 right-0.5 min-w-[18px] h-[18px] bg-red-500 rounded-full flex items-center justify-center text-[10px] font-medium text-white border-2 border-[#f7f7f7]">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setIsOpen(false)} />

          {/* Right-side panel — full height, slides over the page content */}
          <aside
            role="dialog"
            aria-label="Notifications"
            className="fixed right-0 top-0 z-50 flex h-full w-[440px] max-w-full flex-col bg-white shadow-2xl border-l border-gray-200 animate-in slide-in-from-right duration-200"
          >
            {/* Header — title (left), settings gear + close (right) */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div className="flex items-center gap-2.5">
                <Bell className="w-5 h-5 text-gray-900" />
                <h3 className="text-base font-semibold text-gray-900">Notifications</h3>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  title="Notification settings (coming soon)"
                  className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                >
                  <Settings className="w-[18px] h-[18px]" />
                </button>
                <button
                  type="button"
                  title="Close"
                  aria-label="Close notifications"
                  onClick={() => setIsOpen(false)}
                  className="p-1.5 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Underline tabs (Unread / All) + Mark all as read */}
            <div className="flex items-end justify-between gap-2 border-b border-gray-200 px-5">
              <div className="flex items-center gap-6">
                {(["unread", "all"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTab(t)}
                    className={`-mb-px border-b-2 py-3 text-sm font-medium transition-colors ${
                      tab === t
                        ? "border-gray-900 text-gray-900"
                        : "border-transparent text-gray-500 hover:text-gray-900"
                    }`}
                  >
                    {t === "all" ? "All" : `Unread (${unreadCount.toLocaleString()})`}
                  </button>
                ))}
              </div>
              {unreadCount > 0 && (
                <button
                  onClick={markAllAsRead}
                  disabled={markingAllRead}
                  className="mb-2 flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50"
                >
                  <CheckCheck className="h-4 w-4" />
                  Mark all as read
                </button>
              )}
            </div>

            {/* Latest notifications (capped) */}
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="w-6 h-6 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
                </div>
              ) : notifications.length === 0 ? (
                <NotificationEmptyState unreadTab={tab === "unread"} />
              ) : (
                <NotificationList
                  notifications={notifications}
                  onOpen={handleOpen}
                  onMarkRead={markAsRead}
                  stickyHeaders
                />
              )}
            </div>

            {/* Footer — always points at the full page */}
            <div className="border-t border-gray-200 bg-white px-5 py-3 text-center">
              <Link
                href="/notifications"
                onClick={() => setIsOpen(false)}
                className="text-sm font-medium text-blue-600 hover:underline"
              >
                View all notifications →
              </Link>
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
