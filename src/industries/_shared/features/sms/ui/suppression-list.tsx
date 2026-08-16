"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Trash2 } from "lucide-react";
import { smsGet, smsSend, SmsApiError } from "../lib/api-client";
import type { SmsSuppressionRow } from "../lib/types";

const REASON_BADGE: Record<SmsSuppressionRow["reason"], "default" | "secondary" | "outline" | "destructive"> = {
  opt_out: "secondary",
  manual: "outline",
  hard_bounce: "destructive",
  complaint: "destructive",
  invalid: "outline",
};

interface SuppressionListProps {
  canManage: boolean;
}

export function SuppressionList({ canManage }: SuppressionListProps) {
  const [rows, setRows] = useState<SmsSuppressionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [adding, setAdding] = useState(false);

  function load() {
    setLoading(true);
    smsGet<SmsSuppressionRow[]>("/api/v1/sms/suppressions")
      .then(({ data }) => setRows(data))
      .catch((e: SmsApiError) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function handleAdd() {
    if (!phone.trim()) return;
    setAdding(true);
    try {
      await smsSend("/api/v1/sms/suppressions", "POST", { phone: phone.trim() });
      setPhone("");
      toast.success("Added to suppression list.");
      load();
    } catch (e) {
      toast.error(e instanceof SmsApiError ? e.message : "Failed to add suppression.");
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(id: string) {
    try {
      await smsSend(`/api/v1/sms/suppressions?id=${id}`, "DELETE");
      setRows((r) => r.filter((row) => row.id !== id));
      toast.success("Removed from suppression list.");
    } catch (e) {
      toast.error(e instanceof SmsApiError ? e.message : "Failed to remove suppression.");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {canManage && (
        <div className="flex items-center gap-2">
          <Input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="98XXXXXXXX"
            className="max-w-xs"
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          />
          <Button onClick={handleAdd} disabled={adding || !phone.trim()}>
            Add to DNC
          </Button>
        </div>
      )}

      {loading && <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>}
      {error && <div className="py-4 text-sm text-destructive">{error}</div>}

      {!loading && !error && (
        <>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No suppressed numbers.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Phone</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead>Added</TableHead>
                  {canManage && <TableHead className="w-10" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-sm">{row.phone_e164}</TableCell>
                    <TableCell>
                      <Badge variant={REASON_BADGE[row.reason]} className="text-xs">
                        {row.reason.replace(/_/g, " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{row.note ?? "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(row.created_at).toLocaleDateString()}</TableCell>
                    {canManage && (
                      <TableCell>
                        <Button variant="ghost" size="icon-sm" onClick={() => handleRemove(row.id)} aria-label="Remove suppression">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </>
      )}
    </div>
  );
}
