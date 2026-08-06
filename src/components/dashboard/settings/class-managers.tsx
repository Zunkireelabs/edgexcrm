"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { UserCog } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface TeamMember {
  user_id: string;
  role: string;
  name: string | null;
  email: string;
}

interface ClassManagerGrant {
  userId: string;
  email: string;
  name: string | null;
  enrollStudents: boolean;
  markAttendance: boolean;
  viewRoster: boolean;
}

interface ManagerRow {
  userId: string;
  role: string;
  name: string | null;
  email: string;
  enrollStudents: boolean;
  markAttendance: boolean;
  viewRoster: boolean;
}

type GrantField = "enrollStudents" | "markAttendance" | "viewRoster";

export function ClassManagers() {
  const [rows, setRows] = useState<ManagerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [teamRes, grantsRes] = await Promise.all([
        fetch("/api/v1/team"),
        fetch("/api/v1/class-managers"),
      ]);

      const members: TeamMember[] = teamRes.ok
        ? ((await teamRes.json()).data ?? [])
        : [];
      const grants: ClassManagerGrant[] = grantsRes.ok
        ? ((await grantsRes.json()).data ?? [])
        : [];

      const grantMap = new Map(grants.map((g) => [g.userId, g]));

      const merged: ManagerRow[] = members
        .filter((m) => m.role !== "owner" && m.role !== "admin")
        .map((m) => {
          const grant = grantMap.get(m.user_id);
          return {
            userId: m.user_id,
            role: m.role,
            name: m.name,
            email: m.email,
            enrollStudents: grant?.enrollStudents ?? false,
            markAttendance: grant?.markAttendance ?? false,
            viewRoster: grant?.viewRoster ?? false,
          };
        });

      setRows(merged);
    } catch {
      toast.error("Failed to load class managers");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleToggle(row: ManagerRow, field: GrantField, checked: boolean) {
    const key = `${row.userId}:${field}`;
    const previousValue = row[field];
    let next: ManagerRow = { ...row, [field]: checked };

    // Read the current row (not the closure's stale `row`) so two rapid toggles
    // on the same user don't clobber each other's optimistic update on revert.
    setRows((prev) =>
      prev.map((r) => {
        if (r.userId !== row.userId) return r;
        next = { ...r, [field]: checked };
        return next;
      })
    );
    setSavingKey(key);

    try {
      const res = await fetch("/api/v1/class-managers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: row.userId,
          enrollStudents: next.enrollStudents,
          markAttendance: next.markAttendance,
          viewRoster: next.viewRoster,
        }),
      });
      if (!res.ok) throw new Error("Failed to update grant");
      toast.success("Class manager access updated");
    } catch {
      // Revert only this field to its pre-toggle value, not the whole row —
      // avoids clobbering a concurrent toggle on a different field.
      setRows((prev) =>
        prev.map((r) => (r.userId === row.userId ? { ...r, [field]: previousValue } : r))
      );
      toast.error("Failed to update class manager access");
    } finally {
      setSavingKey(null);
    }
  }

  if (loading) {
    return (
      <Card id="class-managers">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <UserCog className="h-5 w-5" />
            Class Managers
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Loading…</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card id="class-managers">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <UserCog className="h-5 w-5" />
          Class Managers
        </CardTitle>
        <CardDescription>
          Grant non-admin team members permission to enroll students, mark attendance,
          or view the full class roster. Owners and admins always have full access.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No other team members yet.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead className="text-center">Enroll Students</TableHead>
                <TableHead className="text-center">Mark Attendance</TableHead>
                <TableHead className="text-center">View Roster</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.userId}>
                  <TableCell>
                    <p className="text-sm font-medium">{row.name || row.email}</p>
                    <p className="text-xs text-muted-foreground">{row.email}</p>
                  </TableCell>
                  <TableCell className="text-center">
                    <Checkbox
                      checked={row.enrollStudents}
                      disabled={savingKey === `${row.userId}:enrollStudents`}
                      onCheckedChange={(checked) =>
                        handleToggle(row, "enrollStudents", checked === true)
                      }
                    />
                  </TableCell>
                  <TableCell className="text-center">
                    <Checkbox
                      checked={row.markAttendance}
                      disabled={savingKey === `${row.userId}:markAttendance`}
                      onCheckedChange={(checked) =>
                        handleToggle(row, "markAttendance", checked === true)
                      }
                    />
                  </TableCell>
                  <TableCell className="text-center">
                    <Checkbox
                      checked={row.viewRoster}
                      disabled={savingKey === `${row.userId}:viewRoster`}
                      onCheckedChange={(checked) =>
                        handleToggle(row, "viewRoster", checked === true)
                      }
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <div className="flex items-center gap-2 mt-4 text-xs text-muted-foreground">
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
            Owners & Admins
          </Badge>
          always have enroll, attendance, and roster access — no grant needed.
        </div>
      </CardContent>
    </Card>
  );
}
