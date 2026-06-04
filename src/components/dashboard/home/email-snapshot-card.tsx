"use client";

import Link from "next/link";
import { Mail } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { formatRelativeTime } from "@/lib/format-relative-time";
import type { EmailSnapshot } from "@/lib/supabase/queries";

interface EmailSnapshotCardProps {
  snapshot: EmailSnapshot;
}

export function EmailSnapshotCard({ snapshot }: EmailSnapshotCardProps) {
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
          <Link href="/email" className="text-xs text-blue-600 hover:underline">
            View inbox ▸
          </Link>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 gap-2 text-center">
            <Mail className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">Inbox is clear.</p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {items.map((email) => (
              <div
                key={email.id}
                className="flex items-start gap-3 py-2 px-1 rounded-md hover:bg-gray-50 transition-colors"
              >
                <span className="h-2 w-2 rounded-full bg-blue-500 shrink-0 mt-1.5" aria-label="Unread" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {email.from_name || email.from_email}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {email.subject ?? "(no subject)"}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground shrink-0">
                  {email.received_at ? formatRelativeTime(email.received_at) : ""}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
