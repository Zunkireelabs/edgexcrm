"use client";

import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { formatMoney } from "@/lib/travel/currency";
import type { Proposal, ProposalLineItem } from "@/types/database";

interface ProposalPrintViewProps {
  proposalId: string;
}

function formatDate(dateString: string | null): string {
  if (!dateString) return "—";
  return new Date(dateString).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export function ProposalPrintView({ proposalId }: ProposalPrintViewProps) {
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [lineItems, setLineItems] = useState<ProposalLineItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/v1/proposals/${proposalId}`)
      .then((r) => r.json())
      .then(({ data }) => {
        if (data) {
          setProposal(data as Proposal);
          setLineItems((data as Proposal).line_items ?? []);
        }
      })
      .finally(() => setLoading(false));
  }, [proposalId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!proposal) return null;

  return (
    <>
      <style>{`
        @media print {
          @page { margin: 1.5cm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>
      <div className="max-w-3xl mx-auto py-10 px-6 print:py-0 print:px-0">
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold">{proposal.title}</h1>
            <p className="text-sm text-muted-foreground mt-1">{proposal.proposal_number}</p>
          </div>
          <div className="text-right text-sm text-muted-foreground">
            {proposal.deals && <p>For: {proposal.deals.name}</p>}
            <p>Valid until: {formatDate(proposal.valid_until)}</p>
          </div>
        </div>

        <table className="w-full text-sm mb-6">
          <thead>
            <tr className="border-b-2 border-foreground text-left">
              <th className="py-2 font-semibold">Item</th>
              <th className="py-2 font-semibold text-right w-20">Qty</th>
              <th className="py-2 font-semibold text-right w-32">Unit Price</th>
              <th className="py-2 font-semibold text-right w-32">Total</th>
            </tr>
          </thead>
          <tbody>
            {lineItems.map((line) => (
              <tr key={line.id} className="border-b">
                <td className="py-2">
                  <p className="font-medium">{line.name}</p>
                  {line.description && <p className="text-xs text-muted-foreground">{line.description}</p>}
                </td>
                <td className="py-2 text-right">{line.quantity}</td>
                <td className="py-2 text-right">{formatMoney(line.unit_price, proposal.currency)}</td>
                <td className="py-2 text-right font-medium">{formatMoney(line.line_total, proposal.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex justify-end mb-8">
          <div className="w-64 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span>{formatMoney(proposal.subtotal, proposal.currency)}</span>
            </div>
            {proposal.discount_type && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  Discount {proposal.discount_type === "percent" ? `(${proposal.discount_value}%)` : ""}
                </span>
                <span>
                  -{proposal.discount_type === "percent"
                    ? formatMoney(proposal.subtotal * (proposal.discount_value / 100), proposal.currency)
                    : formatMoney(proposal.discount_value, proposal.currency)}
                </span>
              </div>
            )}
            {proposal.tax_percent > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Tax ({proposal.tax_percent}%)</span>
              </div>
            )}
            <div className="flex justify-between text-base font-bold pt-2 border-t">
              <span>Total</span>
              <span>{formatMoney(proposal.total, proposal.currency)}</span>
            </div>
          </div>
        </div>

        {proposal.notes && (
          <div className="pt-4 border-t">
            <h2 className="font-semibold text-sm mb-2">Notes</h2>
            <p className="text-sm whitespace-pre-wrap text-muted-foreground">{proposal.notes}</p>
          </div>
        )}
      </div>
    </>
  );
}
