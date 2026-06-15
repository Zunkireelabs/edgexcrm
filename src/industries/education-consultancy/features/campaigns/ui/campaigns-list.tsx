"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Megaphone, Trophy } from "lucide-react";

interface Campaign {
  id: string;
  name: string;
  slug: string;
  type: string;
  status: "draft" | "active" | "final";
  created_at: string;
  updated_at: string;
}

const STATUS_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
  active: { label: "Active", variant: "default" },
  final: { label: "Final", variant: "secondary" },
  draft: { label: "Draft", variant: "outline" },
};

export function CampaignsList() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/campaigns")
      .then((r) => r.json())
      .then((json) => {
        if (json.error) throw new Error(json.error.message);
        setCampaigns(json.data ?? []);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
        Loading campaigns…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-48 text-destructive text-sm">
        {error}
      </div>
    );
  }

  if (campaigns.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-2 text-muted-foreground">
        <Megaphone className="h-8 w-8 opacity-40" />
        <p className="text-sm">No campaigns yet.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {campaigns.map((c) => {
        const badge = STATUS_BADGE[c.status] ?? STATUS_BADGE.draft;
        return (
          <Link key={c.id} href={`/campaigns/${c.id}`} className="block">
            <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
              <CardContent className="p-5 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Trophy className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="font-medium text-sm leading-tight truncate">{c.name}</span>
                  </div>
                  <Badge variant={badge.variant} className="shrink-0 text-xs">
                    {badge.label}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground capitalize">
                  {c.type.replace(/_/g, " ")}
                </p>
                <p className="text-xs text-muted-foreground mt-auto">
                  Last updated {new Date(c.updated_at).toLocaleDateString()}
                </p>
              </CardContent>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}
