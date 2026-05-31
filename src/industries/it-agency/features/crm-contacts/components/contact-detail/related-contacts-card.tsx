"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users } from "lucide-react";

interface AccountSibling {
  id: string;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
}

interface RelatedContactsCardProps {
  siblings: AccountSibling[];
  accountId: string | null;
  accountName: string | null;
}

function getInitials(first: string | null, last: string | null): string {
  return ((first?.charAt(0) ?? "") + (last?.charAt(0) ?? "")).toUpperCase() || "?";
}

export function RelatedContactsCard({ siblings, accountId, accountName }: RelatedContactsCardProps) {
  const hasMore = siblings.length > 10;
  const displayed = siblings.slice(0, 10);

  return (
    <Card className="border border-border shadow-none rounded-lg">
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" />
          Related Contacts
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-3 pt-0">
        {displayed.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No other contacts at this account yet.</p>
        ) : (
          <div className="space-y-2">
            {displayed.map((s) => {
              const name = [s.first_name, s.last_name].filter(Boolean).join(" ") || "Unknown";
              return (
                <div key={s.id} className="flex items-center gap-2.5">
                  <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center shrink-0">
                    <span className="text-[10px] font-semibold text-muted-foreground">
                      {getInitials(s.first_name, s.last_name)}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <Link
                      href={`/contacts/${s.id}`}
                      className="text-sm font-medium hover:underline block truncate"
                    >
                      {name}
                    </Link>
                    {s.title && (
                      <p className="text-xs text-muted-foreground truncate">{s.title}</p>
                    )}
                  </div>
                </div>
              );
            })}
            {hasMore && accountId && accountName && (
              <Link
                href={`/accounts/${accountId}`}
                className="text-xs text-primary hover:underline block pt-1"
              >
                See all at {accountName} →
              </Link>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
