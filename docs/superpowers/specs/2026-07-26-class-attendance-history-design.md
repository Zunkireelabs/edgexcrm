# Class Attendance History — Design Spec (education_consultancy)

**Date:** 2026-07-26
**Scope:** `education_consultancy` only. Read-only follow-up to the Class Attendance feature (PR #298).
**Status:** design approved; ready for implementation plan (writing-plans → Sonnet brief).

---

## 1. Goal

Show a **per-class attendance history table**: enrolled students as rows, dates as columns,
present/absent per cell, plus a per-student attendance %. Read-only; no marking here (marking
stays in the existing AttendanceSheet). **No DB migration** — pure read over `class_attendance`.

## 2. Context (existing code, all shipped in PR #298)

- Base feature: `class_attendance` (enrollment_id, session_date, status ∈ present/absent, marked_by,
  tenant_id) + `class_attendance_markers` allowlist. Migration `180_class_attendance.sql`.
- Marking UI: `src/industries/education-consultancy/features/classes/components/attendance-sheet.tsx`.
- Mark/roster API: `src/app/(main)/api/v1/classes/[id]/attendance/route.ts` (GET roster+status for a
  date, POST upsert). Gated by `canMarkClassAttendance` (owner/admin or allowlist).
- Class detail UI: `.../features/classes/pages/classes-workspace.tsx` — right pane shows the roster
  table + an "Attendance" (mark) button gated on `canMarkAttendance` (server-computed prop from
  `src/app/(main)/(dashboard)/classes/page.tsx`).
- `canMarkClassAttendance(auth)` in `src/lib/api/class-attendance.ts`.

## 3. Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Who can VIEW history | **Anyone with Classes access** (industry gate only; NO marker gate) |
| Date columns | **From/To date filter, default last 30 days** |
| Attendance % | **present / (present + absent)** — "not marked" days excluded from denominator |
| Student scope | **All** active enrolled students (not counselor lead-scoped), like the roster |
| Placement | **Roster \| Attendance** tab toggle in the class detail pane |
| DB | **No migration** — read-only over existing `class_attendance` |

## 4. API — one new read endpoint

`GET /api/v1/classes/[id]/attendance/history?from=YYYY-MM-DD&to=YYYY-MM-DD`

- `authenticateRequest()` → `getFeatureAccess(auth.industryId, FEATURES.CLASSES) → apiForbidden()`.
  **No `canMarkClassAttendance` check** — any Classes-access user may view.
- Validate `from`/`to` are `YYYY-MM-DD` (reuse the `DATE_RE` pattern). Default when omitted:
  `to` = today, `from` = today − 30 days. Reject `from > to`.
- Queries via `scopedClient(auth)`:
  1. Class exists + tenant-owned: `classes` by `id` → 404 if none.
  2. Active enrollments for the class (`class_enrollments` by `class_id`, `deleted_at IS NULL`,
     join `leads` for name) — **all enrolled, no assigned_to filter**.
  3. `class_attendance` rows for those enrollment_ids where `session_date` BETWEEN from AND to.
- Response shape:
  ```json
  {
    "class": { "id": "...", "name": "..." },
    "from": "2026-06-26", "to": "2026-07-26",
    "dates": ["2026-07-24","2026-07-25","2026-07-26"],
    "students": [
      { "enrollment_id": "...", "lead_id": "...", "name": "Aarav Sharma",
        "cells": { "2026-07-24": "present", "2026-07-25": "present", "2026-07-26": "absent" },
        "present": 2, "absent": 1, "pct": 67 }
    ]
  }
  ```
  - `dates` = distinct `session_date`s that actually have attendance in range, ascending.
  - `cells` omits dates the student wasn't marked (UI renders those as "–").
  - `pct` = round(present / (present + absent) × 100); `null` when present+absent = 0.
  - Server builds `students`/totals so the client just renders.

## 5. UI

### 5a. Tab toggle in `classes-workspace.tsx`
- Add local state `detailTab: "roster" | "attendance"`, default `"roster"`.
- Segmented control / two buttons in the detail pane header: **Roster** | **Attendance**.
- Roster tab = existing roster table (unchanged).
- Attendance tab = render new `<AttendanceHistory classId className />`.
- The existing mark button ("Take attendance") stays gated on `canMarkAttendance` and lives in the
  Attendance tab header (opens the existing AttendanceSheet). Rename the mark button label to
  **"Take attendance"** to distinguish from the tab.

### 5b. New component `attendance-history.tsx`
- Props: `{ classId: string; className: string }`.
- From/To date `<input type="date">` (default last 30 days, same `todayStr()` helper as the sheet).
- On mount + on date change: fetch the history endpoint; loading spinner; empty state
  ("No attendance recorded in this range.").
- Render a table: sticky first column **Student**; one column per `dates[]` (header = short date);
  cells ✓ (green) / ✗ (red) / – (muted); trailing columns **Present**, **Absent**, **%**.
  Date columns scroll horizontally (`overflow-x-auto` wrapper).
- Reuse existing shadcn/table + `cn` styling conventions from the roster + sheet.

## 6. Compliance

- Industry-gated through `FEATURES.CLASSES` (part of Classes).
- `scopedClient(auth)` for every query; read-only (no writes, no update/delete).
- No new table → no RLS/migration needed. No counselor `assigned_to` filter (shows all enrolled,
  consistent with the roster + mark view).

## 7. Out of scope (v1)

Per-student profile attendance view, CSV/PDF export, cross-class/summary dashboards, per-date
"present count" footer row, late/excused states.

## 8. Verify before ship

- `npm run build` clean (`NODE_OPTIONS=--max-old-space-size=8192` on the low-heap dev box).
- As any Classes user (non-marker counselor): Attendance tab visible, grid loads, **no** "Take
  attendance" button. As a marker/admin: button present, opens the sheet.
- Grid math: seed a couple of `class_attendance` rows on stage, confirm counts + % match
  present/(present+absent), "–" for unmarked dates, dates outside range excluded.
- Non-education tenant: route 403 / tab absent (industry gate).
