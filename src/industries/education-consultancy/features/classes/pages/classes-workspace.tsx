"use client";

import { useState, useMemo, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Users, ClipboardCheck, Pencil, Loader2, Search, ArrowRight, TrendingUp, Wallet, CircleDollarSign } from "lucide-react";
import { useSettingsModal } from "@/contexts/settings-modal-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EnrollStudentSheet } from "../components/enroll-student-sheet";
import { AttendanceSheet } from "../components/attendance-sheet";
import { AttendanceHistory } from "../components/attendance-history";
import { AttendanceSessions } from "../components/attendance-sessions";
import { cn } from "@/lib/utils";

interface ClassRow {
  id: string;
  name: string;
  default_fee: number | null;
  is_active: boolean;
  end_date: string | null;
}

interface Enrollment {
  id: string;
  lead_id: string;
  class_id: string;
  fee_paid: boolean;
  fee_amount: number | null;
  enrollment_type: "demo" | "actual";
  status: "active" | "inactive" | "completed";
  created_at: string;
  leads?: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    assigned_to: string | null;
  } | null;
}

interface StudentRoster {
  leadId: string;
  demo: Enrollment | null;
  actual: Enrollment | null;
  /** Row used for the Status/Fee/Enrolled columns and the edit dialog — actual enrollment
   * takes precedence since that's the real class the fee/status is tracked against. */
  primary: Enrollment;
}

interface ClassesWorkspaceProps {
  classes: ClassRow[];
  enrollments: Array<Record<string, unknown>>;
  canManage: boolean;
  canEnroll: boolean;
  canMarkAttendance: boolean;
  tenantId: string;
  /** Owner-only, computed server-side in page.tsx — see comment there for why. */
  canSeeFeesTotals: boolean;
  feesCollected: number | null;
  classFeePct: Record<string, number | null> | null;
}

