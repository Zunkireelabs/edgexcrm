# BRIEF — Student Academic/Test capture + Prospect-qualification gate

**Owner:** education_consultancy · **Branch base:** `origin/stage` → `feature/prospect-qualification` · **Migration:** `159`
**Status:** ready for executor (Sonnet)

---

## 1. Goal (plain English)

Education-consultancy clients want a student's **qualification** (and optional **test scores**) captured before that student becomes a **Prospect**. A lead becomes a Prospect when it lands in the `prospects` lead-list — which today happens when a counselor is **Assigned To** the lead (check-in auto-routes assigned walk-ins to Prospects), or when someone drags/moves the lead into the Prospects list.

So we:
1. **Build** an Academic Qualification + Test Report section on the Student check-in form (it does **not** exist in code yet — the screenshot is a target design).
2. **Add a Masters** level (below Bachelor).
3. **Reorder** so "Assigned To" sits *after* the test-score section.
4. **Gate** entry into Prospects: requires the highest qualification's **%/GPA** (GPA-only) to be present. Everything else stays optional.
5. Enforce the gate **app-wide** (check-in, Add-Lead modal, lead-detail edit, kanban/stepper moves) with a **block + fill-in modal**, plus a **server 422 backstop**.

### Decisions already made (do not re-litigate)
| Decision | Answer |
|---|---|
| Storage | **New structured flat columns on `leads`** (queryable), mirroring existing `destinations`/`field_of_study`/`degree_level` (migration 059). |
| Scope | Check-in **+ Add-Lead everywhere** + gate on any move **into Prospects**. |
| Trigger | Assigning a counselor (check-in) / moving into Prospects list (elsewhere). |
| Completeness | **Highest level, %/GPA only** required. Show all fields (institution, passed year, all test scores) but keep them optional. |
| Prospect-move UX (kanban/stepper) | **Block + open fill-in modal**, then complete the move. |
| Which levels satisfy the gate | One of **{Intermediate/+2, Bachelor, Masters}** with a non-empty %/GPA. **SEE/10th does NOT satisfy** (still capturable). |

---

## 2. Data model — migration `supabase/migrations/159_lead_academic_qualification.sql`

Additive, transactional, education columns live on shared `leads` (same precedent as `destinations`). All nullable.

Columns (17):
```
-- Academic qualification (per level: gpa TEXT (mixed % or GPA), institution TEXT, passed_year SMALLINT)
see_gpa TEXT,           see_institution TEXT,           see_passed_year SMALLINT,
plus_two_gpa TEXT,      plus_two_institution TEXT,      plus_two_passed_year SMALLINT,
bachelor_gpa TEXT,      bachelor_institution TEXT,      bachelor_passed_year SMALLINT,
masters_gpa TEXT,       masters_institution TEXT,       masters_passed_year SMALLINT,
-- Test scores (mixed formats/band scores -> TEXT)
ielts_score TEXT, pte_score TEXT, toefl_score TEXT, sat_score TEXT, gre_gmat_score TEXT
```
Requirements:
- Wrap in a txn; `ALTER TABLE leads ADD COLUMN IF NOT EXISTS ...`.
- Log before/after `information_schema.columns` count for `leads`.
- Rollback line (commented): `ALTER TABLE leads DROP COLUMN IF EXISTS see_gpa, ...;`
- No RLS change (columns on existing table).
- **Apply to STAGE (`dymeudcddasqpomfpjvt`) first, verify, then PROD at promotion (per-action approval).** Migration-before-code ordering per `docs/dev-collab/DEV-WORKFLOW-AND-DEPLOYMENT.md`.

---

## 3. Shared config + gate helper (single source of truth)

Create `src/lib/leads/prospect-qualification.ts` — imported by **both client and server** (no React, no server-only imports):

