# BUILD BRIEF — Edit Lead (inline, detail-page)

**Author:** Opus (planning/review brain) · **Executor:** Sonnet · **Branch:** `feature/lead-edit` (off `stage`)
**Date:** 2026-06-10 · **Skill context:** reviewed with `/crm-expert`
**Scope:** Global (universal feature, all industries) — NOT industry-scoped.

> **STOP-AT-REVIEW.** Build on `feature/lead-edit` only. Do **not** merge to `stage`, do **not**
> push, do **not** touch the shared Supabase DB. There is no migration in this work. Hand back for
> Opus review. (This gate has been overstepped before — honor it.)

---

## 1. Why / what's actually missing

The PATCH backend is already complete: `PATCH /api/v1/leads/[id]`
(`src/app/(main)/api/v1/leads/[id]/route.ts`) accepts every field we need
(`first_name, last_name, email, phone, city, country, intake_source, intake_medium,
intake_campaign, preferred_contact_method, company_name, designation, prospect_industry,
salutation, company_email`, …) with validation, audit-log diffing, and notifications.

The gap is **UI only**: on the lead detail page these identity/intake fields are *read-only*.
Several other things are already inline-editable and **must not be duplicated here**: stage/status,
assignment, lead-type, tags, trip fields + package (TripInquiryPanel), professional-details card.

This is a UI-assembly job. **No new API route, no schema change, no migration** — with one backend
fix (see §4, `normalized_email`).

---

## 2. Decisions already made (do not re-litigate)

- **UX:** inline edit on the detail page (`/leads/[id]`), driven by a single **Edit** button that
  flips the relevant fields into inputs together (section-edit mode), Save/Cancel at the bottom.
  Mirror the existing **`ProfessionalDetailsCard`** edit-mode pattern
  (`src/components/dashboard/lead/professional-details-card.tsx`) — it is the working precedent.
- **Two entry points, one surface:**
  1. **Edit** button in the detail-page header.
  2. **⋯ row actions menu** in the leads table → "Edit" → navigates to `/leads/[id]?edit=1`,
     which auto-opens edit mode. (No second edit form — the kebab is just a deep-link.)
- **NOT building:** in-table inline edit / a dual-mode Add-Lead sheet. Declined by Sadin.

---

## 3. Field scope (exact — non-overlapping by design)

Edit mode exposes **only** fields that have no other inline control today:

**Universal (all industries):**
`first_name`, `last_name`, `email`, `phone`, `city`, `country`,
`intake_source`, `intake_campaign`, `preferred_contact_method`

- `intake_source` — same dropdown options as `AddLeadSheet` (`INTAKE_SOURCES`).
- `preferred_contact_method` — same options as create (`phone, email, whatsapp, any`).
- `city`/`country` — reuse whatever pickers `AddLeadSheet` uses.
- **Do NOT** include `intake_medium` (auto/“dashboard”).

**`it_agency` only (gate with `industryId === "it_agency"`), prefilled:**
`company_name`, `designation`, `prospect_industry`, `salutation`, `company_email`

**Explicitly EXCLUDED from this surface (they own their own controls — leave untouched):**
`status`/`stage_id` (Stage dropdown), `assigned_to`/`owner_id` (admin dropdowns),
`tags`/`lead_type` (toggles), all `trip_*` + `entity_id` (TripInquiryPanel),
custom_fields professional set (ProfessionalDetailsCard).

> The whole point of this scoping is **one place to edit each field**. If you find yourself adding an
> input for a field that's edited elsewhere, stop — that's the redundancy we're avoiding.

---

## 4. Backend — one required fix (`normalized_email`)

**Problem:** `PATCH /api/v1/leads/[id]` currently does *not* recompute `normalized_email` when
`email` changes (verified — no reference to it in the route). Dedup/merge matching keys off
`normalized_email`; editing email without re-keying silently corrupts dedup. CRM-standard behavior
(Salesforce/HubSpot) is to re-key identity on email change.

**Fix:** in the PATCH handler, when `email` is in the update payload, also set
`normalized_email` using the **same normalization the create/submit path already uses** — find it
(grep `normalized_email` across `src/app/api/public/submit` and `src/lib`) and reuse that exact
helper. Do not invent a new normalization. If `email` is cleared to null, set `normalized_email`
null too.

**Soft dedup warning (nice-to-have, not blocking):** if the new normalized email already belongs to
another non-deleted lead in the tenant, the UI may show a non-blocking warning toast
("A lead with this email already exists"). Still allow the save. If this adds meaningful complexity,
**skip it and note it as a follow-up** rather than gold-plating.

No other backend changes. The route already validates members/entities, writes audit diffs, and
emits events — leave all of that alone.

---

## 5. Frontend work

### 5a. Shared validation helper (DRY — prevents drift)
`AddLeadSheet` has local `validateEmail` (regex) and `validatePhone` (length ≥7) at
`src/components/dashboard/add-lead-sheet.tsx:193-217`, plus the "email OR first_name required" rule.
Extract these into a small shared module, e.g. `src/lib/leads/lead-validation.ts`:
- `isValidEmail(email): boolean`
- `isValidPhone(phone): boolean`
- (optionally) `validateLeadIdentity(fields): Record<field, message>` for the shared rule set.

Refactor `AddLeadSheet` to import from it (no behavior change there), and use the same helper in edit
mode. One validator, two callers.

