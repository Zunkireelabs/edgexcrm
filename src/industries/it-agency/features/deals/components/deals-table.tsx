"use client";

import Link from "next/link";
import { formatMoney } from "@/lib/travel/currency";
import type { Deal, DealStage } from "@/types/database";

interface DealsTableProps {
  deals: Deal[];
  stages: DealStage[];
}

function formatDate(dateString: string | null): string {
  if (!dateString) return "—";
  return new Date(dateString).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const STATUS_STYLES: Record<string, string> = {
  open: "bg-blue-50 text-blue-700",
  won: "bg-green-50 text-green-700",
  lost: "bg-red-50 text-red-700",
};

export function DealsTable({ deals, stages }: DealsTableProps) {
  const stageMap = new Map(stages.map((s) => [s.id, s]));

  if (deals.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-sm text-muted-foreground">No deals found. Create your first deal to get started.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-[0.75rem] border bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/30 text-xs text-muted-foreground uppercase tracking-wide">
            <th className="px-4 py-3 text-left font-medium">Deal</th>
            <th className="px-4 py-3 text-left font-medium">Account</th>
            <th className="px-4 py-3 text-left font-medium">Contact</th>
            <th className="px-4 py-3 text-left font-medium">Stage</th>
            <th className="px-4 py-3 text-right font-medium">Amount</th>
            <th className="px-4 py-3 text-left font-medium">Close Date</th>
            <th className="px-4 py-3 text-left font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {deals.map((deal) => {
            const stage = deal.stage_id ? stageMap.get(deal.stage_id) : undefined;
            const account = deal.accounts as { id: string; name: string } | null;
            const contact = deal.contacts as { id: string; first_name: string; last_name: string } | null;

            return (
              <tr key={deal.id} className="hover:bg-muted/10 transition-colors">
                <td className="px-4 py-3">
                  <Link href={`/deals/${deal.id}`} className="font-medium hover:text-primary transition-colors">
                    {deal.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {account ? (
                    <Link href={`/accounts/${account.id}`} className="hover:text-primary transition-colors">
                      {account.name}
                    </Link>
                  ) : "—"}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {contact ? (
                    <Link href={`/contacts/${contact.id}`} className="hover:text-primary transition-colors">
                      {contact.first_name} {contact.last_name}
                    </Link>
                  ) : "—"}
                </td>
                <td className="px-4 py-3">
                  {stage ? (
                    <div className="flex items-center gap-1.5">
                      <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: stage.color }} />
                      <span className="text-xs">{stage.name}</span>
                    </div>
                  ) : "—"}
                </td>
                <td className="px-4 py-3 text-right font-medium tabular-nums">
                  {deal.amount !== null && deal.amount !== undefined
                    ? formatMoney(deal.amount, deal.currency)
                    : "—"}
                </td>
                <td className="px-4 py-3 text-muted-foreground text-xs">
                  {formatDate(deal.close_date)}
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${STATUS_STYLES[deal.status] ?? ""}`}>
                    {deal.status}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
