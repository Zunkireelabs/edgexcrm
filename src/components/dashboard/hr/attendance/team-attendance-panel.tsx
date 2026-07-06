"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Loader2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableHeader, TableRow, TableHead, TableBody, TableCell,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { RegularizeDialog } from "./regularize-dialog";
import { STATUS_LABEL, STATUS_VARIANT } from "./types";
import type { MemberAttendance, TodayBoardMember } from "./types";

interface TeamAttendancePanelProps {
  canManageHR: boolean;
}

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

export function TeamAttendancePanel({ canManageHR }: TeamAttendancePanelProps) {
  const [scope, setScope] = useState<"team" | "all">("team");

  const [todayDate, setTodayDate] = useState("");
  const [todayMembers, setTodayMembers] = useState<TodayBoardMember[]>([]);
  const [loadingToday, setLoadingToday] = useState(true);

  const [members, setMembers] = useState<MemberAttendance[]>([]);
  const [monthToday, setMonthToday] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [loadingMonth, setLoadingMonth] = useState(true);

  const [regularizeTarget, setRegularizeTarget] = useState<{ tenantUserId: string; date: string } | null>(null);

  const loadToday = useCallback(async (currentScope: "team" | "all") => {
    setLoadingToday(true);
    try {
      const res = await fetch(`/api/v1/attendance/today?scope=${currentScope}`);
      if (!res.ok) throw new Error("Failed to load today's board");
      const { data } = await res.json();
      setTodayDate(data.date);
      setTodayMembers(data.members ?? []);
    } catch {
      toast.error("Failed to load today's board");
    } finally {
      setLoadingToday(false);
    }
  }, []);

  const loadMonth = useCallback(async (currentScope: "team" | "all") => {
    setLoadingMonth(true);
    try {
      const { from, to } = monthRange();
      const res = await fetch(`/api/v1/attendance?scope=${currentScope}&from=${from}&to=${to}`);
      if (!res.ok) throw new Error("Failed to load attendance");
      const { data } = await res.json();
      setMonthToday(data.today);
      const nextMembers = (data.members ?? []) as MemberAttendance[];
      setMembers(nextMembers);
      setSelectedId((prev) => (nextMembers.some((m) => m.tenant_user_id === prev) ? prev : nextMembers[0]?.tenant_user_id ?? ""));
    } catch {
      toast.error("Failed to load attendance");
    } finally {
      setLoadingMonth(false);
    }
  }, []);

  useEffect(() => {
    loadToday(scope);
    loadMonth(scope);
  }, [scope, loadToday, loadMonth]);

  function handleRegularized() {
    setRegularizeTarget(null);
    loadToday(scope);
    loadMonth(scope);
  }

  const selectedMember = members.find((m) => m.tenant_user_id === selectedId) ?? null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Team Attendance</h2>
        {canManageHR && (
          <Select value={scope} onValueChange={(v) => setScope(v as "team" | "all")}>
            <SelectTrigger className="w-40 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="team">My reports</SelectItem>
              <SelectItem value="all">All (tenant)</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>

      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-2">
          Today{todayDate ? ` (${todayDate})` : ""}
        </h3>
        {loadingToday ? (
          <div className="flex items-center justify-center min-h-24">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : todayMembers.length === 0 ? (
          <p className="text-sm text-muted-foreground">No team members found.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Clock in</TableHead>
                <TableHead>Clock out</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {todayMembers.map((m) => (
                <TableRow key={m.tenant_user_id}>
                  <TableCell className="text-sm">{m.name ?? m.email}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[m.status] ?? "outline"}>{STATUS_LABEL[m.status] ?? m.status}</Badge>
                  </TableCell>
                  <TableCell className="text-sm">{formatTime(m.clock_in_at)}</TableCell>
                  <TableCell className="text-sm">{formatTime(m.clock_out_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-muted-foreground">Month view</h3>
          {members.length > 0 && (
            <Select value={selectedId} onValueChange={setSelectedId}>
              <SelectTrigger className="w-56 h-8 text-xs">
                <SelectValue placeholder="Select a member" />
              </SelectTrigger>
              <SelectContent>
                {members.map((m) => (
                  <SelectItem key={m.tenant_user_id} value={m.tenant_user_id}>
                    {m.name ?? m.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        {loadingMonth ? (
          <div className="flex items-center justify-center min-h-24">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !selectedMember ? (
          <p className="text-sm text-muted-foreground">No team members found.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Clock in</TableHead>
                <TableHead>Clock out</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {selectedMember.days.map((d) => (
                <TableRow key={d.date} className={d.date === monthToday ? "bg-muted/40" : undefined}>
                  <TableCell className="text-sm">{d.date}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[d.status] ?? "outline"}>{STATUS_LABEL[d.status] ?? d.status}</Badge>
                  </TableCell>
                  <TableCell className="text-sm">{formatTime(d.clock_in_at)}</TableCell>
                  <TableCell className="text-sm">{formatTime(d.clock_out_at)}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setRegularizeTarget({ tenantUserId: selectedMember.tenant_user_id, date: d.date })}
                      title="Regularize"
                    >
                      <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {regularizeTarget && (
        <RegularizeDialog
          open={!!regularizeTarget}
          tenantUserId={regularizeTarget.tenantUserId}
          date={regularizeTarget.date}
          memberName={selectedMember?.name ?? selectedMember?.email ?? ""}
          existingDay={selectedMember?.days.find((d) => d.date === regularizeTarget.date) ?? null}
          onClose={() => setRegularizeTarget(null)}
          onSaved={handleRegularized}
        />
      )}
    </div>
  );
}
