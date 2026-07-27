# Class Attendance History Implementation Plan

> **For the executor (Sonnet session):** implement task-by-task. Steps use checkbox (`- [ ]`) syntax.
> This project has **NO unit-test runner** (CLAUDE.md: "No test runner is configured"). The test
> cycle for every task = `npm run build` clean + the stated manual verification (curl / DB / UI).
> Do NOT invent a test framework. Commit after each task passes its verification.

**Goal:** Add a read-only per-class attendance history table (students × dates grid + per-student %)
to the Classes feature, behind a Roster | Attendance tab.

**Architecture:** One new read API endpoint aggregates `class_attendance` for a class over a date
range and returns a render-ready grid; one new client component renders it; the classes workspace
gets a tab toggle. No DB migration — pure read over the tables shipped in PR #298.

**Tech Stack:** Next.js 16 App Router (route handlers), React 19 client component, Tailwind v4 +
shadcn/ui, `scopedClient(auth)` for tenant-safe queries.

## Global Constraints

- Industry scope: `education_consultancy` only. Gate every route with
  `getFeatureAccess(auth.industryId, FEATURES.CLASSES) → apiForbidden()`.
- Tenant isolation: all queries via `scopedClient(auth)`; read-only, no writes.
- Access: history VIEW requires Classes access only — **no** `canMarkClassAttendance` gate.
- Attendance %: `present / (present + absent)`, rounded; `null` when `present + absent = 0`.
- Student scope: ALL active enrollments for the class (no counselor `assigned_to` filter).
- Date validation: `YYYY-MM-DD` via `/^\d{4}-\d{2}-\d{2}$/`. Default `to`=today, `from`=today−30d.
- Build on the low-heap dev box: `NODE_OPTIONS=--max-old-space-size=8192 npm run build`.
- Branch from latest `origin/stage`; the whole feature is ONE PR to `stage`.
- Spec: `docs/superpowers/specs/2026-07-26-class-attendance-history-design.md`.

---

### Task 1: History API endpoint

**Files:**
- Create: `src/app/(main)/api/v1/classes/[id]/attendance/history/route.ts`

**Interfaces:**
- Produces: `GET /api/v1/classes/[id]/attendance/history?from=&to=` returning
  `{ class:{id,name}, from, to, dates:string[], students:Array<{enrollment_id,lead_id,name,cells:Record<string,'present'|'absent'>,present:number,absent:number,pct:number|null}> }`.

- [ ] **Step 1: Create the route file with full implementation**

```ts
import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiError,
  apiValidationError,
} from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface Props {
  params: Promise<{ id: string }>;
}

interface EnrollmentRow {
  id: string;
  lead_id: string;
  leads:
    | { id: string; first_name: string; last_name: string | null }
    | { id: string; first_name: string; last_name: string | null }[]
    | null;
}

function leadName(embed: EnrollmentRow["leads"]): { first_name: string; last_name: string | null } | null {
  return Array.isArray(embed) ? embed[0] ?? null : embed;
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function GET(request: NextRequest, { params }: Props) {
  const { id } = await params;

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.CLASSES)) return apiForbidden();
  // NOTE: intentionally NO canMarkClassAttendance gate — any Classes user may view history.

  const { searchParams } = new URL(request.url);
  const today = new Date();
  const to = searchParams.get("to") ?? isoDate(today);
  const from = searchParams.get("from") ?? isoDate(new Date(today.getTime() - 30 * 86400000));
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    return apiValidationError({ range: ["from/to must be YYYY-MM-DD"] });
  }
  if (from > to) {
    return apiValidationError({ range: ["from must be on or before to"] });
  }

  const db = await scopedClient(auth);

  const { data: classRow } = await db.from("classes").select("id, name").eq("id", id).maybeSingle();
  if (!classRow) return apiNotFound("Class");

  // All active enrollments for this class — NOT filtered to caller's assigned leads.
  const { data: enrollments, error: enrollError } = await db
    .from("class_enrollments")
    .select("id, lead_id, leads!class_enrollments_lead_id_fkey(id,first_name,last_name)")
    .eq("class_id", id)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (enrollError) return apiError("DB_ERROR", "Failed to fetch enrollments", 500);

  const enrollmentRows = (enrollments ?? []) as unknown as EnrollmentRow[];
  const enrollmentIds = enrollmentRows.map((e) => e.id);

  // enrollment_id -> (date -> status)
  const byEnrollment = new Map<string, Record<string, "present" | "absent">>();
  const dateSet = new Set<string>();

  if (enrollmentIds.length > 0) {
    const { data: attendance, error: attError } = await db
      .from("class_attendance")
      .select("enrollment_id, session_date, status")
      .in("enrollment_id", enrollmentIds)
      .gte("session_date", from)
      .lte("session_date", to);
    if (attError) return apiError("DB_ERROR", "Failed to fetch attendance", 500);

    for (const row of (attendance ?? []) as unknown as {
      enrollment_id: string;
      session_date: string;
      status: "present" | "absent";
    }[]) {
      dateSet.add(row.session_date);
      const map = byEnrollment.get(row.enrollment_id) ?? {};
      map[row.session_date] = row.status;
      byEnrollment.set(row.enrollment_id, map);
    }
  }

  const dates = Array.from(dateSet).sort();

  const students = enrollmentRows.map((e) => {
    const lead = leadName(e.leads);
    const cells = byEnrollment.get(e.id) ?? {};
    let present = 0;
    let absent = 0;
    for (const status of Object.values(cells)) {
      if (status === "present") present += 1;
      else if (status === "absent") absent += 1;
    }
    const denom = present + absent;
    return {
      enrollment_id: e.id,
      lead_id: e.lead_id,
      name: lead ? [lead.first_name, lead.last_name].filter(Boolean).join(" ") || "Unknown" : "Unknown",
      cells,
      present,
      absent,
      pct: denom === 0 ? null : Math.round((present / denom) * 100),
    };
  });

  return apiSuccess({ class: classRow, from, to, dates, students });
}
```

