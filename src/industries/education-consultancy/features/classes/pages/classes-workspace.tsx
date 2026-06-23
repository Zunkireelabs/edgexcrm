"use client";

import { useState, useMemo, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Users } from "lucide-react";
import { useSettingsModal } from "@/contexts/settings-modal-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EnrollStudentSheet } from "../components/enroll-student-sheet";

interface ClassRow {
  id: string;
  name: string;
  default_fee: number | null;
  is_active: boolean;
}

interface Enrollment {
  id: string;
  lead_id: string;
  class_id: string;
  fee_paid: boolean;
  fee_amount: number | null;
  created_at: string;
  leads?: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    assigned_to: string | null;
  } | null;
}

interface ClassesWorkspaceProps {
  classes: ClassRow[];
  enrollments: Array<Record<string, unknown>>;
  canManage: boolean;
  tenantId: string;
}

export function ClassesWorkspace({ classes, enrollments: initialEnrollments, canManage }: ClassesWorkspaceProps) {
  const router = useRouter();
  const { openSettings } = useSettingsModal();
  const [selectedClassId, setSelectedClassId] = useState<string | null>(classes[0]?.id ?? null);
  const [enrollOpen, setEnrollOpen] = useState(false);

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

  // Roster for the selected class
  const roster = useMemo(() => {
    if (!selectedClassId) return [];
    return enrollmentsByClass[selectedClassId] ?? [];
  }, [selectedClassId, enrollmentsByClass]);

  const selectedClass = classes.find((c) => c.id === selectedClassId);

  const handleRefresh = useCallback(() => {
    router.refresh();
  }, [router]);

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
        {canManage && (
          <Button size="sm" onClick={() => setEnrollOpen(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            Enroll Student
          </Button>
        )}
      </div>

      {/* Master–detail layout */}
      <div className="flex flex-1 min-h-0 gap-4">
        {/* Left: class list */}
        <div className="w-64 shrink-0 border rounded-lg overflow-y-auto">
          <div className="p-3 border-b flex items-center justify-between">
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
            <div className="divide-y">
              {classes.map((cls) => {
                const count = (enrollmentsByClass[cls.id] ?? []).length;
                const isActive = cls.id === selectedClassId;
                return (
                  <button
                    key={cls.id}
                    type="button"
                    onClick={() => setSelectedClassId(cls.id)}
                    className={`w-full flex items-center justify-between px-3 py-2.5 text-left transition-colors ${
                      isActive ? "bg-primary/5 border-l-2 border-primary" : "hover:bg-muted/40"
                    }`}
                  >
                    <span className={`text-sm font-medium truncate ${isActive ? "text-primary" : ""}`}>
                      {cls.name}
                    </span>
                    <Badge variant="secondary" className="h-5 px-1.5 text-xs ml-2 shrink-0">
                      {count}
                    </Badge>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: roster */}
        <div className="flex-1 min-h-0 border rounded-lg flex flex-col">
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
                {canManage && (
                  <Button size="sm" variant="outline" onClick={() => setEnrollOpen(true)}>
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    Enroll
                  </Button>
                )}
              </div>

              {roster.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground">
                  <Users className="h-8 w-8 opacity-30" />
                  <p className="text-sm">No students enrolled yet.</p>
                  {canManage && (
                    <Button size="sm" variant="outline" onClick={() => setEnrollOpen(true)}>
                      <Plus className="h-3.5 w-3.5 mr-1" />
                      Enroll first student
                    </Button>
                  )}
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-card border-b">
                      <tr className="text-left text-xs text-muted-foreground">
                        <th className="px-4 py-2 font-medium">Student</th>
                        <th className="px-4 py-2 font-medium">Fee</th>
                        <th className="px-4 py-2 font-medium">Enrolled</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {roster.map((enrollment) => {
                        const lead = enrollment.leads;
                        const name = lead
                          ? [lead.first_name, lead.last_name].filter(Boolean).join(" ") || lead.email || "Unknown"
                          : "Unknown";
                        return (
                          <tr key={enrollment.id} className="hover:bg-muted/30 transition-colors">
                            <td className="px-4 py-2.5">
                              <Link
                                href={`/leads/${enrollment.lead_id}`}
                                className="font-medium hover:underline text-foreground"
                              >
                                {name}
                              </Link>
                              {lead?.email && (
                                <p className="text-xs text-muted-foreground">{lead.email}</p>
                              )}
                            </td>
                            <td className="px-4 py-2.5">
                              {enrollment.fee_paid ? (
                                <div className="flex items-center gap-1.5">
                                  <Badge variant="secondary" className="text-xs bg-green-50 text-green-700 border-green-200">
                                    Paid
                                  </Badge>
                                  {enrollment.fee_amount != null && (
                                    <span className="text-xs text-muted-foreground">
                                      {enrollment.fee_amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <Badge variant="outline" className="text-xs text-muted-foreground">
                                  Unpaid
                                </Badge>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-xs text-muted-foreground">
                              {new Date(enrollment.created_at).toLocaleDateString(undefined, {
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
    </div>
  );
}
