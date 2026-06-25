"use client";

import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { formatRelativeTime } from "@/lib/format-relative-time";
import type { InboxSnapshot } from "@/lib/supabase/queries";

interface InboxSnapshotCardProps {
  snapshot: InboxSnapshot;
}

export function InboxSnapshotCard({ snapshot }: InboxSnapshotCardProps) {
  const { items, unreadCount } = snapshot;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">
            Inbox
            {unreadCount > 0 && (
              <span className="ml-2 inline-flex items-center px-1.5 py-0 rounded-full text-[11px] font-medium bg-blue-100 text-blue-700">
                {unreadCount > 99 ? "99+" : unreadCount} unread
              </span>
            )}
          </CardTitle>
          <Link href="/inbox" className="text-xs text-blue-600 hover:underline">
            View inbox ▸
          </Link>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 gap-2 text-center">
            <MessageSquare className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No conversations assigned to you.</p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {items.map((c) => (
              <Link
                key={c.id}
                href={`/inbox?conversation=${c.id}`}
                className="flex items-start gap-3 py-2 px-1 rounded-md hover:bg-gray-50 transition-colors"
              >
                <span
                  className={`h-2 w-2 rounded-full shrink-0 mt-1.5 ${
                    c.unread_count > 0 ? "bg-blue-500" : "bg-gray-300"
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {c.contact_display_name || c.contact_phone || "Unknown contact"}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {c.last_message_preview ?? "No messages yet"}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground shrink-0">
                  {c.last_message_at ? formatRelativeTime(c.last_message_at) : ""}
                </span>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