- [ ] **Step 2: Build**

Run: `NODE_OPTIONS=--max-old-space-size=8192 npm run build`
Expected: compiles clean; route `/api/v1/classes/[id]/attendance/history` appears in the route list.

- [ ] **Step 3: Manual verify (unauthenticated)**

Run: `curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/api/v1/classes/SOME_ID/attendance/history"`
(after `npm run dev`). Expected: `401`.

- [ ] **Step 4: Manual verify (data shape)**

On stage DB, insert a couple of `class_attendance` rows for a real Admizz enrollment across 2 dates
(one present, one absent), then hit the endpoint logged in as an admin. Confirm `dates` lists the 2
dates, the student's `cells` map matches, `present`/`absent` counts are right, and `pct` =
`round(present/(present+absent)*100)`. Remove the seed rows after.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(main)/api/v1/classes/[id]/attendance/history/route.ts"
git commit -m "feat(classes): attendance history read endpoint"
```

---

### Task 2: AttendanceHistory component

**Files:**
- Create: `src/industries/education-consultancy/features/classes/components/attendance-history.tsx`

**Interfaces:**
- Consumes: `GET /api/v1/classes/[id]/attendance/history?from=&to=` from Task 1.
- Produces: `export function AttendanceHistory({ classId, className }: { classId: string; className: string })`.

- [ ] **Step 1: Create the component with full implementation**

```tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Loader2, Check, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface StudentRow {
  enrollment_id: string;
  lead_id: string;
  name: string;
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

  return (
    <div className="flex flex-col h-full">
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

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : students.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">No students enrolled in this class.</p>
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
              {students.map((s) => (
                <tr key={s.enrollment_id} className="hover:bg-muted/30">
                  <td className="sticky left-0 bg-card px-4 py-2 font-medium border-b whitespace-nowrap">{s.name}</td>
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
```

- [ ] **Step 2: Build**

Run: `NODE_OPTIONS=--max-old-space-size=8192 npm run build`
Expected: compiles clean (component is imported in Task 3; a standalone build of just this file
won't error on unused — it's fine, Task 3 wires it).

- [ ] **Step 3: Commit**

```bash
git add src/industries/education-consultancy/features/classes/components/attendance-history.tsx
git commit -m "feat(classes): attendance history grid component"
```

---

### Task 3: Wire the Roster | Attendance tab into the workspace

**Files:**
- Modify: `src/industries/education-consultancy/features/classes/pages/classes-workspace.tsx`

**Interfaces:**
- Consumes: `AttendanceHistory` from Task 2; existing `AttendanceSheet`, `canMarkAttendance` prop.

- [ ] **Step 1: Add the import**

Near the other component imports (the file already imports `AttendanceSheet`):
```tsx
import { AttendanceHistory } from "../components/attendance-history";
```

- [ ] **Step 2: Add tab state**

Alongside the existing `useState` hooks (`selectedClassId`, `enrollOpen`, `attendanceOpen`):
```tsx
const [detailTab, setDetailTab] = useState<"roster" | "attendance">("roster");
```

- [ ] **Step 3: Replace the detail-pane header actions block**

The current header (in the `selectedClass` branch) renders class name + a `<div className="flex items-center gap-2">` holding the `canMarkAttendance` "Attendance" button and the `canEnroll` "Enroll" button. Replace that header's action `<div>` so it contains the tab toggle plus the buttons, and rename the mark button label to **"Take attendance"**:

```tsx
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
      Roster
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
  </div>
  {detailTab === "attendance" && canMarkAttendance && (
    <Button size="sm" variant="outline" onClick={() => setAttendanceOpen(true)}>
      <ClipboardCheck className="h-3.5 w-3.5 mr-1" />
      Take attendance
    </Button>
  )}
  {detailTab === "roster" && canEnroll && (
    <Button size="sm" variant="outline" onClick={() => setEnrollOpen(true)}>
      <Plus className="h-3.5 w-3.5 mr-1" />
      Enroll
    </Button>
  )}
</div>
```

Add `import { cn } from "@/lib/utils";` if the file does not already import it.

- [ ] **Step 4: Gate the body on the tab**

The detail pane currently renders the roster (`roster.length === 0 ? emptystate : <table>…`) directly
below the header. Wrap that existing roster body so it only shows on the roster tab, and render the
history on the attendance tab. Keep the existing roster JSX unchanged inside the `roster` branch:

```tsx
{detailTab === "roster" ? (
  <>
    {/* existing roster empty-state + table JSX, unchanged */}
  </>
) : (
  <AttendanceHistory classId={selectedClass.id} className={selectedClass.name} />
)}
```

- [ ] **Step 5: Build**

Run: `NODE_OPTIONS=--max-old-space-size=8192 npm run build`
Expected: clean.

- [ ] **Step 6: Manual verify (UI)**

`npm run dev`, open `/classes` as an admin (or a marker). Select a class:
- Tab defaults to **Roster** (existing table shows, Enroll button present).
- Switch to **Attendance**: date pickers + grid render; "Take attendance" button present (marker/admin).
- As a non-marker Classes user: Attendance tab still visible + grid loads, but **no** "Take attendance" button.
- Change the date range → grid reloads. Dates with no attendance → empty-state message.

- [ ] **Step 7: Commit**

```bash
git add src/industries/education-consultancy/features/classes/pages/classes-workspace.tsx
git commit -m "feat(classes): Roster | Attendance tab with history grid"
```

---

### Task 4: PR to stage

- [ ] **Step 1: Include the spec in the branch**

```bash
git add docs/superpowers/specs/2026-07-26-class-attendance-history-design.md \
        docs/superpowers/plans/2026-07-26-class-attendance-history.md
git commit -m "docs(classes): attendance history spec + plan"
```

- [ ] **Step 2: Rebase on latest stage, push, open PR**

```bash
git fetch origin stage && git rebase origin/stage   # resolve any classes-workspace.tsx conflict hunk-by-hunk
git push -u origin feature/class-attendance-history
gh pr create --base stage --title "feat(classes): attendance history table" --body "Read-only per-class attendance grid behind a Roster | Attendance tab. No migration. Spec: docs/superpowers/specs/2026-07-26-class-attendance-history-design.md"
gh pr view <num> --json baseRefName   # MUST be "stage"
```

- [ ] **Step 3: Report back** — PR number + `npm run build` result + the manual-verify outcomes for Opus review.

---

## Self-Review (done at authoring)

- **Spec coverage:** endpoint (Task 1) ✓, grid component (Task 2) ✓, tab toggle + rename + access
  gate visibility (Task 3) ✓, no migration ✓, PR-to-stage ✓. All spec §4/§5/§6 mapped.
- **Placeholders:** none — full code for route + component; Task 3 references existing JSX explicitly.
- **Type consistency:** `StudentRow`/`cells`/`pct:number|null` identical across Task 1 response and
  Task 2 consumer; `AttendanceHistory({classId,className})` signature matches Task 3 usage.
- **No-test-runner reality:** verification is build + curl + manual UI/DB, per project (no invented
  test framework).
