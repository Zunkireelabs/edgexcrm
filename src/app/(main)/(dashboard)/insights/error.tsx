"use client";

import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function InsightsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center gap-4">
      <AlertCircle className="h-8 w-8 text-destructive" />
      <div>
        <p className="font-medium text-sm">Something went wrong loading this page.</p>
        <p className="text-muted-foreground text-sm mt-1">{error.message || "An unexpected error occurred."}</p>
      </div>
      <Button variant="outline" size="sm" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
