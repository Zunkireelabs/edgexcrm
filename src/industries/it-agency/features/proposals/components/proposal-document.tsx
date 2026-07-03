import { formatMoney } from "@/lib/travel/currency";
import type { ProposalLineItem } from "@/types/database";

export interface ProposalDocumentBranding {
  name: string;
  logo_url: string | null;
  primary_color: string | null;
}

export interface ProposalDocumentData {
  proposal_number: string;
  title: string;
  status: string;
  currency: string;
  subtotal: number;
  discount_type: "percent" | "amount" | null;
  discount_value: number;
  tax_percent: number;
  total: number;
  notes: string | null;
  valid_until: string | null;
  deal_name?: string | null;
}

interface ProposalDocumentProps {
  proposal: ProposalDocumentData;
  lineItems: ProposalLineItem[];
  branding?: ProposalDocumentBranding | null;
  expired?: boolean;
}

function formatDate(dateString: string | null): string {
  if (!dateString) return "—";
  return new Date(dateString).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export function ProposalDocument({ proposal, lineItems, branding, expired }: ProposalDocumentProps) {
  const accent = branding?.primary_color ?? undefined;

  return (
    <div className="max-w-3xl mx-auto py-10 px-6 print:py-0 print:px-0">
      {branding && (
        <div className="flex items-center gap-3 mb-8 pb-4 border-b" style={accent ? { borderColor: accent } : undefined}>
          {branding.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={branding.logo_url} alt={branding.name} className="h-8 w-auto" />
          ) : (
            <span className="text-lg font-bold" style={accent ? { color: accent } : undefined}>
              {branding.name}
            </span>
          )}
        </div>
      )}

      {expired && (
        <div className="mb-6 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          This proposal has expired.
        </div>
      )}

      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">{proposal.title}</h1>
          <p className="text-sm text-muted-foreground mt-1">{proposal.proposal_number}</p>
        </div>
        <div className="text-right text-sm text-muted-foreground">
          {proposal.deal_name && <p>For: {proposal.deal_name}</p>}
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
                {line.billing_type === "hourly" && line.hours != null && (
                  <p className="text-xs text-muted-foreground">{line.hours}h</p>
                )}
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
  );
}
