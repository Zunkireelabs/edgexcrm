"use client";

import { useState } from "react";
import { Plus, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/lib/travel/currency";
import { InvoiceDetailDrawer } from "../../../invoicing/components/invoice-detail-drawer";
import { useProjectInvoices } from "../../hooks/use-project-invoices";
import type { InvoiceStatus } from "@/types/database";

const STATUS_CONFIG: Record<InvoiceStatus, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-slate-100 text-slate-600" },
  sent: { label: "Sent", className: "bg-blue-100 text-blue-700" },
  paid: { label: "Paid", className: "bg-green-100 text-green-700" },
  void: { label: "Void", className: "bg-muted text-muted-foreground line-through" },
};

interface InvoicesPanelProps {
  projectId: string;
  currency: string;
}

// Self-fetching (mirrors BillableSummary) — only ever mounted for
// isAdmin && project.is_billable (see project-cockpit.tsx), so the fetch
// never fires for a visitor who shouldn't see it.
export function InvoicesPanel({ projectId, currency }: InvoicesPanelProps) {
  const { invoices, billableMilestones, loading, generateInvoice, refetch } = useProjectInvoices(projectId);
  const [picking, setPicking] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [openInvoiceId, setOpenInvoiceId] = useState<string | null>(null);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const runningTotal = billableMilestones
    .filter((m) => selected.has(m.id))
    .reduce((sum, m) => sum + m.amount, 0);

  async function handleGenerate() {
    setGenerating(true);
    const ok = await generateInvoice(Array.from(selected));
    setGenerating(false);
    if (ok) {
      setSelected(new Set());
      setPicking(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm">Invoices</CardTitle>
        <Button variant="ghost" size="sm" onClick={() => setPicking((v) => !v)}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Generate invoice
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {picking && (
          <div className="rounded-md border p-3 space-y-2 bg-muted/30">
            {billableMilestones.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">
                Accept a milestone with an amount to bill it.
              </p>
            ) : (
              <>
                {billableMilestones.map((m) => (
                  <label key={m.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox checked={selected.has(m.id)} onCheckedChange={() => toggle(m.id)} />
                    <span className="flex-1 truncate">{m.title}</span>
                    <span className="tabular-nums text-muted-foreground">{formatMoney(m.amount, currency)}</span>
                  </label>
                ))}
                <div className="flex items-center justify-between pt-2 border-t border-border/50">
                  <span className="text-xs text-muted-foreground">Total: {formatMoney(runningTotal, currency)}</span>
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setPicking(false)} disabled={generating}>
                      Cancel
                    </Button>
                    <Button size="sm" onClick={handleGenerate} disabled={generating || selected.size === 0}>
                      Generate
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {!loading && invoices.length === 0 && !picking && (
          <p className="text-sm text-muted-foreground italic">No invoices yet.</p>
        )}

        {invoices.map((inv) => (
          <button
            key={inv.id}
            type="button"
            onClick={() => setOpenInvoiceId(inv.id)}
            className="w-full flex items-center justify-between gap-3 py-2 border-b border-border/50 last:border-0 text-left hover:bg-muted/40 rounded-sm px-1 -mx-1"
          >
            <div className="min-w-0 flex items-center gap-2">
              <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-sm text-foreground truncate">{inv.invoice_number}</span>
              {inv.due_date && <span className="text-xs text-muted-foreground shrink-0">Due {inv.due_date}</span>}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-sm tabular-nums">{formatMoney(inv.total, inv.currency)}</span>
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CONFIG[inv.status].className}`}>
                {STATUS_CONFIG[inv.status].label}
              </span>
            </div>
          </button>
        ))}
      </CardContent>

      <InvoiceDetailDrawer
        invoiceId={openInvoiceId}
        open={openInvoiceId !== null}
        onOpenChange={(open) => !open && setOpenInvoiceId(null)}
        onChanged={refetch}
      />
    </Card>
  );
}
