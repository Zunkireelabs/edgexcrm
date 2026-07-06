"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Loader2, LogIn, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableHeader, TableRow, TableHead, TableBody, TableCell,
} from "@/components/ui/table";
import { STATUS_LABEL, STATUS_VARIANT } from "./types";
import type { AttendanceDay, MemberAttendance } from "./types";

function monthRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { from: fmt(from), to: fmt(to) };
}

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function MyAttendancePanel() {
  const [member, setMember] = useState<MemberAttendance | null>(null);
  const [today, setToday] = useState("");
  const [loading, setLoading] = useState(true);
  const [clocking, setClocking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { from, to } = monthRange();
      const res = await fetch(`/api/v1/attendance?scope=mine&from=${from}&to=${to}`);
      if (!res.ok) throw new Error("Failed to load attendance");
      const { data } = await res.json();
      setToday(data.today);
      setMember((data.members?.[0] as MemberAttendance) ?? null);
    } catch {
      toast.error("Failed to load attendance");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const todayEntry: AttendanceDay | undefined = member?.days.find((d) => d.date === today);

  async function handleClockIn() {
    setClocking(true);
    try {
      const res = await fetch("/api/v1/attendance/clock-in", { method: "POST" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error?.message ?? "Failed to clock in");
      toast.success("Clocked in");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to clock in");
    } finally {
      setClocking(false);
    }
  }

  async function handleClockOut() {
    setClocking(true);
    try {
      const res = await fetch("/api/v1/attendance/clock-out", { method: "POST" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error?.message ?? "Failed to clock out");
      toast.success("Clocked out");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to clock out");
    } finally {
      setClocking(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-48">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const clockedIn = !!todayEntry?.clock_in_at;
  const clockedOut = !!todayEntry?.clock_out_at;

  return (
    <div className="space-y-5">
      <h2 className="text-base font-semibold">My Attendance</h2>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Today</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between flex-wrap gap-3">
          <div className="text-sm text-muted-foreground">
            {clockedIn ? (
              <>
                Clocked in at <span className="font-medium text-foreground">{formatTime(todayEntry?.clock_in_at ?? null)}</span>
                {clockedOut && (
                  <>
                    {" "}
                    · Clocked out at{" "}
                    <span className="font-medium text-foreground">{formatTime(todayEntry?.clock_out_at ?? null)}</span>
                  </>
                )}
              </>
            ) : (
              "You haven't clocked in today."
            )}
          </div>
          {!clockedIn ? (
            <Button size="sm" onClick={handleClockIn} disabled={clocking}>
              {clocking ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <LogIn className="h-4 w-4 mr-1.5" />}
              Clock In
            </Button>
          ) : !clockedOut ? (
            <Button size="sm" variant="outline" onClick={handleClockOut} disabled={clocking}>
              {clocking ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <LogOut className="h-4 w-4 mr-1.5" />}
              Clock Out
            </Button>
          ) : (
            <Badge variant="outline">Day complete</Badge>
          )}
        </CardContent>
      </Card>

      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-2">This month</h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Clock in</TableHead>
              <TableHead>Clock out</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(member?.days ?? []).map((d) => (
              <TableRow key={d.date} className={d.date === today ? "bg-muted/40" : undefined}>
                <TableCell className="text-sm">{d.date}</TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[d.status] ?? "outline"}>{STATUS_LABEL[d.status] ?? d.status}</Badge>
                </TableCell>
                <TableCell className="text-sm">{formatTime(d.clock_in_at)}</TableCell>
                <TableCell className="text-sm">{formatTime(d.clock_out_at)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
