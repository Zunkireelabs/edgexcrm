# Class Attendance — Design Spec (education_consultancy)

**Date:** 2026-07-26
**Scope:** `education_consultancy` only (sub-feature of Classes). Admizz is the target tenant.
**Status:** design approved by user; ready for implementation plan (writing-plans → Sonnet brief).

---

## 1. Goal

Let designated staff take **attendance** for students enrolled in a Class. A marker picks a
class + a date and marks each enrolled student **Present** or **Absent**. Only specific users
(seeded: Purnima, Kamana, Pratima) may mark; they see **all** students enrolled in the class,
not just their own assigned leads.

## 2. Context (existing code)

- Classes feature lives at `src/industries/education-consultancy/features/classes/`
  (`meta.ts`, `pages/classes-workspace.tsx`, `components/*`).
- Data model (migration `065_classes.sql`):
  - `classes` (catalog: name, default_fee, is_active)
  - `class_enrollments` (tenant_id, class_id, lead_id, fee_paid, fee_amount, notes, deleted_at) —
    the class×student unit; unique active `(tenant_id, lead_id, class_id)`.
- Permissions are **position-based only** (`positions.permissions` JSONB;
  `resolvePermissions()` in `src/lib/api/permissions.ts`). **No per-user override exists** —
  `tenant_users` has `position_id` but no permission column. This is why marker access uses a
  dedicated allowlist table instead of a position permission (a position flag would grant every
  counselor, not the named 3).
- Existing `/attendance` routes + `src/lib/hr/attendance.ts` are **HR employee clock-in** — unrelated.
- Classes API routes: `src/app/(main)/api/v1/classes/route.ts` + `.../classes/[id]/route.ts`,
  gated by `canManageClasses(auth.permissions)`.
- The 3 seeded markers (Admizz tenant `febeb37c-521c-4f29-adbb-0195b2eede88`, all role `counselor`):
  - Purnima — `ad32e374-b421-45f2-a32a-b0ef003e4dba` (purnima.admizz@gmail.com)
  - Kamana — `e6e2ad98-2838-4202-a67e-da71ae68227d` (kamana.admizz@gmail.com)
  - Pratima Lamichhane — `cb4f8a10-847b-4e7e-8b99-92c54d16947b` (pratima.lamichhane@admizz.org)

## 3. Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Attendance unit | Per-date, ad-hoc (no schedule/sessions table) |
| States | `present` / `absent` only |
| Who can mark | Dedicated per-user **allowlist table**; seed the 3 |
| Student scope | **All** students enrolled in the class (bypass counselor "my leads" filter) |
| Marker-management UI | **Deferred** — seed 3 via migration now, admin toggle screen is a follow-up |
| Reporting / % / late / excused | Out of scope v1 (schema leaves room) |

## 4. Data model — migration `180_class_attendance.sql`

Additive, idempotent (`IF NOT EXISTS`), transactional, with before/after counts + rollback line.

### 4a. `class_attendance`
```
id            UUID PK default gen_random_uuid()
tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
enrollment_id UUID NOT NULL REFERENCES class_enrollments(id) ON DELETE CASCADE
session_date  DATE NOT NULL
status        TEXT NOT NULL CHECK (status IN ('present','absent'))
marked_by     UUID REFERENCES auth.users(id)
created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
UNIQUE (enrollment_id, session_date)        -- re-marking a student on a date = upsert
```
Indexes: `(tenant_id, enrollment_id)`, `(tenant_id, session_date)`.
`updated_at` trigger like `065`.

RLS (defense-in-depth; app layer is the real gate since routes use scopedClient/service):
- SELECT: `tenant_id IN (SELECT get_user_tenant_ids())`
- INSERT/UPDATE/DELETE: `is_tenant_admin(tenant_id)`

### 4b. `class_attendance_markers` (allowlist)
```
tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
PRIMARY KEY (tenant_id, user_id)
```
RLS: SELECT tenant users; mutations `is_tenant_admin`.

Seed (inside same migration): insert the 3 user_ids for the Admizz tenant, `ON CONFLICT DO NOTHING`.

## 5. Access gate

New helper in `src/lib/api/permissions.ts` (or a small `src/lib/api/class-attendance.ts`):
```
async function canMarkClassAttendance(auth): boolean
  = auth.role ∈ {owner, admin}
    OR EXISTS (class_attendance_markers where tenant_id=auth.tenantId and user_id=auth.userId)
```
Only attendance routes call it (one scoped lookup; not added to global auth path).

## 6. API routes (under existing Classes industry gate)

All: `authenticateRequest()` → `getFeatureAccess(auth.industryId, FEATURES.CLASSES) → apiForbidden()`
→ then per-route permission. Use `scopedClient(auth)` for all tenant tables.

1. `GET /api/v1/classes/[id]/attendance?date=YYYY-MM-DD`
   - Returns every **active enrollment** for the class (join `leads` for name) + that date's status
     (LEFT JOIN `class_attendance` on enrollment_id + date). Listing by `class_id` naturally shows
     **all** enrolled students — no counselor `assigned_to` filter applied here.
   - Visible to: markers + admins/owners (`canMarkClassAttendance`).
2. `POST /api/v1/classes/[id]/attendance`
   - Body: `{ date: 'YYYY-MM-DD', records: [{ enrollment_id, status }] }`.
   - Upsert on `(enrollment_id, session_date)`; set `marked_by = auth.userId`.
   - Validate: each `enrollment_id` belongs to this class + tenant; status ∈ {present,absent}.
   - Gate: `canMarkClassAttendance`.
3. Marker allowlist management (admin-only GET/POST/DELETE) — **deferred, not built in v1**.
   Changing markers meanwhile = one-line SQL insert/delete on `class_attendance_markers`.

## 7. UI (`classes-workspace`, education-gated)

- Per class row/detail: an **Attendance** action, shown only if `canMarkClassAttendance` (pass a
  boolean from the server page/loader; do not hardcode names client-side).
- Sheet/dialog: date picker (defaults today) + list of enrolled students, each with a
  Present/Absent toggle, and a **Save** button → POST. On load, calls the GET to prefill.
- Follow existing classes component patterns (`enroll-student-sheet.tsx` is the closest precedent).
- No marker-management screen in v1.

## 8. Tenant isolation / rules compliance

- New tables have `tenant_id` FK + RLS (per CLAUDE.md invariants).
- All queries via `scopedClient(auth)`; any `.update()`/`.delete()` carries an explicit filter
  beyond the auto tenant_id.
- Industry-gated through the existing `FEATURES.CLASSES` access check (attendance is part of Classes).

## 9. Out of scope (v1)

Attendance %, per-student history/reports, late/excused states, recurring schedules/sessions,
marker-management admin UI, notifications. Schema does not preclude adding these later.

## 10. Verify before ship

- `npm run build` clean.
- Migration applied to **stage** first, verified, then prod at promotion (per dev workflow).
- As a seeded marker (e.g. Purnima): Attendance action visible; can mark all enrolled students on a
  date; re-mark updates (no dup rows). As a non-marker counselor: action hidden, POST → 403.
- As admin: can mark. Non-education tenant: classes/attendance 404/403 (industry gate).
- Counselor lead-scoping elsewhere unchanged.
