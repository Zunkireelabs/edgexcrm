"use client";

import { cn } from "@/lib/utils";

interface AISparkleIconProps {
  className?: string;
  animated?: boolean;
}

export function AISparkleIcon({ className, animated = false }: AISparkleIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={cn(
        "size-4",
        animated && "animate-pulse",
        className
      )}
    >
      <defs>
        <linearGradient id="ai-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#2272B4" />
          <stop offset="50%" stopColor="#6366F1" />
          <stop offset="100%" stopColor="#8B5CF6" />
        </linearGradient>
      </defs>
      <path
        d="M12 2L13.09 8.26L18 6L15.74 10.91L22 12L15.74 13.09L18 18L13.09 15.74L12 22L10.91 15.74L6 18L8.26 13.09L2 12L8.26 10.91L6 6L10.91 8.26L12 2Z"
        fill="url(#ai-gradient)"
      />
    </svg>
  );
}

// Larger version for empty states
export function AISparkleIconLarge({ className, muted = false }: { className?: string; muted?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={cn("size-12", className)}
    >
      <defs>
        <linearGradient id="ai-gradient-large" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={muted ? "#9CA3AF" : "#2272B4"} />
          <stop offset="50%" stopColor={muted ? "#9CA3AF" : "#6366F1"} />
          <stop offset="100%" stopColor={muted ? "#9CA3AF" : "#8B5CF6"} />
        </linearGradient>
      </defs>
      <path
        d="M12 2L13.09 8.26L18 6L15.74 10.91L22 12L15.74 13.09L18 18L13.09 15.74L12 22L10.91 15.74L6 18L8.26 13.09L2 12L8.26 10.91L6 6L10.91 8.26L12 2Z"
        fill="url(#ai-gradient-large)"
        opacity={muted ? 0.5 : 1}
      />
    </svg>
  );
}
