"use client";

import { ArrowLeft, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/travel/currency";
import { tripTypeLabel } from "@/industries/travel-agency/leads/trip-types";
import {
  type Itinerary,
  LINE_ITEM_CATEGORIES,
  lineItemTotal,
  grandTotal,
} from "./types";
import type { Lead } from "@/types/database";

interface ItineraryProposalProps {
  itinerary: Itinerary;
  lead: Lead;
  tenantName: string;
  tenantLogoUrl?: string | null;
  onBack: () => void;
}

export function ItineraryProposal({
  itinerary,
  lead,
  tenantName,
  tenantLogoUrl,
  onBack,
}: ItineraryProposalProps) {
  const cf = (lead.custom_fields || {}) as Record<string, string | number | null | undefined>;
  const total = grandTotal(itinerary.lineItems);

  function categoryLabel(cat: string): string {
    return LINE_ITEM_CATEGORIES.find((c) => c.value === cat)?.label ?? cat;
  }

  function formatDate(d: string | undefined): string {
    if (!d) return "";
    return new Date(String(d)).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }

  function computeNights(): number | null {
    const s = cf.trip_start_date;
    const e = cf.trip_end_date;
    if (!s || !e) return null;
    const diff = new Date(String(e)).getTime() - new Date(String(s)).getTime();
    const nights = Math.round(diff / 86_400_000);
    return nights > 0 ? nights : null;
  }

  const nights = computeNights();
  const paxParts = [
    cf.trip_pax_adults ? `${cf.trip_pax_adults} adult${Number(cf.trip_pax_adults) !== 1 ? "s" : ""}` : null,
    cf.trip_pax_children ? `${cf.trip_pax_children} child${Number(cf.trip_pax_children) !== 1 ? "ren" : ""}` : null,
    cf.trip_pax_infants ? `${cf.trip_pax_infants} infant${Number(cf.trip_pax_infants) !== 1 ? "s" : ""}` : null,
  ].filter(Boolean);

  return (
    <div>
      {/* Screen-only toolbar */}
      <div className="flex items-center gap-3 mb-6 print:hidden">
        <Button variant="outline" size="sm" className="gap-1.5" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
          Back to Editor
        </Button>
        <Button
          size="sm"
          className="gap-1.5"
          onClick={() => window.print()}
        >
          <Printer className="h-4 w-4" />
          Print / Save as PDF
        </Button>
      </div>

      {/* Printable proposal */}
      <div className="print-proposal bg-white text-gray-900 p-8 max-w-3xl mx-auto border border-border rounded-lg print:border-0 print:p-0 print:shadow-none">
        {/* Branded header */}
        <div className="border-b-2 border-sky-600 pb-4 mb-6">
          {tenantLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={tenantLogoUrl} alt={tenantName} className="h-14 w-auto object-contain" />
          ) : (
            <h1 className="text-2xl font-bold text-sky-700">{tenantName}</h1>
          )}
          <p className="text-sm text-gray-500 mt-1">Travel Proposal</p>
        </div>

        {/* Trip title */}
        <h2 className="text-xl font-semibold mb-4">{itinerary.title}</h2>

        {/* Trip summary table */}
        <div className="bg-sky-50 rounded-lg p-4 mb-6 grid grid-cols-2 gap-3 text-sm">
          {cf.trip_destination && (
            <SummaryRow label="Destination" value={String(cf.trip_destination)} />
          )}
          {cf.trip_departure_city && (
            <SummaryRow label="Departure city" value={String(cf.trip_departure_city)} />
          )}
          {cf.trip_start_date && (
            <SummaryRow label="Departure" value={formatDate(String(cf.trip_start_date))} />
          )}
          {cf.trip_end_date && (
            <SummaryRow
              label={nights !== null ? `Return (${nights}N)` : "Return"}
              value={formatDate(String(cf.trip_end_date))}
            />
          )}
          {paxParts.length > 0 && (
            <SummaryRow label="Travellers" value={paxParts.join(", ")} />
          )}
          {cf.trip_type && (
            <SummaryRow
              label="Trip type"
              value={tripTypeLabel(String(cf.trip_type)) ?? String(cf.trip_type)}
            />
          )}
          {cf.trip_flexibility && (
            <SummaryRow
              label="Dates"
              value={cf.trip_flexibility === "exact" ? "Fixed dates" : "Flexible"}
            />
          )}
          <SummaryRow
            label="Prepared for"
            value={[lead.first_name, lead.last_name].filter(Boolean).join(" ") || lead.email || ""}
          />
        </div>

        {/* Days */}
        {itinerary.days.length > 0 && (
          <div className="mb-6">
            <h3 className="text-base font-semibold mb-3 text-sky-700">Day-by-Day Itinerary</h3>
            <div className="space-y-4">
              {itinerary.days.map((day, idx) => (
                <div key={day.id} className="border-l-4 border-sky-200 pl-4">
                  <p className="text-sm font-semibold">
                    Day {idx + 1}
                    {day.title && day.title !== `Day ${idx + 1}` ? ` — ${day.title}` : ""}
                  </p>
                  {day.description && (
                    <p className="text-sm text-gray-600 mt-1 whitespace-pre-wrap">
                      {day.description}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Price summary */}
        {itinerary.lineItems.length > 0 && (
          <div className="mb-6">
            <h3 className="text-base font-semibold mb-3 text-sky-700">Price Summary</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 font-medium text-gray-500">Category</th>
                  <th className="text-left py-2 font-medium text-gray-500">Description</th>
                  <th className="text-right py-2 font-medium text-gray-500">Qty</th>
                  <th className="text-right py-2 font-medium text-gray-500">Unit Price</th>
                  <th className="text-right py-2 font-medium text-gray-500">Amount</th>
                </tr>
              </thead>
              <tbody>
                {itinerary.lineItems.map((item) => (
                  <tr key={item.id} className="border-b border-gray-100">
                    <td className="py-2 text-gray-600">{categoryLabel(item.category)}</td>
                    <td className="py-2">{item.label || "—"}</td>
                    <td className="py-2 text-right">{item.qty}</td>
                    <td className="py-2 text-right">{formatMoney(item.unitPrice, itinerary.currency)}</td>
                    <td className="py-2 text-right font-medium">
                      {formatMoney(lineItemTotal(item), itinerary.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-sky-600">
                  <td colSpan={4} className="py-3 font-bold text-right text-sky-700">
                    Grand Total
                  </td>
                  <td className="py-3 text-right font-bold text-sky-700 text-base">
                    {formatMoney(total, itinerary.currency)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* Notes */}
        {itinerary.notes && (
          <div className="mb-6">
            <h3 className="text-base font-semibold mb-2 text-sky-700">Notes & Terms</h3>
            <p className="text-sm text-gray-600 whitespace-pre-wrap">{itinerary.notes}</p>
          </div>
        )}

        {/* Footer */}
        <div className="border-t border-gray-200 pt-4 mt-6 text-center text-xs text-gray-400">
          Prepared by {tenantName} · {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
        </div>
      </div>

      {/* Print-optimised CSS */}
      <style jsx global>{`
        @media print {
          body * { visibility: hidden; }
          .print-proposal, .print-proposal * { visibility: visible; }
          .print-proposal { position: absolute; inset: 0; }
        }
      `}</style>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}
