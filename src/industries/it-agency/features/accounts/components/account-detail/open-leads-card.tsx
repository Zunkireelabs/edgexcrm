"use client";

import Link from "next/link";

interface Lead {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  status: string;
}

interface OpenLeadsCardProps {
  leads: Lead[];
  openLeadsCount: number;
  accountId: string;
}

function leadName(lead: Lead): string {
  return [lead.first_name, lead.last_name].filter(Boolean).join(" ") || lead.email || "Unknown";
}

export function OpenLeadsCard({ leads, openLeadsCount, accountId }: OpenLeadsCardProps) {
  if (openLeadsCount === 0) return null;

  const shown = leads.slice(0, 5);

  return (
    <div className="border border-border rounded-lg bg-card shadow-none p-3 space-y-2">
      <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Open Leads</h3>
      <ul className="space-y-1.5">
        {shown.map((lead) => (
          <li key={lead.id} className="flex items-center justify-between gap-2">
            <Link
              href={`/leads/${lead.id}`}
              className="text-sm font-medium hover:underline truncate"
              style={{ color: "#0f0f10" }}
            >
              {leadName(lead)}
            </Link>
            <span className="text-xs text-muted-foreground shrink-0">{lead.status}</span>
          </li>
        ))}
      </ul>
      {openLeadsCount > 5 && (
        <Link
          href={`/leads?account_id=${accountId}`}
          className="text-xs text-primary hover:underline block"
        >
          See all ({openLeadsCount})
        </Link>
      )}
    </div>
  );
}
