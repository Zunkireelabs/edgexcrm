"use client";

import Link from "next/link";
import { Bell } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { formatRelativeTime } from "@/lib/format-relative-time";
import type { RecentActivityItem } from "@/lib/supabase/queries";

interface RecentActivityCardProps {
  notifications: RecentActivityItem[];
}

export function RecentActivityCard({ notifications }: RecentActivityCardProps) {
  return (
    <Card className="border-sidebar-border rounded-xl">
      <CardHeader>
        <CardTitle className="text-sm font-semibold">Recent Activity</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 gap-2 text-center">
            <Bell className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No recent activity.</p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {notifications.map((n) => {
              const isUnread = !n.read_at;
              const content = (
                <>
                  <div
                    className={`h-2 w-2 rounded-full shrink-0 mt-1.5 ${isUnread ? "bg-blue-500" : "bg-muted-foreground/30"}`}
                    aria-label={isUnread ? "Unread" : undefined}
                  />
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm truncate ${isUnread ? "font-medium text-foreground" : "text-muted-foreground"}`}>
                      {n.title}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">{n.message}</p>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {formatRelativeTime(n.created_at)}
                  </span>
                </>
              );

              return n.link ? (
                <Link
                  key={n.id}
                  href={n.link}
                  prefetch={false}
                  className="flex items-start gap-3 py-2 px-1 rounded-md hover:bg-muted/50 transition-colors"
                >
                  {content}
                </Link>
              ) : (
                <div key={n.id} className="flex items-start gap-3 py-2 px-1 rounded-md">
                  {content}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