```ts
export const ACADEMIC_LEVELS = [
  { key: "see",       label: "SEE / 10th Grade",  gateEligible: false },
  { key: "plus_two",  label: "Intermediate / +2", gateEligible: true  },
  { key: "bachelor",  label: "Bachelor",          gateEligible: true  },
  { key: "masters",   label: "Masters",           gateEligible: true  },
] as const;

export const TEST_TYPES = [
  { key: "ielts", label: "IELTS" }, { key: "pte", label: "PTE" },
  { key: "toefl", label: "TOEFL" }, { key: "sat", label: "SAT" },
  { key: "gre_gmat", label: "GRE/GMAT" },
] as const;

export const ACADEMIC_COLUMNS = ACADEMIC_LEVELS.flatMap(l =>
  [`${l.key}_gpa`, `${l.key}_institution`, `${l.key}_passed_year`]);
export const TEST_COLUMNS = TEST_TYPES.map(t => `${t.key}_score`);
export const ALL_ACADEMIC_TEST_COLUMNS = [...ACADEMIC_COLUMNS, ...TEST_COLUMNS];

// Gate: a lead can enter Prospects only if one gate-eligible level has a non-empty %/GPA.
export function hasProspectQualification(row: Record<string, unknown>): boolean {
  return ACADEMIC_LEVELS.filter(l => l.gateEligible)
    .some(l => String(row[`${l.key}_gpa`] ?? "").trim() !== "");
}
```
This is the ONLY definition of "qualified." Every client and server check calls `hasProspectQualification`. The gate only applies when **industryId === "education_consultancy"**.

### Edit-permission rule (who may write academic/test fields)
Only the **assignee** (`leads.assigned_to`) **or a lead collaborator** (`lead_collaborators`) — plus admins — may edit the academic/test fields. This is mostly enforced already:
- Server: `PATCH /api/v1/leads/[id]` runs `requireLeadAccess(auth, lead, membership)` (`route.ts:189-247`) which requires assignee/collaborator (with admin + team-scope exceptions) BEFORE any field write. So as long as the 17 new columns are added to `UPDATABLE_FIELDS` and **kept OUT of `ADMIN_ONLY_FIELDS`** (`route.ts:36`, `:249-261`), assignee/collaborator counselors can write them and non-members get `apiForbidden()`. Helpers: `isLeadCollaborator(db, tenantId, leadId, userId)` (`src/lib/leads/collaborators.ts:87-101`), assignee check inline in `requireLeadAccess` (`src/lib/api/auth.ts:214`).
- Client: today the StudyInterestPanel edit button shows on `isAdmin` only (`key-info-section.tsx:730`). Widen it to an `isEditor = isAdmin || isAssignee || isCollaborator` flag (see Phase 4.2).

### Cross-cutting notes (apply everywhere)
- **Student tag / education only.** The academic+test UI and the gate apply to the **Student** lead tag under `education_consultancy`. Never render for the `other` tag, `travel_agency`, or any non-education tenant. The check-in gate keys off `assignedTo` (Student path); the `other` tag uses `meetWith` and is never routed to Prospects, so it's never gated.
- **Empty → null coercion.** Client sends empty strings; server must coerce `"" → null` for all 17 columns before insert/update. **`*_passed_year` is `SMALLINT`** — parse to an integer or `null` (never pass `""`, it 400s). GPA/institution/score stay TEXT.
- **Read display.** StudyInterestPanel today only renders `destinations`. When academic/test values exist, show them read-only in the panel (not just in edit mode) so a filled qualification is visible at a glance.
- **`hasProspectQualification` is the single gate** on both client and server — never inline a second definition.

---

## 4. Work items (phased — build + verify each phase before the next)

> Anchors are `file:line` on `feature/prospect-qualification` off latest `origin/stage`; re-grep to confirm exact lines after rebase.

### Phase 1 — Migration
- Write & apply `159_...` to stage. Verify columns exist. (§2)

