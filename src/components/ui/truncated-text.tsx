"use client";

import * as React from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface TruncatedTextProps {
  text: string;
  /** Optional max-width. If not provided, fills container width. */
  maxWidth?: string | number;
  className?: string;
}

/**
 * Displays text with truncation and shows a tooltip only when text is actually truncated.
 * Uses CSS text-overflow: ellipsis for truncation.
 * Dynamically detects truncation via ResizeObserver - works with responsive containers.
 */
export function TruncatedText({
  text,
  maxWidth,
  className,
}: TruncatedTextProps) {
  const textRef = React.useRef<HTMLSpanElement>(null);
  const [isTruncated, setIsTruncated] = React.useState(false);
  const [isOpen, setIsOpen] = React.useState(false);

  const checkTruncation = React.useCallback(() => {
    const el = textRef.current;
    if (el) {
      // Check if text overflows its container
      setIsTruncated(el.scrollWidth > el.clientWidth);
    }
  }, []);

  React.useLayoutEffect(() => {
    checkTruncation();
  }, [text, checkTruncation]);

  React.useEffect(() => {
    const el = textRef.current;
    if (!el) return;

    // ResizeObserver detects when container size changes (e.g., on hover)
    const resizeObserver = new ResizeObserver(checkTruncation);
    resizeObserver.observe(el);

    return () => resizeObserver.disconnect();
  }, [checkTruncation]);

  // Build style object - only include maxWidth if provided
  const style: React.CSSProperties | undefined = maxWidth !== undefined
    ? { maxWidth: typeof maxWidth === "number" ? `${maxWidth}px` : maxWidth }
    : undefined;

  // Handle tooltip open state - only allow opening if truncated
  const handleOpenChange = (open: boolean) => {
    if (open && !isTruncated) {
      return; // Don't open if not truncated
    }
    setIsOpen(open);
  };

  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip open={isOpen} onOpenChange={handleOpenChange}>
        <TooltipTrigger asChild>
          <span
            ref={textRef}
            className={cn("block truncate cursor-default", className)}
            style={style}
          >
            {text}
          </span>
        </TooltipTrigger>
        {isTruncated && (
          <TooltipContent side="top" className="max-w-xs break-all">
            {text}
          </TooltipContent>
        )}
      </Tooltip>
    </TooltipProvider>
  );
}
