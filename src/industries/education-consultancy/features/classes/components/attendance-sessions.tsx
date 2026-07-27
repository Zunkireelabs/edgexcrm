"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { toast } from "sonner";
import { Loader2, ChevronDown, ChevronRight, Check, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface StudentRow {
  enrollment_id: string;
  name: string;
  cells: Record<string, "present" | "absent">;
}

interface HistoryResponse {
  dates: string[];
  students: StudentRow[];
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

export function AttendanceSessions({ classId, className }: { classId: string; className: string }) {
  const [from, setFrom] = useState(isoDate(new Date(Date.now() - 30 * 86400000)));
  const [to, setTo] = useState(isoDate(new Date()));
  const [loading, setLoading] = useState(false);
  const [dates, setDates] = useState<string[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/classes/${classId}/attendance/history?from=${from}&to=${to}`);
      if (!res.ok) throw new Error("Failed to load sessions");
      const { data } = (await res.json()) as { data: HistoryResponse };
      setDates(data.dates ?? []);
      setStudents(data.students ?? []);
    } catch {
      toast.error("Failed to load sessions");
      setDates([]);
      setStudents([]);
    } finally {
      setLoading(false);
    }
  }, [classId, from, to]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setExpanded(null);
  }, [classId]);

  const perDate = useMemo(() => {
    const map: Record<string, { present: string[]; absent: string[] }> = {};
    for (const d of dates) map[d] = { present: [], absent: [] };
    for (const s of students) {
      for (const d of dates) {
        const status = s.cells[d];
        if (status === "present") map[d].present.push(s.name);
        else if (status === "absent") map[d].absent.push(s.name);
      }
    }
    return map;
  }, [dates, students]);

  const sortedDates = useMemo(() => [...dates].sort().reverse(), [dates]);

  return (
    <div className="flex flex-col h-full min-w-0">
      <div className="flex items-end gap-3 p-3 border-b shrink-0">
        <div className="space-y-1">
          <Label className="text-xs text-gray-600">From</Label>
          <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-gray-600">To</Label>
          <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="w-40" />
        </div>
      </div>

      <div className="flex-1 min-w-0 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : sortedDates.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            No sessions recorded for {className} in this range.
          </p>
        ) : (
          <div className="divide-y">
            {sortedDates.map((d) => {
              const { present, absent } = perDate[d];
              const isOpen = expanded === d;
              return (
                <div key={d}>
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : d)}
                    className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-muted/30 transition-colors"
                  >
                    <span className="flex items-center gap-2 text-sm font-medium">
                      {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                      {longDate(d)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {present.length} present · {absent.length} absent
                    </span>
                  </button>
                  {isOpen && (
                    <div className="px-4 pb-3 pl-9 grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-1">Present</p>
                        {present.length === 0 ? (
                          <p className="text-xs text-muted-foreground">None</p>
                        ) : (
                          <ul className="space-y-1">
                            {present.map((name) => (
                              <li key={name} className="flex items-center gap-1.5 text-sm">
                                <Check className="h-3 w-3 text-green-600 shrink-0" />
                                {name}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-1">Absent</p>
                        {absent.length === 0 ? (
                          <p className="text-xs text-muted-foreground">None</p>
                        ) : (
                          <ul className="space-y-1">
                            {absent.map((name) => (
                              <li key={name} className={cn("flex items-center gap-1.5 text-sm")}>
                                <X className="h-3 w-3 text-red-600 shrink-0" />
                                {name}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