### Phase 2 — Check-in form (`src/industries/_shared/features/check-in/ui.tsx`)
Gate the whole new UI with `industryId === "education_consultancy"`.
1. **State:** add `academics` (object keyed by the 12 academic columns) and `testScores` (5 columns). Init empty strings.
2. **New collapsible section** "Academic & test details (optional)" — insert **after the student structured block** (closes ~`:812`) and **before the Assigned To block** (`:816`). Collapsed by default; toggle to show. Contents:
   - **Academic Qualification** — one row per `ACADEMIC_LEVELS` (SEE/10th, Intermediate/+2, Bachelor, **Masters**): label + 3 inputs (`%/GPA`, `School / College`, `Passed year`).
   - **Test Report & Score** — one input per `TEST_TYPES` (IELTS, PTE, TOEFL, SAT, GRE/GMAT).
3. **Reorder:** inserting the section above the existing Assigned To block (`:816-853`) already places Assigned To after the test scores — no separate move needed. Confirm final visual order: `Destination block → Academic & test (collapsible) → Assigned To → Notes`.
4. **Inline gate on submit** (`handleAddLead`, `:429`): if education tenant AND `assignedTo` set AND `!hasProspectQualification({...academics})` → `preventDefault`, auto-expand the section, mark the +2/Bachelor/Masters GPA inputs with an error ring, toast: **"Enter the student's highest qualification (%/GPA) before assigning a counselor."** Do not POST.
5. **POST payload:** add all 17 columns to the `POST /api/v1/leads` body (alongside `destinations`).
6. **Cancel handler** (`:872-887`): reset the new state.

### Phase 3 — Server backstop (defense in depth; return `apiValidationError`, 422)
Gate message: **"Add the student's highest qualification (%/GPA) before moving to Prospects."** Only for `education_consultancy`.
1. `POST /api/v1/leads` — `src/app/(main)/api/v1/leads/route.ts`:
   - Add the 17 columns to `leadPayload` (after `:517`, same shape as `destinations`).
   - **Gate must cover BOTH create paths, so put it AFTER `leadPayload.list_id` is finally resolved (after the whole `:521-556` block), not inside `if (!body.list_id)`:**
     - Path A — check-in auto-route (`:528-556`): `body.list_id` is absent, `targetSlug` resolves to `"prospects"` when `body.assigned_to` is set.
     - Path B — AddLeadSheet: sends an explicit `body.list_id` (the `if (!body.list_id)` block is skipped entirely). Resolve that `list_id`'s slug.
   - After resolution: if the lead's final list slug is `prospects` and industry is education → require `hasProspectQualification(leadPayload)` else 422. (One check, both paths.)
2. `PATCH /api/v1/leads/[id]` — `src/app/(main)/api/v1/leads/[id]/route.ts`:
   - Add the 17 columns to `UPDATABLE_FIELDS` (`:36`). **Do NOT add them to `ADMIN_ONLY_FIELDS`** (`:249-261`) — that keeps them writable by assignee/collaborator counselors while `requireLeadAccess` (`:189-247`) still blocks non-members. (Edit-permission rule, §3.)
   - Near the prospects check (`:568`, `targetList.slug === "prospects"`): merge the lead's **current** academic columns with any incoming ones; if `!hasProspectQualification(merged)` and education → 422 (do not move).
3. `PATCH /api/v1/leads/bulk` — `src/app/(main)/api/v1/leads/bulk/route.ts` (`:161`, `:237`):
   - When target list slug is `prospects` and education: fetch academic columns for the target leads, reject any lead that fails `hasProspectQualification`. Return the failing ids so the client can react (funnel-kanban drags one card at a time).
4. `POST /api/v1/leads/[id]/check-in` — `src/app/(main)/api/v1/leads/[id]/check-in/route.ts` (`:94-143`, `:99` `slug="prospects"`):
   - Before auto-promoting an assigned lead to Prospects, require `hasProspectQualification(lead)` else 422.

