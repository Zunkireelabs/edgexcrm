"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CalendarDays, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Branch } from "@/types/database";

interface Holiday {
  id: string;
  name: string;
  holiday_date: string;
  branch_id: string | null;
}

const TENANT_DEFAULT = "__tenant_default__";

export function HolidayCalendarsManager() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedCalendar, setSelectedCalendar] = useState(TENANT_DEFAULT);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [createName, setCreateName] = useState("");
  const [createDate, setCreateDate] = useState("");
  const [creating, setCreating] = useState(false);

  const fetchHolidays = useCallback(async (branchId: string) => {
    setLoading(true);
    try {
      const url =
        branchId === TENANT_DEFAULT ? "/api/v1/leave/holidays" : `/api/v1/leave/holidays?branch_id=${branchId}`;
      const res = await fetch(url);
      if (res.ok) {
        const d = await res.json();
        setHolidays(d.data ?? []);
      }
    } catch {
      toast.error("Failed to load holidays");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch("/api/v1/branches")
      .then((r) => r.json())
      .then((d) => setBranches(d.data ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchHolidays(selectedCalendar);
  }, [selectedCalendar, fetchHolidays]);

  async function createHoliday() {
    const name = createName.trim();
    if (!name || !createDate) return;
    setCreating(true);
    try {
      const res = await fetch("/api/v1/leave/holidays", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          holiday_date: createDate,
          branch_id: selectedCalendar === TENANT_DEFAULT ? null : selectedCalendar,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error?.message ?? "Failed to add holiday");
      setHolidays((prev) => [...prev, d.data].sort((a, b) => a.holiday_date.localeCompare(b.holiday_date)));
      setCreateName("");
      setCreateDate("");
      toast.success(`Holiday "${name}" added`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add holiday");
    } finally {
      setCreating(false);
    }
  }

  async function deleteHoliday(id: string, name: string) {
    if (!confirm(`Remove holiday "${name}"?`)) return;
    try {
      const res = await fetch(`/api/v1/leave/holidays/${id}`, { method: "DELETE" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error?.message ?? "Failed to remove holiday");
      setHolidays((prev) => prev.filter((h) => h.id !== id));
      toast.success(`Holiday "${name}" removed`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove holiday");
    }
  }

  // Holidays inherited from the tenant-wide default calendar (shown when viewing a branch calendar).
  const ownHolidays =
    selectedCalendar === TENANT_DEFAULT
      ? holidays
      : holidays.filter((h) => h.branch_id === selectedCalendar);
  const inheritedHolidays =
    selectedCalendar === TENANT_DEFAULT ? [] : holidays.filter((h) => h.branch_id === null);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <CalendarDays className="h-5 w-5" />
          Holiday Calendars
        </CardTitle>
        <CardDescription>
          Holidays are excluded from leave day-counting. Branch calendars inherit the tenant default.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium">Calendar</label>
          <Select value={selectedCalendar} onValueChange={setSelectedCalendar}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TENANT_DEFAULT}>Tenant default</SelectItem>
              {branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="space-y-1">
            {ownHolidays.length === 0 && inheritedHolidays.length === 0 && (
              <p className="text-sm text-muted-foreground">No holidays yet on this calendar.</p>
            )}
            {ownHolidays.map((h) => (
              <div key={h.id} className="flex items-center gap-2 py-2 border-b last:border-0">
                <span className="text-sm font-medium flex-1">{h.name}</span>
                <span className="text-xs text-muted-foreground w-28">{h.holiday_date}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  onClick={() => deleteHoliday(h.id, h.name)}
                  title="Remove"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            {inheritedHolidays.map((h) => (
              <div key={h.id} className="flex items-center gap-2 py-2 border-b last:border-0 opacity-60">
                <span className="text-sm flex-1">{h.name}</span>
                <span className="text-xs text-muted-foreground w-28">{h.holiday_date}</span>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Tenant default
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 pt-2 border-t">
          <Input
            placeholder="Holiday name (e.g. Dashain)"
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            className="flex-1"
          />
          <Input
            type="date"
            value={createDate}
            onChange={(e) => setCreateDate(e.target.value)}
            className="w-40"
          />
          <Button onClick={createHoliday} disabled={creating || !createName.trim() || !createDate} size="sm">
            <Plus className="h-4 w-4 mr-1" />
            {creating ? "Adding…" : "Add"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
