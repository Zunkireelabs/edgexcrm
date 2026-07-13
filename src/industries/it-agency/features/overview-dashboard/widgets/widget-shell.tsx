"use client";

import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Same shell as delivery-dashboard/sales-dashboard's widget-shell.tsx — kept
// per-feature-folder rather than shared, mirroring the existing convention
// (each dashboard folder owns its own copy so it stays self-contained).
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

// `value` accepts a plain string (rendered large/bold, e.g. "42%") or a custom
// node (e.g. HealthChips) that brings its own sizing — the wrapper is a div,
// not a span, so a custom node is free to nest block-level children.
export function Stat({ label, value, delta }: { label: string; value: ReactNode; delta?: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <div className="flex items-baseline gap-1.5">
        <div className={typeof value === "string" ? "text-2xl font-bold truncate" : "min-w-0"}>{value}</div>
        {delta}
      </div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

// Same palette as delivery-dashboard/widgets/widget-shell.tsx's RAG_COLORS —
// duplicated per the existing per-folder convention.
export const RAG_COLORS = {
  green: "#16a34a",
  amber: "#d97706",
  red: "#dc2626",
} as const;
