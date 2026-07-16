"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ErrorBubbleProps {
  message: string;
  onRetry: () => void;
}

export function ErrorBubble({ message, onRetry }: ErrorBubbleProps) {
  return (
    <div className="flex gap-3">
      <div className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-red-100">
        <AlertTriangle className="w-4 h-4 text-red-500" />
      </div>
      <div className="max-w-[80%] rounded-2xl rounded-bl-md bg-red-50 border border-red-100 px-4 py-2.5 flex flex-col items-start gap-2">
        <p className="text-sm text-red-700">{message}</p>
        <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={onRetry}>
          <RotateCcw className="w-3 h-3" /> Retry
        </Button>
      </div>
    </div>
  );
}