### Phase 4 — Add-Lead modal + Lead-detail edit
1. **AddLeadSheet** — `src/components/dashboard/add-lead-sheet.tsx` (Stage dropdown `:513`, submit `:322`):
   - Education only: add a collapsible "Academic & test details" block with the same fields; include in the `POST` body.
   - Client gate: **only the selected Stage matters here** — AddLeadSheet does NOT auto-route by assignee (that path is check-in-only). If the selected Stage is the **Prospects** list and `!hasProspectQualification(form)` → block submit, expand, inline error. (Server Phase 3.1 Path B backstops.)
2. **StudyInterestPanel** — `src/components/dashboard/lead/key-info-section.tsx` (`onSave` `:707`, edit button `:730`):
   - Add academic + test fields to this edit panel so they can be filled/updated on the lead detail page. Include the 17 columns in the PATCH. **This is the path for existing Prospects** (leads already in the list with no qualification captured) to add their data — no data backfill/migration needed, the fields simply become editable.
   - **Widen the edit gate** from `isAdmin` to `isEditor = isAdmin || isAssignee || isCollaborator`:
     - Compute in `lead-detail-v2.tsx` (it knows the current user, `lead.assigned_to`, and the collaborators list — `collaborators-block.tsx` already loads collaborators) and pass `isEditor` down as the panel's gate prop (replace the `isAdmin`-only check at `:730`).
     - `isAssignee = lead.assigned_to === currentUserId`; `isCollaborator = collaborators.some(c => c.user_id === currentUserId)`.
   - Server already enforces the same rule via `requireLeadAccess` (§3.2) — this is the matching client affordance so assignees/collaborators actually see the Edit button. Admins unaffected.

### Phase 5 — Move-into-Prospects gate (block + fill-in modal)
Create shared `src/components/dashboard/leads/prospect-qualification-dialog.tsx`:
- Props: `lead`, `open`, `onConfirm(patch)`, `onCancel`. Shows all academic + test fields; **validity = `hasProspectQualification(patch)`** (i.e. at least one of +2/Bachelor/Masters has a %/GPA — do NOT build a separate "detect highest level" routine, reuse the helper). Confirm button disabled until valid. On confirm, returns the filled columns.
- **On confirm:** first `PATCH /leads/:id` with the academic columns, then perform the original list move (second PATCH, or a single combined PATCH with both `list_id` and the academic columns — combined is cleaner and lets the server gate pass in one call).
- Wire into the **list-based** move surfaces (Prospects is a `lead_lists` slug, so pipeline stage board is out of scope unless it drives a list change — confirm and note):
  - **FunnelKanbanBoard** — `src/components/dashboard/leads/funnel-kanban-board.tsx` (`handleDragEnd` `:132`, PATCH `/leads/bulk` `:157`): if the destination list slug is `prospects` and `!hasProspectQualification(lead)` → open dialog before the PATCH; on confirm PATCH academics + then the list move; on cancel revert the drag (snap card back).
  - **ListStepper / lead-detail-v2** — `src/components/dashboard/leads/list-stepper.tsx` (`confirmMove` `:144`) + `src/components/dashboard/lead/lead-detail-v2.tsx` (PATCH `:710`): same guard when the target list is `prospects`.
- Do **not** gate reverse moves (leaving Prospects) or non-Prospects moves.

---

## 5. Verification (before PR)
- `npm run build` clean; `npm run lint` clean.
- **As an education tenant** (`hello@admizz.org` / `edgexdev123` on stage/local):
  - Check-in Student: new collapsible present with 4 levels incl. Masters + 5 tests; Assigned To sits after tests. Picking a counselor with no +2/Bachelor/Masters GPA is blocked inline; adding a Bachelor GPA lets it submit and the lead lands in Prospects.
  - Add-Lead modal → Prospects stage without GPA is blocked; with GPA succeeds.
  - Drag a lead into Prospects on the funnel board with no GPA → dialog opens; fill GPA → move completes; cancel → card snaps back.
  - Lead detail StudyInterestPanel can edit academic/test fields and they persist.
  - **Existing Prospect** (a lead already in the list, no qualification): its assignee and any collaborator see the Edit button and can add academic/test data; it persists.
  - **Permission:** a counselor who is NOT the assignee/collaborator of the lead does NOT see the Edit button, and a direct `PATCH` of academic fields from them returns `apiForbidden` (403). Admin can always edit.
  - Direct API: `PATCH /leads/:id` list→prospects without GPA returns 422; `/leads/bulk` and check-in likewise.
