"use client";

import { useState } from "react";
import { Mail, ChevronDown, ChevronUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { SentEmail } from "../hooks/use-sent-emails";

interface SentEmailCardProps {
  email: SentEmail;
}

export function SentEmailCard({ email }: SentEmailCardProps) {
  const [expanded, setExpanded] = useState(false);

  const time = new Date(email.sent_at).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <Card className="shadow-none rounded-lg py-0">
      <CardContent className="p-3">
        <div className="flex gap-3">
          <div className="h-8 w-8 rounded-full flex items-center justify-center shrink-0 bg-blue-100 text-blue-600">
            <Mail className="h-4 w-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium text-foreground truncate">{email.subject}</p>
                  <Badge variant="secondary" className="text-xs shrink-0">✉ Sent</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  to {email.to_emails.join(", ")} · {time}
                </p>
              </div>
              <button
                onClick={() => setExpanded((v) => !v)}
                className="text-muted-foreground hover:text-foreground shrink-0"
                aria-label={expanded ? "Collapse" : "Expand"}
              >
                {expanded ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </button>
            </div>
            {expanded && (
              <div
                className="mt-3 text-sm text-foreground border-t pt-3 prose prose-sm max-w-none"
                dangerouslySetInnerHTML={{ __html: email.body_html }}
              />
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
