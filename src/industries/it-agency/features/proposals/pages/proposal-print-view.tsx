"use client";

import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { ProposalDocument } from "../components/proposal-document";
import type { Proposal, ProposalLineItem } from "@/types/database";

interface ProposalPrintViewProps {
  proposalId: string;
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
      <ProposalDocument
        proposal={{
          proposal_number: proposal.proposal_number,
          title: proposal.title,
          status: proposal.status,
          currency: proposal.currency,
          subtotal: proposal.subtotal,
          discount_type: proposal.discount_type,
          discount_value: proposal.discount_value,
          tax_percent: proposal.tax_percent,
          total: proposal.total,
          notes: proposal.notes,
          valid_until: proposal.valid_until,
          deal_name: proposal.deals?.name ?? null,
        }}
        lineItems={lineItems}
      />
    </>
  );
}
