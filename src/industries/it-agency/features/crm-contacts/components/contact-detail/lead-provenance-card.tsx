"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface SourceLead {
  id: string;
  first_name: string | null;
  last_name: string | null;
  created_at: string;
}

interface LeadProvenanceCardProps {
  sourceLead: SourceLead | null;
}

export function LeadProvenanceCard({ sourceLead }: LeadProvenanceCardProps) {
  if (!sourceLead) return null;

  const leadName = [sourceLead.first_name, sourceLead.last_name].filter(Boolean).join(" ") || "Lead";
  const createdDate = new Date(sourceLead.created_at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <Card className="border border-border shadow-none rounded-lg">
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Converted from lead
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-3 pt-0 space-y-1">
        <Link
          href={`/leads/${sourceLead.id}`}
          className="text-sm font-medium hover:underline flex items-center gap-1"
        >
          <ArrowLeft className="h-3.5 w-3.5 shrink-0" />
          {leadName}
        </Link>
        <p className="text-xs text-muted-foreground">Lead created {createdDate}</p>
      </CardContent>
    </Card>
  );
}
