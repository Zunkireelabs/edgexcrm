"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  NotificationList,
  NotificationEmptyState,
  type Notification,
} from "./notification-card";

const PAGE_SIZE = 25;

export function NotificationsPage() {
  const router = useRouter();
  const [tab, setTab] = useState<"all" | "unread">("all");
  const [page, setPage] = useState(1);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [hasNext, setHasNext] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [markingAll, setMarkingAll] = useState(false);

  const load = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!silent) setLoading(true);
    try {
      // Ask for one extra row: if it comes back, there is a next page (the API has no total count).
      const res = await fetch(
        `/api/v1/notifications?limit=${PAGE_SIZE + 1}&offset=${(page - 1) * PAGE_SIZE}${tab === "unread" ? "&unread=true" : ""}`,
      );
      if (!res.ok) return;
      const json = await res.json();
      const rows: Notification[] = json.data?.notifications || [];
      // A later page can run dry (e.g. its last unread was just read) — step back instead of showing
      // an empty page with "Previous" as the only way out.
      if (rows.length === 0 && page > 1) {
        setPage((p) => p - 1);
        return;
      }
      setHasNext(rows.length > PAGE_SIZE);
      setNotifications(rows.slice(0, PAGE_SIZE));
      setUnreadCount(json.data?.unread_count || 0);
    } catch (error) {
      console.error("Failed to fetch notifications:", error);
    } finally {
      setLoading(false);
    }
  }, [tab, page]);

  useEffect(() => {
    load();
  }, [load]);

  const switchTab = (t: "all" | "unread") => {
    setTab(t);
    setPage(1);
  };

  const markAsRead = async (id: string) => {
    try {
      await fetch(`/api/v1/notifications/${id}/read`, { method: "POST" });
      if (tab === "unread") {
        // Reading one shifts every later unread up by one, so refetch this page instead of just
        // dropping the row: the page stays full and Next/Previous never skip a notification.
        await load({ silent: true });
        return;
      }
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)),
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch (error) {
      console.error("Failed to mark notification as read:", error);
    }
  };

  const markAllAsRead = async () => {
    setMarkingAll(true);
    try {
      await fetch("/api/v1/notifications/read-all", { method: "POST" });
      setUnreadCount(0);
      if (tab === "unread") setPage(1);
      await load();
    } catch (error) {
      console.error("Failed to mark all as read:", error);
    } finally {
      setMarkingAll(false);
    }
  };

  const handleOpen = async (n: Notification) => {
    if (!n.read_at) await markAsRead(n.id);
    if (n.link) router.push(n.link);
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <h1 className="mb-4 text-lg font-semibold text-gray-900">Notifications</h1>

      <div className="rounded-xl border border-gray-200 bg-white">
        {/* Tabs + Mark all as read */}
        <div className="flex items-end justify-between gap-2 border-b border-gray-200 px-5">
          <div className="flex items-center gap-6">
            {(["unread", "all"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => switchTab(t)}
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
              disabled={markingAll}
              className="mb-2 flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50"
            >
              <CheckCheck className="h-4 w-4" />
              Mark all as read
            </button>
          )}
        </div>

        {/* List */}
        <div className="min-h-[200px] pt-1">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-200 border-t-blue-500" />
            </div>
          ) : notifications.length === 0 ? (
            <NotificationEmptyState unreadTab={tab === "unread"} />
          ) : (
            <NotificationList notifications={notifications} onOpen={handleOpen} onMarkRead={markAsRead} />
          )}
        </div>

        {/* Pagination */}
        {(page > 1 || hasNext) && (
          <div className="flex items-center justify-between border-t border-gray-200 px-5 py-3">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 1 || loading}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="mr-1 h-4 w-4" />
              Previous
            </Button>
            <span className="text-xs text-gray-500">Page {page}</span>
            <Button variant="outline" size="sm" disabled={!hasNext || loading} onClick={() => setPage((p) => p + 1)}>
              Next
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
