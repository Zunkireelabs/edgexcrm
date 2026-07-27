"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { toast } from "sonner";
import { Loader2, Check, X, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface StudentRow {
  enrollment_id: string;
  lead_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  cells: Record<string, "present" | "absent">;
  present: number;
  absent: number;
  pct: number | null;
}

interface HistoryResponse {
  dates: string[];
  students: StudentRow[];
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function shortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${m}/${d}`;
}

export function AttendanceHistory({ classId, className }: { classId: string; className: string }) {
  const [from, setFrom] = useState(isoDate(new Date(Date.now() - 30 * 86400000)));
  const [to, setTo] = useState(isoDate(new Date()));
  const [loading, setLoading] = useState(false);
  const [dates, setDates] = useState<string[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/classes/${classId}/attendance/history?from=${from}&to=${to}`);
      if (!res.ok) throw new Error("Failed to load attendance history");
      const { data } = (await res.json()) as { data: HistoryResponse };
      setDates(data.dates ?? []);
      setStudents(data.students ?? []);
    } catch {
      toast.error("Failed to load attendance history");
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
    setSearch("");
  }, [classId]);

  const filteredStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return students;
    return students.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.email ?? "").toLowerCase().includes(q) ||
        (s.phone ?? "").toLowerCase().includes(q)
    );
  }, [students, search]);

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
        <div className="space-y-1 flex-1 max-w-xs">
          <Label className="text-xs text-gray-600">Search</Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, email, or phone..."
              className="pl-8"
            />
          </div>
        </div>
        {!loading && dates.length > 0 && (
          <p className="text-xs text-muted-foreground whitespace-nowrap pb-2">
            {dates.length} session{dates.length !== 1 ? "s" : ""} in range
          </p>
        )}
      </div>

      <div className="flex-1 min-w-0 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : students.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">No students enrolled in this class.</p>
        ) : filteredStudents.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">No students match &quot;{search}&quot;.</p>
        ) : dates.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            No attendance recorded for {className} in this range.
          </p>
        ) : (
          <table className="text-sm border-separate border-spacing-0">
            <thead className="sticky top-0 bg-card">
              <tr className="text-xs text-muted-foreground">
                <th className="sticky left-0 bg-card px-4 py-2 text-left font-medium border-b">Student</th>
                {dates.map((d) => (
                  <th key={d} className="px-2 py-2 font-medium border-b whitespace-nowrap">{shortDate(d)}</th>
                ))}
                <th className="px-3 py-2 font-medium border-b">Present</th>
                <th className="px-3 py-2 font-medium border-b">Absent</th>
                <th className="px-3 py-2 font-medium border-b">%</th>
              </tr>
            </thead>
            <tbody>
              {filteredStudents.map((s) => (
                <tr key={s.enrollment_id} className="hover:bg-muted/30">
                  <td className="sticky left-0 bg-card px-4 py-2 font-medium border-b whitespace-nowrap">
                    {s.name}
                    {s.email && <p className="text-xs font-normal text-muted-foreground">{s.email}</p>}
                  </td>
                  {dates.map((d) => {
                    const status = s.cells[d];
                    return (
                      <td key={d} className="px-2 py-2 text-center border-b">
                        {status === "present" ? (
                          <Check className="h-3.5 w-3.5 text-green-600 inline" />
                        ) : status === "absent" ? (
                          <X className="h-3.5 w-3.5 text-red-600 inline" />
                        ) : (
                          <span className="text-muted-foreground">–</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-center border-b">{s.present}</td>
                  <td className="px-3 py-2 text-center border-b">{s.absent}</td>
                  <td className={cn("px-3 py-2 text-center border-b font-medium", s.pct === null && "text-muted-foreground")}>
                    {s.pct === null ? "–" : `${s.pct}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
