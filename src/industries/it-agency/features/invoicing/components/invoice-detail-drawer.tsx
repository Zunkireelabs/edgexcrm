"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { formatMoney } from "@/lib/travel/currency";
import type { Invoice, InvoiceLineItem, InvoiceStatus } from "@/types/database";

const STATUS_CONFIG: Record<InvoiceStatus, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-slate-100 text-slate-600" },
  sent: { label: "Sent", className: "bg-blue-100 text-blue-700" },
  paid: { label: "Paid", className: "bg-green-100 text-green-700" },
  void: { label: "Void", className: "bg-muted text-muted-foreground line-through" },
};

interface InvoiceDetailDrawerProps {
  invoiceId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Called after any mutation (status change / delete / line removal) so the
  // caller's list (cockpit panel or Billing tab) can refetch.
  onChanged: () => void;
}

type InvoiceDetail = Invoice & { line_items: InvoiceLineItem[] };

export function InvoiceDetailDrawer({ invoiceId, open, onOpenChange, onChanged }: InvoiceDetailDrawerProps) {
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!invoiceId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/invoices/${invoiceId}`).then((r) => r.json());
      setInvoice(res.data ?? null);
    } catch {
      toast.error("Failed to load invoice");
    } finally {
      setLoading(false);
    }
  }, [invoiceId]);

  useEffect(() => {
    if (open && invoiceId) load();
    if (!open) setInvoice(null);
  }, [open, invoiceId, load]);

  async function transition(status: InvoiceStatus) {
    if (!invoice) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/invoices/${invoice.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error?.message ?? "Failed to update invoice");
        return;
      }
      await load();
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!invoice) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/invoices/${invoice.id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error?.message ?? "Failed to delete invoice");
        return;
      }
      onChanged();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveLine(lineId: string) {
    if (!invoice) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/invoices/${invoice.id}/line-items/${lineId}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error?.message ?? "Failed to remove line item");
        return;
      }
      await load();
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md w-full flex flex-col">
        {loading || !invoice ? (
          <div className="flex items-center justify-center flex-1">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                {invoice.invoice_number}
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CONFIG[invoice.status].className}`}>
                  {STATUS_CONFIG[invoice.status].label}
                </span>
              </SheetTitle>
              <div className="text-xs text-muted-foreground flex flex-col gap-0.5">
                {invoice.issue_date && <span>Issued {invoice.issue_date}</span>}
                {invoice.due_date && <span>Due {invoice.due_date}</span>}
              </div>
            </SheetHeader>

            <div className="px-4 flex-1 overflow-y-auto space-y-3">
              <div className="space-y-2">
                {invoice.line_items.map((line) => (
                  <div key={line.id} className="flex items-center justify-between gap-2 py-2 border-b border-border/50 last:border-0">
                    <div className="min-w-0">
                      <p className="text-sm text-foreground truncate">{line.description}</p>
                      <p className="text-xs text-muted-foreground">
                        {line.quantity} × {formatMoney(line.unit_price, invoice.currency)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-sm tabular-nums">{formatMoney(line.line_total, invoice.currency)}</span>
                      {invoice.status === "draft" && (
                        <Button variant="ghost" size="sm" onClick={() => handleRemoveLine(line.id)} disabled={busy} title="Remove line">
                          <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
                {invoice.line_items.length === 0 && (
                  <p className="text-sm text-muted-foreground italic">No line items.</p>
                )}
              </div>

              <Separator />

              <div className="flex items-center justify-between text-sm font-semibold">
                <span>Total</span>
                <span className="tabular-nums">{formatMoney(invoice.total, invoice.currency)}</span>
              </div>

              {invoice.notes && (
                <div className="text-sm text-muted-foreground whitespace-pre-wrap">{invoice.notes}</div>
              )}
            </div>

            <SheetFooter className="flex-row justify-end gap-2">
              {invoice.status === "draft" && (
                <>
                  <Button variant="destructive" size="sm" onClick={handleDelete} disabled={busy}>
                    Delete
                  </Button>
                  <Button size="sm" onClick={() => transition("sent")} disabled={busy}>
                    Mark sent
                  </Button>
                </>
              )}
              {invoice.status === "sent" && (
                <>
                  <Button variant="outline" size="sm" onClick={() => transition("void")} disabled={busy}>
                    Void
                  </Button>
                  <Button size="sm" onClick={() => transition("paid")} disabled={busy}>
                    Mark paid
                  </Button>
                </>
              )}
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