export function ClassesWorkspace({ classes, enrollments: initialEnrollments, canManage, canEnroll, canMarkAttendance, canSeeFeesTotals, feesCollected, classFeePct }: ClassesWorkspaceProps) {
  const router = useRouter();
  const { openSettings } = useSettingsModal();
  const [selectedClassId, setSelectedClassId] = useState<string | null>(classes[0]?.id ?? null);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [attendanceOpen, setAttendanceOpen] = useState(false);
  const [detailTab, setDetailTab] = useState<"roster" | "attendance" | "sessions">("roster");
  const [editFeeTarget, setEditFeeTarget] = useState<Enrollment | null>(null);
  const [editFeePaid, setEditFeePaid] = useState(false);
  const [editFeeAmount, setEditFeeAmount] = useState("");
  const [editFeeSubmitting, setEditFeeSubmitting] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"active" | "inactive" | "completed">("active");
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null);
  const [convertingLeadId, setConvertingLeadId] = useState<string | null>(null);
  const [rosterSearch, setRosterSearch] = useState("");

  const enrollments = initialEnrollments as unknown as Enrollment[];

  // Group enrollments by class_id
  const enrollmentsByClass = useMemo(() => {
    const map: Record<string, Enrollment[]> = {};
    for (const e of enrollments) {
      if (!map[e.class_id]) map[e.class_id] = [];
      map[e.class_id].push(e);
    }
    return map;
  }, [enrollments]);

  // Roster for the selected class — one row per student, pairing their demo and
  // actual enrollment (a student may hold either or both for the same class).
  const roster = useMemo((): StudentRoster[] => {
    if (!selectedClassId) return [];
    const list = enrollmentsByClass[selectedClassId] ?? [];
    const byLead = new Map<string, { demo: Enrollment | null; actual: Enrollment | null }>();
    for (const e of list) {
      const entry = byLead.get(e.lead_id) ?? { demo: null, actual: null };
      if (e.enrollment_type === "demo") entry.demo = e;
      else entry.actual = e;
      byLead.set(e.lead_id, entry);
    }
    return Array.from(byLead.entries()).map(([leadId, { demo, actual }]) => ({
      leadId,
      demo,
      actual,
      primary: (actual ?? demo)!,
    }));
  }, [selectedClassId, enrollmentsByClass]);

  const rosterCounts = useMemo(() => {
    const counts = { active: 0, inactive: 0, completed: 0 };
    for (const row of roster) counts[row.primary.status]++;
    return counts;
  }, [roster]);

  const filteredRoster = useMemo(() => {
    const term = rosterSearch.trim().toLowerCase();
    return roster.filter((row) => {
      if (row.primary.status !== statusFilter) return false;
      if (!term) return true;
      const lead = row.primary.leads;
      const name = lead ? [lead.first_name, lead.last_name].filter(Boolean).join(" ") : "";
      return name.toLowerCase().includes(term) || (lead?.email ?? "").toLowerCase().includes(term);
    });
  }, [roster, statusFilter, rosterSearch]);

  const selectedClass = classes.find((c) => c.id === selectedClassId);

  // Workspace-wide stats — computed client-side from the already-fetched enrollments,
  // no extra API call. "Active students" counts unique leads (a student with both a
  // demo and actual row for one class counts once).
  const workspaceStats = useMemo(() => {
    const activeLeadIds = new Set<string>();
    let demoCount = 0;
    let demoConvertedCount = 0;
    let unpaidActiveCount = 0;
    const byLeadClass = new Map<string, { demo: boolean; actual: boolean }>();

    for (const e of enrollments) {
      if (e.status === "active") activeLeadIds.add(e.lead_id);
      if (e.status === "active" && !e.fee_paid) unpaidActiveCount++;

      const key = `${e.lead_id}:${e.class_id}`;
      const entry = byLeadClass.get(key) ?? { demo: false, actual: false };
      if (e.enrollment_type === "demo") entry.demo = true;
      else entry.actual = true;
      byLeadClass.set(key, entry);
    }
    for (const { demo, actual } of byLeadClass.values()) {
      if (demo) {
        demoCount++;
        if (actual) demoConvertedCount++;
      }
    }

    return {
      activeStudents: activeLeadIds.size,
      conversionRate: demoCount > 0 ? Math.round((demoConvertedCount / demoCount) * 100) : null,
      unpaidActiveCount,
    };
  }, [enrollments]);

  const classStats = useMemo(() => {
    const map: Record<string, { count: number }> = {};
    for (const cls of classes) {
      const list = enrollmentsByClass[cls.id] ?? [];
      map[cls.id] = { count: new Set(list.map((e) => e.lead_id)).size };
    }
    return map;
  }, [classes, enrollmentsByClass]);

  function endDateBadge(endDate: string | null): { label: string; tone: "ok" | "soon" | "none" } {
    if (!endDate) return { label: "Ongoing", tone: "none" };
    const days = Math.ceil((new Date(endDate).getTime() - Date.now()) / 86400000);
    if (days < 0) return { label: "Ended", tone: "soon" };
    if (days <= 14) return { label: `Ends in ${days}d`, tone: "soon" };
    return { label: `Ends in ${days}d`, tone: "ok" };
  }

  const handleRefresh = useCallback(() => {
    router.refresh();
  }, [router]);

  function openEditFee(enrollment: Enrollment) {
    setEditFeeTarget(enrollment);
    setEditFeePaid(enrollment.fee_paid);
    setEditFeeAmount(enrollment.fee_amount != null ? String(enrollment.fee_amount) : "");
  }

  async function handleStatusChange(enrollment: Enrollment, status: "active" | "inactive" | "completed") {
    if (status === enrollment.status) return;
    setStatusUpdatingId(enrollment.id);
    try {
      const res = await fetch(`/api/v1/class-enrollments/${enrollment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Failed to update status");
      toast.success("Status updated");
      handleRefresh();
    } catch {
      toast.error("Failed to update status");
    } finally {
      setStatusUpdatingId(null);
    }
  }

  async function handleConvertToActual(row: StudentRoster) {
    if (!selectedClassId || !row.demo) return;
    setConvertingLeadId(row.leadId);
    try {
      const res = await fetch("/api/v1/class-enrollments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_id: row.leadId,
          class_id: selectedClassId,
          enrollment_type: "actual",
          fee_paid: row.demo.fee_paid,
          fee_amount: row.demo.fee_amount,
        }),
      });
      if (!res.ok) throw new Error("Failed to convert");
      toast.success("Converted to actual class");
      handleRefresh();
    } catch {
      toast.error("Failed to convert to actual class");
    } finally {
      setConvertingLeadId(null);
    }
  }

  async function handleSaveFee() {
    if (!editFeeTarget) return;
    setEditFeeSubmitting(true);
    try {
      const res = await fetch(`/api/v1/class-enrollments/${editFeeTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fee_paid: editFeePaid,
          fee_amount: editFeeAmount.trim() ? Number(editFeeAmount) : null,
        }),
      });
      if (!res.ok) throw new Error("Failed to update");
      toast.success("Fee updated");
      setEditFeeTarget(null);
      handleRefresh();
    } catch {
      toast.error("Failed to update fee");
    } finally {
      setEditFeeSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-3">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-xl font-bold">Classes</h1>
          <p className="text-sm text-muted-foreground">
            {classes.length} class{classes.length !== 1 ? "es" : ""}
          </p>
        </div>
        {canEnroll && (
          <Button size="sm" onClick={() => setEnrollOpen(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            Enroll Student
          </Button>
        )}
      </div>

      {/* Stat strip */}
      <div
        className={cn(
          "grid gap-px bg-border border rounded-lg overflow-hidden shrink-0",
          canSeeFeesTotals ? "grid-cols-4" : "grid-cols-3"
        )}
      >
        <div className="bg-card px-4 py-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium mb-1 flex items-center gap-1.5">
            <Users className="h-3 w-3" /> Active students
          </div>
          <div className="text-xl font-semibold tabular-nums">{workspaceStats.activeStudents}</div>
        </div>
        <div className="bg-card px-4 py-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium mb-1 flex items-center gap-1.5">
            <TrendingUp className="h-3 w-3" /> Demo → Actual rate
          </div>
          <div className="text-xl font-semibold tabular-nums">
            {workspaceStats.conversionRate == null ? "—" : `${workspaceStats.conversionRate}%`}
          </div>
        </div>
        {canSeeFeesTotals && (
          <div className="bg-card px-4 py-3">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium mb-1 flex items-center gap-1.5">
              <Wallet className="h-3 w-3" /> Fees collected
            </div>
            <div className="text-xl font-semibold tabular-nums">
              {(feesCollected ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </div>
          </div>
        )}
        <div className="bg-card px-4 py-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium mb-1 flex items-center gap-1.5">
            <CircleDollarSign className="h-3 w-3" /> Unpaid (active)
          </div>
          <div className="text-xl font-semibold tabular-nums">{workspaceStats.unpaidActiveCount}</div>
        </div>
      </div>

      {/* Master–detail layout */}
      <div className="flex flex-1 min-h-0 gap-4">
        {/* Left: class list */}
        <div className="w-72 shrink-0 border rounded-lg overflow-y-auto p-2 space-y-2">
          <div className="px-1 py-1 flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">All Classes</span>
            {canManage && (
              <button type="button" onClick={() => openSettings("academic-operations")} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                Manage →
              </button>
            )}
          </div>
          {classes.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center p-4">
              No classes yet.{" "}
              {canManage && (
                <button type="button" onClick={() => openSettings("academic-operations")} className="underline">Add one in Settings.</button>
              )}
            </p>
          ) : (
            classes.map((cls) => {
              const count = classStats[cls.id]?.count ?? 0;
              const feePct = classFeePct?.[cls.id] ?? null;
              const isActive = cls.id === selectedClassId;
              const badge = endDateBadge(cls.end_date);
              return (
                <button
                  key={cls.id}
                  type="button"
                  onClick={() => setSelectedClassId(cls.id)}
                  className={cn(
                    "w-full text-left rounded-lg border px-3.5 py-3 transition-colors",
                    isActive ? "border-primary bg-primary/5 shadow-sm" : "border-border hover:bg-muted/40"
                  )}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className={cn("text-sm font-semibold truncate", isActive && "text-primary")}>{cls.name}</span>
                    <span
                      className={cn(
                        "text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ml-2",
                        badge.tone === "ok" && "bg-green-50 text-green-700",
                        badge.tone === "soon" && "bg-amber-50 text-amber-700",
                        badge.tone === "none" && "bg-muted text-muted-foreground"
                      )}
                    >
                      {badge.label}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground mb-2">
                    <b className="text-foreground font-medium">{count}</b> student{count !== 1 ? "s" : ""}
                    {cls.default_fee != null && (
                      <> · {cls.default_fee.toLocaleString(undefined, { maximumFractionDigits: 0 })} fee</>
                    )}
                  </div>
                  {canSeeFeesTotals && (
                    <>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-green-600 transition-all"
                          style={{ width: feePct != null ? `${feePct}%` : "0%" }}
                        />
                      </div>
                      <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                        <span>Fees collected</span>
                        <span>{feePct != null ? `${feePct}%` : "—"}</span>
                      </div>
                    </>
                  )}
                </button>
              );
            })
          )}
        </div>

        {/* Right: roster */}
        <div className="flex-1 min-h-0 min-w-0 border rounded-lg flex flex-col">
          {!selectedClass ? (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
              Select a class to see the roster.
            </div>
          ) : (
            <>
              <div className="p-3 border-b flex items-center justify-between shrink-0">
                <div>
                  <span className="text-sm font-semibold">{selectedClass.name}</span>
                  <span className="text-xs text-muted-foreground ml-2">{roster.length} student{roster.length !== 1 ? "s" : ""}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="inline-flex rounded-md border p-0.5">
                    <button
                      type="button"
                      onClick={() => setDetailTab("roster")}
                      className={cn(
                        "px-2.5 py-1 text-xs font-medium rounded-sm transition-colors",
                        detailTab === "roster" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"
                      )}
                    >
                      All
                    </button>
                    <button
                      type="button"
                      onClick={() => setDetailTab("attendance")}
                      className={cn(
                        "px-2.5 py-1 text-xs font-medium rounded-sm transition-colors",
                        detailTab === "attendance" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"
                      )}
                    >
                      Attendance
                    </button>
                    <button
                      type="button"
                      onClick={() => setDetailTab("sessions")}
                      className={cn(
                        "px-2.5 py-1 text-xs font-medium rounded-sm transition-colors",
                        detailTab === "sessions" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"
                      )}
                    >
                      Sessions
                    </button>
                  </div>
                  {canMarkAttendance && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setDetailTab("attendance");
                        setAttendanceOpen(true);
                      }}
                    >
                      <ClipboardCheck className="h-3.5 w-3.5 mr-1" />
                      Take attendance
                    </Button>
                  )}
                  {canEnroll && (
                    <Button size="sm" variant="outline" onClick={() => setEnrollOpen(true)}>
                      <Plus className="h-3.5 w-3.5 mr-1" />
                      Enroll
                    </Button>
                  )}
                </div>
              </div>

              {detailTab === "roster" ? (
                roster.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground">
                    <Users className="h-8 w-8 opacity-30" />
                    <p className="text-sm">No students enrolled yet.</p>
                    {canEnroll && (
                      <Button size="sm" variant="outline" onClick={() => setEnrollOpen(true)}>
                        <Plus className="h-3.5 w-3.5 mr-1" />
                        Enroll first student
                      </Button>
                    )}
                  </div>
                ) : (
                  <>
                    {/* Status filter — Active/Inactive/Completed are separate views, not mixed in one table */}
                    <div className="flex items-center justify-between gap-3 px-3 py-2 border-b shrink-0 flex-wrap">
                      <div className="flex items-center gap-1">
                        {(["active", "inactive", "completed"] as const).map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => setStatusFilter(s)}
                            className={cn(
                              "flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors capitalize",
                              statusFilter === s ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"
                            )}
                          >
                            {s}
                            <span className="text-[10px] bg-muted rounded-full px-1.5 py-0.5 text-muted-foreground">
                              {rosterCounts[s]}
                            </span>
                          </button>
                        ))}
                      </div>
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                        <Input
                          value={rosterSearch}
                          onChange={(e) => setRosterSearch(e.target.value)}
                          placeholder="Search students…"
                          className="h-7 pl-8 text-xs w-[200px]"
                        />
                      </div>
                    </div>

                    {filteredRoster.length === 0 ? (
                      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
                        No {statusFilter} students.
                      </div>
                    ) : (
                  <div className="flex-1 overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-card border-b">
                        <tr className="text-left text-xs text-muted-foreground">
                          <th className="px-4 py-2 font-medium">Student</th>
                          <th className="px-4 py-2 font-medium">Progress</th>
                          <th className="px-4 py-2 font-medium">Status</th>
                          <th className="px-4 py-2 font-medium">Fee</th>
                          <th className="px-4 py-2 font-medium">Enrolled</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {filteredRoster.map((row) => {
                          const { demo, actual, primary } = row;
                          const lead = primary.leads;
                          const name = lead
                            ? [lead.first_name, lead.last_name].filter(Boolean).join(" ") || lead.email || "Unknown"
                            : "Unknown";
                          return (
                            <tr key={row.leadId} className="hover:bg-muted/30 transition-colors">
                              <td className="px-4 py-2.5">
                                <Link
                                  href={`/leads/${row.leadId}`}
                                  prefetch={false}
                                  className="font-medium hover:underline text-foreground"
                                >
                                  {name}
                                </Link>
                                {lead?.email && (
                                  <p className="text-xs text-muted-foreground">{lead.email}</p>
                                )}
                              </td>
                              <td className="px-4 py-2.5">
                                <div className="flex items-center gap-1.5 text-xs">
                                  {demo ? (
                                    <span className="flex items-center gap-1 text-muted-foreground">
                                      <span className="h-1.5 w-1.5 rounded-full bg-green-600" />
                                      {new Date(demo.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                                    </span>
                                  ) : (
                                    <span className="text-muted-foreground italic">No demo</span>
                                  )}
                                  <ArrowRight className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                                  {actual ? (
                                    <span className="flex items-center gap-1 text-muted-foreground">
                                      <span className="h-1.5 w-1.5 rounded-full bg-green-600" />
                                      {new Date(actual.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                                    </span>
                                  ) : demo && canEnroll ? (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-6 px-2 text-xs border-dashed"
                                      disabled={convertingLeadId === row.leadId}
                                      onClick={() => handleConvertToActual(row)}
                                    >
                                      {convertingLeadId === row.leadId && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                                      Convert
                                    </Button>
                                  ) : (
                                    <span className="text-muted-foreground">—</span>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-2.5">
                                {canEnroll ? (
                                  <Select
                                    value={primary.status}
                                    onValueChange={(v) => handleStatusChange(primary, v as "active" | "inactive" | "completed")}
                                    disabled={statusUpdatingId === primary.id}
                                  >
                                    <SelectTrigger
                                      size="sm"
                                      className={cn(
                                        "h-6 text-xs w-[104px] capitalize border-0",
                                        primary.status === "active"
                                          ? "bg-green-50 text-green-700"
                                          : primary.status === "completed"
                                          ? "bg-blue-50 text-blue-700"
                                          : "bg-muted text-muted-foreground"
                                      )}
                                    >
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="active">Active</SelectItem>
                                      <SelectItem value="inactive">Inactive</SelectItem>
                                      <SelectItem value="completed">Completed</SelectItem>
                                    </SelectContent>
                                  </Select>
                                ) : primary.status === "active" ? (
                                  <Badge variant="secondary" className="text-xs bg-green-50 text-green-700 border-green-200 capitalize">
                                    {primary.status}
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="text-xs text-muted-foreground capitalize">
                                    {primary.status}
                                  </Badge>
                                )}
                              </td>
                              <td className="px-4 py-2.5">
                                <div className="flex items-center gap-1.5">
                                  {primary.fee_paid ? (
                                    <Badge variant="secondary" className="text-xs bg-green-50 text-green-700 border-green-200">
                                      Paid
                                    </Badge>
                                  ) : (
                                    <Badge variant="outline" className="text-xs text-muted-foreground">
                                      Unpaid
                                    </Badge>
                                  )}
                                  {primary.fee_amount != null && (
                                    <span className="text-xs text-muted-foreground">
                                      {primary.fee_amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                                    </span>
                                  )}
                                  {canEnroll && (
                                    <button
                                      type="button"
                                      onClick={() => openEditFee(primary)}
                                      className="text-muted-foreground hover:text-foreground transition-colors"
                                      title="Edit fee"
                                    >
                                      <Pencil className="h-3 w-3" />
                                    </button>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-2.5 text-xs text-muted-foreground">
                                {new Date(primary.created_at).toLocaleDateString(undefined, {
                                  month: "short",
                                  day: "numeric",
                                  year: "numeric",
                                })}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                    )}
                  </>
                )
              ) : detailTab === "attendance" ? (
                <AttendanceHistory classId={selectedClass.id} className={selectedClass.name} />
              ) : (
                <AttendanceSessions classId={selectedClass.id} className={selectedClass.name} />
              )}
            </>
          )}
        </div>
      </div>

      <EnrollStudentSheet
        open={enrollOpen}
        onOpenChange={setEnrollOpen}
        classes={classes}
        defaultClassId={selectedClassId ?? undefined}
        onSuccess={() => {
          setEnrollOpen(false);
          handleRefresh();
        }}
      />

      {selectedClass && (
        <AttendanceSheet
          open={attendanceOpen}
          onOpenChange={setAttendanceOpen}
          classId={selectedClass.id}
          className={selectedClass.name}
        />
      )}

      <Dialog open={!!editFeeTarget} onOpenChange={(open) => !open && setEditFeeTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit fee</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-gray-600">Fee</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={editFeePaid ? "default" : "outline"}
                  className="flex-1"
                  onClick={() => setEditFeePaid(true)}
                >
                  Paid
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={!editFeePaid ? "default" : "outline"}
                  className="flex-1"
                  onClick={() => setEditFeePaid(false)}
                >
                  Unpaid
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-gray-600">Amount received</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={editFeeAmount}
                onChange={(e) => setEditFeeAmount(e.target.value)}
                placeholder="0.00"
              />
              <p className="text-xs text-muted-foreground">
                Leave blank to clear. Enter what&apos;s been received so far — doesn&apos;t need to match the full class fee (e.g. an advance/partial payment).
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditFeeTarget(null)} disabled={editFeeSubmitting}>
              Cancel
            </Button>
            <Button onClick={handleSaveFee} disabled={editFeeSubmitting}>
              {editFeeSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
