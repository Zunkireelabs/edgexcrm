# Phase 3 Brief — Application detail page: surface client columns

**Branch:** `feature/application-uploads`
**Phase:** 3 of 4 (CODE — frontend, additive)
**Owner:** Sonnet executes · Opus reviews
**Depends on:** Phase 2 + patch (data on stage)

---

## Goal
Surface all the columns the Admizz client tracks on the **Application detail page**
(`src/industries/education-consultancy/features/application-tracking/pages/application-detail.tsx`).
Additive UI only — **no schema changes, no migration.**

## Already exists — DO NOT rebuild
- The applications PATCH API (`src/app/(main)/api/v1/applications/[id]/route.ts`) already accepts `assigned_to` and **auto-logs every change to an audit timeline** (`application.updated`, old→new diff). The detail page already renders that timeline (`ApplicationActivityTimeline`); `FIELD_LABELS` maps `assigned_to → "assignee"`. So the **assignment history (latest = current, dated) is already satisfied** once the assignee is editable in the UI. **No new migration, no logging to build.**
- **The parent lead is already available**: the route shell `src/app/(main)/(dashboard)/applications/[id]/page.tsx` fetches `fullLead` via `select("*")` (lines ~84-91) and passes it as the `fullLead: Lead | null` prop (currently used only in the left "Student Info" rail). **All lead columns are present — no new data loading for any field below.**
- Already shown on the detail page: university, program, intake, country, deadline, application-fee-paid, tuition fee, notes, stage stepper, timeline, created-by.

## Add these to the detail page

| # | Field | Source (already in props) | Editable? |
|---|---|---|---|
| 1 | **Application Executive** (assignee) | `application.assigned_to` | **Yes** — selector |
| 2 | Counselor | `fullLead.assigned_to` → resolve via `teamMemberNames` | read-only |
| 3 | Degree Level | `fullLead.degree_level` (top-level column; fallback `fullLead.custom_fields.degree_level`) | read-only |
| 4 | Processing Fee | `fullLead.pre_app_fee_status` / `pre_app_fee_amount` / `pre_app_fee_notes` | via ConsentCard (see #5) |
| 5 | Consent status | existing `ConsentCard` component (self-fetches from `/api/v1/leads/{leadId}/consent`) | reuse card |
| 6 | Days with Admizz | computed `floor((now − fullLead.created_at)/86400000)` + " days" | read-only |

### #1 Application Executive (the important one — drives the history)
- Show the current assignee **name** prominently (header/summary area), not buried. Resolve `application.assigned_to` through the already-loaded `teamMemberNames`/`teamMemberEmails` maps (fetched at `application-detail.tsx:129-143`).
- Add an assignee **selector** (tenant team members — same source as that `/api/v1/team` fetch). Match how `add-application-sheet.tsx` lists assignable users if it does.
- Wire `assigned_to` into the edit flow: add it to `startEdit` (load current) and `saveEdit`'s PATCH body (`application-detail.tsx:145-183`). Allow clearing to unassigned (null).
- On save, the existing audit log records it → timeline shows "Updated assignee · … · <user>" automatically. (Gate the selector behind `canManageApplications`.)

### #4 + #5 Processing Fee & Consent — render the existing ConsentCard
`ConsentCard` (`components/consent-card.tsx`) already manages **both** consent status **and** the Processing Fee block, and PATCHes `/api/v1/leads/{leadId}`. It is **not currently rendered** on the application detail page — just render it.
- Props it needs: `leadId` (= `fullLead.id`), `tenantId` (= `fullLead.tenant_id`), and the `pre_app_fee_*` values from `fullLead`. (`tenant_id` is on `fullLead` via `select("*")` — pass it through; it is not currently a prop on ApplicationDetail, so add it or read from `fullLead`.)
- Place it in the right rail near the other detail cards. This single addition covers both #4 and #5.

### #2 Counselor, #3 Degree Level, #6 Days with Admizz
- Read-only display in the left "Student Info" rail (where `fullLead` is already consumed, ~lines 272-300). Counselor resolves `fullLead.assigned_to` via `teamMemberNames` (fall back to email, else "Unassigned"). Degree from `fullLead.degree_level`. Days computed from `fullLead.created_at`.

## Scope / gate
- Stay inside the `application-tracking` feature folder + its page shell. No universal-file edits. Route is already industry-gated to `education_consultancy` — don't weaken it.
- `fullLead` can be null — guard all lead-level fields.

## Verify (stage / local `npm run dev` against stage DB)
- `npm run build` clean + `npx eslint --max-warnings 50` clean.
- Open a migrated app on stage (e.g. **Anil Kumar Mahato**): assignee (Samriti/Dikshya/etc.), counselor, degree level, processing fee, consent, and Days-with-Admizz all render correctly.
- Change the assignee → a new "Updated assignee" entry appears in the timeline.
- An unassigned app (one of the 17 NULL) shows "Unassigned" gracefully; a lead with null `fullLead` doesn't crash.
- Non-education tenant still 404s on the route.

## Report back
- Files changed, a description/screenshot of the detail page with the six fields, build + lint results.
- **STOP.** Await Opus review. (Prod is Phase 4.)
