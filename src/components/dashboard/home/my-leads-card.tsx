"use client";

import Link from "next/link";
import { Users } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatRelativeTime } from "@/lib/format-relative-time";
import type { Lead } from "@/types/database";

interface MyLeadsCardProps {
  leads: Lead[];
  unreadLeadIds?: Set<string>;
}

export function MyLeadsCard({ leads, unreadLeadIds }: MyLeadsCardProps) {
  const sorted = [...leads].sort((a, b) => {
    const aUnread = unreadLeadIds?.has(a.id) ? 1 : 0;
    const bUnread = unreadLeadIds?.has(b.id) ? 1 : 0;
    if (aUnread !== bUnread) return bUnread - aUnread;
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  });

  const display = sorted.slice(0, 8);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">My Leads</CardTitle>
          <Link href="/leads" className="text-xs text-blue-600 hover:underline">
            View all ▸
          </Link>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {display.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 gap-2 text-center">
            <Users className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No leads assigned to you.</p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {display.map((lead) => {
              const isUnread = unreadLeadIds?.has(lead.id);
              const name =
                [lead.first_name, lead.last_name].filter(Boolean).join(" ") ||
                lead.email ||
                "Unknown";
              return (
                <Link
                  key={lead.id}
                  href={`/leads/${lead.id}`}
                  className="flex items-center gap-3 py-2 px-1 rounded-md hover:bg-gray-50 transition-colors group"
                >
                  {isUnread ? (
                    <span className="h-2 w-2 rounded-full bg-blue-500 shrink-0" aria-label="Unread" />
                  ) : (
                    <span className="h-2 w-2 rounded-full bg-transparent shrink-0" />
                  )}
                  <span className={`flex-1 text-sm truncate ${isUnread ? "font-medium text-gray-900" : "text-gray-700"}`}>
                    {name}
                  </span>
                  {lead.status && (
                    <Badge variant="secondary" className="text-[11px] px-1.5 py-0 shrink-0">
                      {lead.status}
                    </Badge>
                  )}
                  <span className="text-xs text-muted-foreground shrink-0">
                    {formatRelativeTime(lead.updated_at)}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
