"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/** Copy `value` and show the standard toast ("<label> copied"). Returns whether it worked. */
export async function copyToClipboard(value: string, label?: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(label ? `${label} copied` : "Copied to clipboard");
    return true;
  } catch {
    toast.error("Failed to copy");
    return false;
  }
}

interface CopyButtonProps {
  value: string;
  label?: string;
  className?: string;
}

export function CopyButton({ value, label, className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (await copyToClipboard(value, label)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn("h-6 w-6 text-muted-foreground hover:text-foreground", className)}
      onClick={handleCopy}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-green-600" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
      <span className="sr-only">Copy {label || "to clipboard"}</span>
    </Button>
  );
}
