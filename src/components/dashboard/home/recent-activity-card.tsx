"use client";

import Link from "next/link";
import { Bell } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { formatRelativeTime } from "@/lib/format-relative-time";
import type { RecentNotification } from "@/lib/supabase/queries";

interface RecentActivityCardProps {
  notifications: RecentNotification[];
}

export function RecentActivityCard({ notifications }: RecentActivityCardProps) {
  return (
    <Card>
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
              const content = (
                <div className="flex items-start gap-3 py-2 px-1 rounded-md hover:bg-gray-50 transition-colors">
                  <div
                    className={`h-2 w-2 rounded-full shrink-0 mt-1.5 ${n.read_at ? "bg-gray-300" : "bg-blue-500"}`}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{n.title}</p>
                    <p className="text-xs text-muted-foreground truncate">{n.message}</p>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {formatRelativeTime(n.created_at)}
                  </span>
                </div>
              );

              return n.link ? (
                <Link key={n.id} href={n.link}>
                  {content}
                </Link>
              ) : (
                <div key={n.id}>{content}</div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
