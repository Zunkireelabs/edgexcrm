"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Download, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

interface SubmissionLeadRef {
  display_id: string | null;
  isDeleted: boolean;
  isMerged: boolean;
}

interface SubmissionRow {
  id: string;
  created_at: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  country: string | null;
  matched_existing: boolean;
  created_via: string;
  intake_source: string | null;
  intake_medium: string | null;
  intake_campaign: string | null;
  custom_fields: Record<string, unknown>;
  file_urls: Record<string, unknown>;
  raw_payload: Record<string, unknown>;
  lead_id: string;
  lead: SubmissionLeadRef | null;
}

interface SubmissionsResponse {
  data: SubmissionRow[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

interface SubmissionsTabProps {
  formConfigId: string;
  active: boolean;
  onTotalChange?: (total: number) => void;
}

function fullName(row: SubmissionRow): string {
  const name = [row.first_name, row.last_name].filter(Boolean).join(" ").trim();
  return name || "—";
}

function sourceCampaign(row: SubmissionRow): string {
  const parts = [row.intake_source, row.intake_campaign].filter(Boolean);
  return parts.length ? parts.join(" / ") : "—";
}

export function SubmissionsTab({ formConfigId, active, onTotalChange }: SubmissionsTabProps) {
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<SubmissionRow[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [matched, setMatched] = useState<"all" | "new" | "existing">("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [exporting, setExporting] = useState(false);

  const [selected, setSelected] = useState<SubmissionRow | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search]);

  // Reset to page 1 whenever a filter changes.
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, matched, from, to]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("limit", "50");
    if (debouncedSearch) params.set("q", debouncedSearch);
    if (matched !== "all") params.set("matched", matched);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    return params.toString();
  }, [page, debouncedSearch, matched, from, to]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/v1/form-configs/${formConfigId}/submissions?${queryString}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load submissions");
        return res.json() as Promise<SubmissionsResponse>;
      })
      .then((json) => {
        if (cancelled) return;
        setRows(json.data);
        setTotalPages(json.meta.totalPages);
        setTotal(json.meta.total);
        onTotalChange?.(json.meta.total);
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, formConfigId, queryString]);

  async function handleExportCsv() {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set("q", debouncedSearch);
      if (matched !== "all") params.set("matched", matched);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      params.set("format", "csv");
      const res = await fetch(`/api/v1/form-configs/${formConfigId}/submissions?${params.toString()}`);
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `form-${formConfigId}-submissions.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  if (!active && !loaded) return null;

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search name, email, phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>
        <Select value={matched} onValueChange={(v) => setMatched(v as typeof matched)}>
          <SelectTrigger className="h-8 w-36 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="new">New</SelectItem>
            <SelectItem value="existing">Existing</SelectItem>
          </SelectContent>
        </Select>
        <Input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="h-8 w-36 text-sm"
          aria-label="From date"
        />
        <span className="text-xs text-muted-foreground">to</span>
        <Input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="h-8 w-36 text-sm"
          aria-label="To date"
        />
        <div className="flex-1" />
        <Button size="sm" variant="outline" onClick={handleExportCsv} disabled={exporting || total === 0}>
          {exporting ? (
            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5 mr-1.5" />
          )}
          Export CSV
        </Button>
      </div>

      {/* Table */}
      <div className="border rounded-lg overflow-hidden">
        {loading && rows.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            Loading submissions...
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm">No submissions yet.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Source / Campaign</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer"
                  onClick={() => setSelected(row)}
                >
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(row.created_at).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-sm">
                    {row.lead?.isDeleted ? (
                      <span className="flex items-center gap-1.5">
                        {fullName(row)}
                        <Badge variant="outline" className="text-[10px] text-muted-foreground">
                          Lead deleted
                        </Badge>
                      </span>
                    ) : row.lead?.isMerged ? (
                      <span className="flex items-center gap-1.5">
                        {fullName(row)}
                        <Badge variant="outline" className="text-[10px] text-muted-foreground">
                          Merged
                        </Badge>
                      </span>
                    ) : (
                      <Link
                        href={`/leads/${row.lead_id}`}
                        className="hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {fullName(row)}
                      </Link>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{row.email || "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{row.phone || "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{sourceCampaign(row)}</TableCell>
                  <TableCell>
                    {row.matched_existing ? (
                      <Badge variant="secondary" className="text-xs">
                        Existing lead
                      </Badge>
                    ) : (
                      <Badge variant="default" className="text-xs">
                        New lead
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <p className="text-muted-foreground text-xs">
            Page {page} of {totalPages} · {total} total
          </p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Row detail drawer */}
      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent className="sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Submission detail</SheetTitle>
          </SheetHeader>
          {selected && <SubmissionDetail row={selected} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="px-4 py-1.5">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm break-words">{value ?? "—"}</p>
    </div>
  );
}

function SubmissionDetail({ row }: { row: SubmissionRow }) {
  const [showRaw, setShowRaw] = useState(false);
  const customFieldEntries = Object.entries(row.custom_fields ?? {});
  const fileUrlEntries = Object.entries(row.file_urls ?? {});

  return (
    <div className="space-y-3 pb-6">
      <DetailField label="Submitted" value={new Date(row.created_at).toLocaleString()} />
      <DetailField label="Name" value={fullName(row)} />
      <DetailField label="Email" value={row.email} />
      <DetailField label="Phone" value={row.phone} />
      <DetailField label="City" value={row.city} />
      <DetailField label="Country" value={row.country} />
      <DetailField
        label="Status"
        value={
          row.matched_existing ? (
            <Badge variant="secondary" className="text-xs">Existing lead</Badge>
          ) : (
            <Badge variant="default" className="text-xs">New lead</Badge>
          )
        }
      />
      <DetailField label="Source" value={row.intake_source} />
      <DetailField label="Medium" value={row.intake_medium} />
      <DetailField label="Campaign" value={row.intake_campaign} />
      <DetailField label="Created via" value={row.created_via} />

      {customFieldEntries.length > 0 && (
        <div className="px-4 pt-2">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Custom fields</p>
          <div className="border rounded-md divide-y">
            {customFieldEntries.map(([key, value]) => (
              <div key={key} className="px-3 py-1.5 flex justify-between gap-3 text-sm">
                <span className="text-muted-foreground shrink-0">{key}</span>
                <span className="text-right break-words">{String(value)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {fileUrlEntries.length > 0 && (
        <div className="px-4 pt-2">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Files</p>
          <div className="space-y-1">
            {fileUrlEntries.map(([key, value]) => (
              <a
                key={key}
                href={String(value)}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-sm text-primary hover:underline truncate"
              >
                {key}
              </a>
            ))}
          </div>
        </div>
      )}

      <div className="px-4 pt-2">
        <button
          className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
          onClick={() => setShowRaw((v) => !v)}
        >
          {showRaw ? "Hide" : "Show"} raw payload
        </button>
        {showRaw && (
          <pre className="mt-2 text-[11px] bg-muted rounded-md p-3 overflow-x-auto whitespace-pre-wrap break-words">
            {JSON.stringify(row.raw_payload, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}
