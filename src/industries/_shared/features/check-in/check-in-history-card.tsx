"use client";

import { useState, useEffect, useCallback } from "react";
import { Clock, Loader2, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface CheckInRecord {
  id: string;
  content: string;
  created_at: string;
  user_email: string;
  user_id: string | null;
}

interface CheckInHistoryCardProps {
  leadId: string;
  teamMemberNames: Record<string, string>;
  teamMemberEmails: Record<string, string>;
}

export function CheckInHistoryCard({ leadId, teamMemberNames, teamMemberEmails }: CheckInHistoryCardProps) {
  const [records, setRecords] = useState<CheckInRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/leads/${leadId}/check-ins`);
      if (!res.ok) throw new Error("Failed to fetch");
      const { data } = await res.json();
      setRecords(data ?? []);
    } catch {
      // silently fail
    }
  }, [leadId]);

  useEffect(() => {
    setLoading(true);
    fetchHistory().finally(() => setLoading(false));
  }, [fetchHistory]);

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Card className="shadow-none rounded-lg py-0">
      <CardHeader className="pt-4 pb-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-2">
            <Clock className="h-3.5 w-3.5" />
            Check-In History
            {!loading && (
              <Badge variant="secondary" className="h-5 px-1.5 text-xs normal-case">
                {records.length}
              </Badge>
            )}
          </span>
        </div>
      </CardHeader>

      <CardContent className="pb-4">
        {loading ? (
          <div className="flex justify-center py-3">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : records.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-2">No check-in visits recorded yet.</p>
        ) : (
          <div className="space-y-2">
            {records.map((record) => {
              const { date, time } = formatDateTime(record.created_at);
              const reasonMatch = record.content.match(/— ([\s\S]+)$/);
              const reason = reasonMatch ? reasonMatch[1] : null;
              const isExpanded = expanded.has(record.id);
              const checkedInBy =
                (record.user_id && (teamMemberNames[record.user_id] ?? teamMemberEmails[record.user_id])) ??
                record.user_email;

              const header = (
                <p className="text-sm font-medium">
                  {date} <span className="text-muted-foreground font-normal">at {time}</span>
                </p>
              );

              return (
                <div key={record.id} className="border rounded-md p-3">
                  {reason ? (
                    <button
                      type="button"
                      onClick={() => toggleExpanded(record.id)}
                      className="flex w-full items-center justify-between gap-2 cursor-pointer text-left"
                    >
                      {header}
                      <ChevronRight
                        className={`h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                      />
                    </button>
                  ) : (
                    header
                  )}
                  {reason ? (
                    isExpanded && (
                      <p className="text-xs text-muted-foreground mt-0.5 whitespace-pre-wrap break-words">{reason}</p>
                    )
                  ) : (
                    <p className="text-xs text-muted-foreground mt-0.5">Walk-in visit</p>
                  )}
                  <p className="text-xs text-muted-foreground mt-0.5">Checked in by {checkedInBy}</p>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function formatDateTime(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
    time: d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
  };
}
