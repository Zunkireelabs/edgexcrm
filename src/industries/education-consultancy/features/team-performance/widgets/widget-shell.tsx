"use client";

import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function WidgetCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium uppercase tracking-wide text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

// Perceived-speed polish only (Item 5) — shaped like the widget's real
// content (a control row + a few data rows) instead of a bare spinner. The
// actual root-cause fix for slow loads is Item 2 (legacy/staging list
// exclusion), deliberately not in this round.
export function WidgetLoading() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-7 w-48" />
      <div className="space-y-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-3/4" />
      </div>
    </div>
  );
}

export function WidgetEmpty({ message }: { message: string }) {
  return <p className="text-sm text-muted-foreground text-center py-8">{message}</p>;
}

export function WidgetError({ message = "Failed to load data." }: { message?: string }) {
  return <p className="text-sm text-red-600 text-center py-8">{message}</p>;
}
