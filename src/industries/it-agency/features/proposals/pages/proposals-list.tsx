"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Plus, FileSignature, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/travel/currency";
import { AddProposalSheet } from "../components/add-proposal-sheet";
import type { Proposal } from "@/types/database";

interface ProposalsListPageProps {
  tenantId: string;
  role: string;
}

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600",
  sent: "bg-blue-50 text-blue-700",
  accepted: "bg-green-50 text-green-700",
  rejected: "bg-red-50 text-red-700",
  expired: "bg-yellow-50 text-yellow-700",
};

function formatDate(dateString: string | null): string {
  if (!dateString) return "—";
  return new Date(dateString).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function ProposalsListPage({ role }: ProposalsListPageProps) {
  const isAdmin = role === "owner" || role === "admin";
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    fetch("/api/v1/proposals")
      .then((r) => r.json())
      .then(({ data }) => setProposals(data ?? []))
      .catch(() => toast.error("Failed to load proposals"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">Proposals</h1>
        {isAdmin && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New Proposal
          </Button>
        )}
      </div>

      {proposals.length === 0 ? (
        <div className="border rounded-xl p-12 text-center bg-card">
          <FileSignature className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
          <h3 className="font-semibold text-lg mb-1">No proposals yet</h3>
          <p className="text-muted-foreground text-sm mb-6">
            Create a proposal from a deal to send a priced quote.
          </p>
          {isAdmin && (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create your first proposal
            </Button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[0.75rem] border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30 text-xs text-muted-foreground uppercase tracking-wide">
                <th className="px-4 py-3 text-left font-medium">Number</th>
                <th className="px-4 py-3 text-left font-medium">Title</th>
                <th className="px-4 py-3 text-left font-medium">Deal</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Total</th>
                <th className="px-4 py-3 text-left font-medium">Valid Until</th>
                <th className="px-4 py-3 text-left font-medium">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {proposals.map((p) => (
                <tr key={p.id} className="hover:bg-muted/10 transition-colors">
                  <td className="px-4 py-3">
                    <Link href={`/proposals/${p.id}`} className="font-medium hover:text-primary transition-colors">
                      {p.proposal_number}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{p.title}</td>
                  <td className="px-4 py-3">
                    {p.deals ? (
                      <Link href={`/deals/${p.deals.id}`} className="text-muted-foreground hover:text-primary transition-colors">
                        {p.deals.name}
                      </Link>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${STATUS_STYLES[p.status] ?? ""}`}>
                      {p.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">
                    {formatMoney(p.total, p.currency)}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDate(p.valid_until)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDate(p.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AddProposalSheet open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
