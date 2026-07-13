"use client";

import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Shared card shell for delivery widgets so loading/empty/error treatment is
// consistent across all 10 without repeating the same markup per widget.
export function WidgetCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function WidgetLoading() {
  return (
    <div className="flex items-center justify-center h-32">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );
}

export function WidgetEmpty({ message }: { message: string }) {
  return <p className="text-sm text-muted-foreground text-center py-8">{message}</p>;
}

export function WidgetError({ message = "Failed to load data." }: { message?: string }) {
  return <p className="text-sm text-red-600 text-center py-8">{message}</p>;
}

// RAG palette shared by health/status-driven widgets (delivery-health,
// team-utilization, task-progress).
export const RAG_COLORS = {
  green: "#16a34a",
  amber: "#d97706",
  red: "#dc2626",
} as const;
