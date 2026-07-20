"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, FileText } from "lucide-react";
import { formatMoney } from "@/lib/travel/currency";
import { InvoiceDetailDrawer } from "@/industries/it-agency/features/invoicing/components/invoice-detail-drawer";
import type { Invoice, InvoiceStatus } from "@/types/database";

const STATUS_CONFIG: Record<InvoiceStatus, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-slate-100 text-slate-600" },
  sent: { label: "Sent", className: "bg-blue-100 text-blue-700" },
  paid: { label: "Paid", className: "bg-green-100 text-green-700" },
  void: { label: "Void", className: "bg-muted text-muted-foreground line-through" },
};

interface BillingTabProps {
  accountId: string;
  isAdmin: boolean;
}

export function BillingTab({ accountId, isAdmin }: BillingTabProps) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [openInvoiceId, setOpenInvoiceId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/accounts/${accountId}/invoices`).then((r) => r.json());
      setInvoices(res.data ?? []);
    } catch {
      toast.error("Failed to load invoices");
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    if (isAdmin) load();
    else setLoading(false);
  }, [isAdmin, load]);

  if (!isAdmin) {
    return <p className="text-sm text-muted-foreground py-4 text-center">Billing is visible to owners and admins only.</p>;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (invoices.length === 0) {
    return <p className="text-sm text-muted-foreground py-4 text-center">No invoices yet.</p>;
  }

  return (
    <div className="space-y-2">
      {invoices.map((inv) => (
        <div
          key={inv.id}
          role="button"
          tabIndex={0}
          onClick={() => setOpenInvoiceId(inv.id)}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setOpenInvoiceId(inv.id)}
          className="w-full flex items-center justify-between gap-3 p-3 border border-border rounded-lg hover:bg-muted/40 transition-colors text-left cursor-pointer"
        >
          <div className="flex items-center gap-2 min-w-0">
            <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{inv.invoice_number}</p>
              {inv.projects && (
                <Link
                  href={`/projects/${inv.project_id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                >
                  {inv.projects.name}
                </Link>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-xs text-muted-foreground hidden sm:inline">
              {inv.issue_date ? `Issued ${inv.issue_date}` : ""}
              {inv.due_date ? ` · Due ${inv.due_date}` : ""}
            </span>
            <span className="text-sm font-medium tabular-nums">{formatMoney(inv.total, inv.currency)}</span>
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CONFIG[inv.status].className}`}>
              {STATUS_CONFIG[inv.status].label}
            </span>
          </div>
        </div>
      ))}

      <InvoiceDetailDrawer
        invoiceId={openInvoiceId}
        open={openInvoiceId !== null}
        onOpenChange={(open) => !open && setOpenInvoiceId(null)}
        onChanged={load}
      />
    </div>
  );
}
