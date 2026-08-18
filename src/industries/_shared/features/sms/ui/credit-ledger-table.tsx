"use client";

import { useEffect, useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { smsGet, SmsApiError } from "../lib/api-client";
import type { SmsCreditAccount, SmsCreditLedgerRow } from "../lib/types";

const REASON_LABEL: Record<SmsCreditLedgerRow["reason"], string> = {
  grant: "Grant",
  reserve: "Reserve",
  settle: "Settle",
  settle_overage: "Settle (overage)",
  refund: "Refund",
  adjustment: "Adjustment",
  reconcile_note: "Note",
};

export function CreditLedgerTable() {
  const [account, setAccount] = useState<SmsCreditAccount | null>(null);
  const [ledger, setLedger] = useState<SmsCreditLedgerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    smsGet<{ account: SmsCreditAccount; ledger: SmsCreditLedgerRow[] }>("/api/v1/sms/credits")
      .then(({ data }) => {
        setAccount(data.account);
        setLedger(data.ledger);
      })
      .catch((e: SmsApiError) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="py-8 text-center text-sm text-muted-foreground">Loading credits…</div>;
  if (error) return <div className="py-4 text-sm text-destructive">{error}</div>;

  return (
    <div className="flex flex-col gap-4">
      {account && (
        <div className="grid grid-cols-4 gap-3">
          <div className="rounded-md border p-3">
            <p className="text-xs text-muted-foreground">Balance</p>
            <p className="text-lg font-semibold tabular-nums">{account.balance}</p>
          </div>
          <div className="rounded-md border p-3">
            <p className="text-xs text-muted-foreground">Reserved</p>
            <p className="text-lg font-semibold tabular-nums">{account.reserved}</p>
          </div>
          <div className="rounded-md border p-3">
            <p className="text-xs text-muted-foreground">Lifetime granted</p>
            <p className="text-lg font-semibold tabular-nums">{account.lifetime_granted}</p>
          </div>
          <div className="rounded-md border p-3">
            <p className="text-xs text-muted-foreground">Lifetime consumed</p>
            <p className="text-lg font-semibold tabular-nums">{account.lifetime_consumed}</p>
          </div>
        </div>
      )}

      {ledger.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">No ledger activity yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead className="text-right">Delta</TableHead>
              <TableHead className="text-right">Balance after</TableHead>
              <TableHead>Ref</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ledger.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="text-xs text-muted-foreground">{new Date(row.created_at).toLocaleString()}</TableCell>
                <TableCell>{REASON_LABEL[row.reason]}</TableCell>
                <TableCell className={`text-right tabular-nums font-medium ${row.delta < 0 ? "text-destructive" : "text-emerald-600"}`}>
                  {row.delta > 0 ? "+" : ""}
                  {row.delta}
                </TableCell>
                <TableCell className="text-right tabular-nums">{row.balance_after}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{row.ref_type ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