- **As a non-education tenant** (an `it_agency` tenant): no academic UI anywhere, no gate, funnel/kanban unchanged.
- **SEE-only** GPA does NOT satisfy the gate (must be +2/Bachelor/Masters).

## 6b. Follow-up change (post-review, 2026-07-16): hard-block assign→promote

Decision reversed from the first implementation: assigning a counselor to an **unqualified** lead must be **hard-blocked (422)**, not silently skip the promotion. Behavior now matches the check-in route exactly — you cannot assign a counselor (which would auto-promote to Prospects) until the qualification %/GPA is on file.

**Server — `src/app/(main)/api/v1/leads/[id]/route.ts`:**
- The current auto-promote block (~`:815-883`) runs **after** the main `.update(updatePayload)` at `:757` — too late to block. Add a **pre-update guard BEFORE `:757`** that mirrors the promote condition and returns `apiValidationError` when it would promote an unqualified lead:
  ```ts
  // Hard-block: assigning a counselor that would auto-promote an unqualified lead into Prospects.
  if (
    auth.industryId === "education_consultancy" &&
    updatePayload.assigned_to != null &&
    updatePayload.list_id === undefined
  ) {
    const slug = await resolvePositionSlug(supabase, auth.tenantId, updatePayload.assigned_to as string);
    if (slug === "counselor") {
      const { data: prospectsList } = await supabase.from("lead_lists")
        .select("id, sort_order").eq("tenant_id", auth.tenantId).eq("slug", "prospects").maybeSingle();
      if (prospectsList) {
        const currentListId = (existingLead as Record<string, unknown>).list_id as string | null;
        let sort: number | null = null, staging = false;
        if (currentListId) {
          const { data: cl } = await supabase.from("lead_lists")
            .select("sort_order, is_staging").eq("id", currentListId).maybeSingle();
          sort = cl?.sort_order ?? null; staging = cl?.is_staging ?? false;
        }
        const wouldPromote = sort === null || staging || sort < prospectsList.sort_order;
        const qualifies = hasProspectQualification({ ...(existingLead as Record<string, unknown>), ...updatePayload });
        if (wouldPromote && !qualifies) {
          return apiValidationError({ academic: ["Add the student's highest qualification (%/GPA) before assigning a counselor."] });
        }
      }
    }
  }
  ```
- The existing auto-promote block's `qualifies &&` guard (~`:850`) becomes redundant (unqualified is now blocked upstream) — leave it as a harmless belt-and-suspenders OR drop it; do not remove the surrounding promotion logic. To avoid the double DB round-trip (resolvePositionSlug + list lookups run twice), optionally compute the promote decision once above and reuse it below — not required.

**Client — the assign surfaces that were NOT in the original Phase 5 (list-move) scope now hit this 422 and must handle it:**
- Assignee dropdown on lead detail (`lead-detail-v2.tsx`) and the new-leads triage assignment UI. On a 422 with an `academic` key: surface the message via toast, and — matching Phase 5 — **open the `prospect-qualification-dialog`** so the assigner can enter the %/GPA and retry the assignment in one flow (preferred). Minimum acceptable: show the error toast and do not silently swallow it.
- Re-verify: assigning a counselor to a lead with no +2/Bachelor/Masters GPA is rejected; adding a GPA (or filling via the dialog) then lets the assignment + promotion succeed.

## 6. Ship
- One `feature/prospect-qualification` branch, squash-PR to `stage`. CI green.
- Migration 159 to prod (per-action approval) **before** the stage→main promote (merge commit, not squash).
- After ship: SESSION-LOG entry, FEATURE-CATALOG row, `git mv` this brief into `docs/archive/features/`.