### 5b. Detail page — `src/components/dashboard/lead/lead-detail-v2.tsx`
1. Add an **Edit** button in the header (near the contact card / actions). Toggles `isEditing` state
   held at this component so the contact header (name/email/phone) and the intake/location fields
   flip together.
2. On enter-edit: seed a local `draft` from the current lead. On Cancel: discard draft, exit.
3. **Save** (`§5d`): one awaited PATCH of **only changed fields** (diff draft vs original — don't
   send untouched fields). Disable Save while in-flight and when validation fails.
4. Read `?edit=1` (via `useSearchParams`) on mount → start in edit mode. After entering, strip the
   param (router.replace) so a refresh/back doesn't re-trigger.
5. Respect existing layout: the editable fields currently render read-only inside the contact card +
   `key-info-section.tsx` (Location, Preferred Contact, Intake Details). You may either (a) flip
   those existing displays to inputs when `isEditing`, or (b) introduce one cohesive editable
   "Contact & Intake" card mirroring `ProfessionalDetailsCard`. Prefer whichever keeps the page
   coherent and the diff small — document which you chose in the PR notes.

### 5c. Leads table — `src/components/dashboard/leads-table.tsx`
- Add a per-row **⋯ actions menu** (DropdownMenu) in a trailing actions cell. None exists today
  (rows are checkbox + name link only) — this is the seam for future row actions.
- One item now: **Edit** → `router.push('/leads/${lead.id}?edit=1')`.
- Don't disturb existing bulk-toolbar actions, selection checkboxes, or the Column Manager.
- If a row-actions column needs registry awareness, follow the existing
  `columns-registry.tsx` anchor conventions; otherwise a fixed trailing cell is fine.

### 5d. Save semantics — follow the GOOD pattern, not the flagged one
**Required:** awaited PATCH, then `if (!res.ok) throw` → revert draft + **error toast**; on success →
update local lead state + **success toast**.
```ts
const res = await fetch(`/api/v1/leads/${lead.id}`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(changedFields),
});
if (!res.ok) { /* toast error, keep edit mode open, do NOT exit */ return; }
const updated = await res.json();
/* merge into local state, exit edit mode, success toast */
```
**Do NOT** copy the optimistic-no-`res.ok`-check pattern from the Package selector — that's a known
defect we're explicitly not repeating.

---

## 6. Permissions / roles

- Identity + intake fields: editable by **any role that can view the lead** (owner/admin, and
  counselors on their own assigned leads). No new gating needed beyond what the route already does.
- `it_agency` fields here are descriptive (company/designation/etc.), not assignment — same view-level
  permission. The admin-only fields (`assigned_to`, `owner_id`) are **not** in this surface, so no
  special handling is required.
- Counselor scoping in the PATCH route is already enforced — don't touch it.

---

## 7. Out of scope (state in PR, don't build)

- In-table inline editing / Add-Lead sheet reuse (declined).
- Editing stage, assignment, tags, lead-type, trip fields, package, professional custom-fields here.
- Bulk edit of multiple leads.
- Hard dedup blocking on email edit (soft warning only, and optional).
- Field-level edit history UI (audit log already records diffs server-side; no new UI).

---

## 8. Definition of done (verify before handing back)

- [ ] `npm run build` clean.
- [ ] `npx eslint --max-warnings 50 .` → 0 errors.
- [ ] Detail page: **Edit** button enters edit mode; name/email/phone/city/country/intake fields
      become inputs; Save persists; Cancel discards; success/error toasts fire; bad email/phone block
      Save with inline messages.
- [ ] Editing `email` updates `normalized_email` server-side (confirm via a read-back, not the shared
      prod DB — use a local/throwaway check or reason from the code path; do NOT mutate shared data).
- [ ] Table **⋯ → Edit** navigates to `/leads/[id]?edit=1` and auto-opens edit mode; param is
      stripped after.
- [ ] `it_agency` extra fields appear in edit mode **only** for `it_agency` tenants; hidden otherwise.
- [ ] No regression to existing inline controls (stage/assign/tags/type/trip/package/professional),
      bulk toolbar, selection, or Column Manager.
- [ ] `AddLeadSheet` still works (it now imports the shared validator) — create a lead, no behavior
      change.
- [ ] PR notes: which detail-page approach you chose (5b option a vs b), and whether the soft dedup
      warning was implemented or deferred.

---

## 9. Files you'll likely touch

| File | Change |
|---|---|
| `src/app/(main)/api/v1/leads/[id]/route.ts` | recompute `normalized_email` on email change |
| `src/lib/leads/lead-validation.ts` | **new** — shared `isValidEmail`/`isValidPhone`/rules |
| `src/components/dashboard/add-lead-sheet.tsx` | import shared validator (no behavior change) |
| `src/components/dashboard/lead/lead-detail-v2.tsx` | Edit button + `isEditing`/draft + `?edit=1` |
| `src/components/dashboard/lead/key-info-section.tsx` | flip relevant fields to inputs in edit mode (if 5b-a) |
| `src/components/dashboard/leads-table.tsx` | per-row ⋯ menu → Edit deep-link |
| `docs/FEATURE-CATALOG.md` | add "Lead edit (inline)" row after build |

Keep the diff tight and match surrounding code style (Tailwind v4 + shadcn idioms already in these
files). When done: build + lint green, then hand back to Opus for review — **no merge, no push.**
