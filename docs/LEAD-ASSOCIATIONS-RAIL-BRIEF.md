# Lead Detail — Associations Rail (education_consultancy)

> **Status:** planned, branch + brief done. Awaiting Sonnet build. Stop-at-review.
> **Branch:** `feature/lead-associations-rail` (off `origin/stage` @ `852154d`, includes Application Tracking + inner page). PR target: **`stage`**.
> **Scope:** repurpose the lead/prospect detail **right rail** into a HubSpot-style **associations stack**. v1 = an **Applications** card; **Classes** card slots in later.
> **No migration, no new API** — pure UI re-org reusing existing endpoints.
> **Owner:** Opus plans/reviews · Sonnet implements (stop-at-review) · Sadin = visual smoke.

---

## 1. Why

On `/leads/[id]` (education prospects), Applications are buried in a center **tab**, and the right rail
shows a **Checklist** that's redundant with **Activity → Tasks**. Per HubSpot/Salesforce, the right rail
should be the **associations / related-records** panel (compact cards for the record's child records:
applications now, classes later) — an at-a-glance read on "what's active for this prospect."

**Change (education_consultancy only):** right rail becomes an associations stack; v1 holds an
**Applications card** (replaces the Checklist for prospects); the center **Applications tab is removed**
(the rail + the inner page `/applications/[id]` replace it).

## 2. Locked decisions (from Sadin)

1. **Remove the center Applications tab** — the right-rail card + inner page replace it.
2. **Education-only** change — other industries keep their Checklist (`ManagementPanel`) untouched.
3. **Prospects only** — the Applications card shows when `lead_type='prospect'`.
4. **Opus call (flag for override):** for an education **non-prospect** lead, keep the existing Checklist
   (avoids an empty rail); the associations rail kicks in once the lead is a prospect. Net: education +
   prospect → Applications card (no checklist); education + non-prospect → Checklist; non-education → Checklist.

## 3. Before / after (right rail)

```
NON-EDUCATION (unchanged)        EDUCATION + PROSPECT              EDUCATION + non-prospect
┌ CHECKLIST ──────┐              ┌ Applications (N)   + ┐          ┌ CHECKLIST ──────┐
│ + Add task      │              │ U. of Sydney         │ →/applications/[id]  │ + Add task │
└─────────────────┘              │  ● Conditional Offer │          └─────────────────┘
                                 │ [ + Add Application ]│
                                 └──────────────────────┘
                                 (stack — future: Classes card)
```

## 4. Build plan (one PR to `stage`)

- **A1 — Compact `applications-card.tsx`** (`src/industries/education-consultancy/features/application-tracking/components/`):
  props `{ leadId, canManage }`. Fetches `GET /api/v1/leads/[id]/applications`. Renders a Card in **our
  design language** (match `ManagementPanel`/lead-detail card style): header `Applications (N)` + (when
  `canManage`) an **Add Application** button; compact rows — `university_name` + `StatusBadge` (current
  stage) + `intake_term` muted; **each row is a `<Link>` to `/applications/[id]`**; empty state "No
  applications yet". Add → opens the per-lead add sheet (A2) → on success refetch the list. Reuse
  `status-badge.tsx`.
- **A2 — Extract the per-lead Add sheet** currently inline in `applications-panel.tsx` (the simple
  university/program/intake/country/stage/deadline form that POSTs to `/api/v1/leads/[id]/applications`,
  no lead-search) into its own file (e.g. `add-application-to-lead-sheet.tsx`) so the card uses it. (The
  global board's `add-application-sheet.tsx` with lead-search is separate — leave it.)
- **A3 — `lead-detail-v2.tsx` right column** (`:547-556`): make industry-aware. Replace the bare
  `<ManagementPanel>` with:
  ```
  industry_id === "education_consultancy" && currentLead.lead_type === "prospect"
    ? <div className="space-y-4">           {/* associations stack — future cards append here */}
        <ApplicationsCard leadId={currentLead.id} canManage={canManageApplications ?? isAdmin} />
      </div>
    : <ManagementPanel ... />                {/* unchanged for everyone else */}
  ```
  `canManageApplications` is already in scope here (it's passed to `LeadTabs` at `:527`).
- **A4 — `lead-tabs.tsx`**: remove the Applications `<TabsTrigger value="applications">` and its
  `<TabsContent>` (the `industryId==="education_consultancy" && lead.lead_type==="prospect"` blocks), and
  the now-unused `ApplicationsPanel` import + the `canManageApplications` prop (only used by that tab —
  drop it from `LeadTabsProps` and the `lead-detail-v2.tsx` `<LeadTabs>` call; keep `canManageApplications`
  available in lead-detail-v2 for the rail).
- **A5 — Delete orphaned `applications-panel.tsx`** (was only used by the removed tab; its Add sheet was
  extracted in A2). Confirm no other imports first.
- **A6 — Docs**: `FEATURE-CATALOG.md` (Applications now in the lead associations rail, tab removed),
  `SESSION-LOG.md` entry, `STATUS-BOARD.md` update.

## 5. Gating & scope
- Education_consultancy only; Applications card only when `lead_type='prospect'`.
- Add/writes gated by `canManage` (`canManageApplications`); read-only card for users without it.
- **No new migration, no new API route** — reuses `GET`/`POST /api/v1/leads/[id]/applications`.
- Right rail is a **stack** (`space-y-4`) so a future **Classes** card is purely additive here.

## 6. Out of scope (v1)
Classes card (future), removing the Checklist for non-prospect/other tenants, any change to the global
`/Applications` board or the `/applications/[id]` inner page.

## 7. Verification (Sonnet runs; Opus re-runs the gates)
- `npm run build` clean + `npx eslint --max-warnings 50` clean (paste output). No DB writes.
- Gate matrix (use the demo prospect `114dc3a3-…` on dev):
  - Education **prospect** lead → right rail shows **Applications card** (count + row → `/applications/[id]`,
    Add Application); **no center Applications tab**; **no Checklist**.
  - Education **non-prospect** lead → Checklist still shown; no Applications card; no Applications tab.
  - **Non-education** lead → Checklist unchanged; nothing application-related.
  - Counselor **without** manage permission → card read-only (no Add button); rows still link out.
  - Other lead-detail features (Overview/Notes/Activity/AI tabs, Key Info, ContactCard) unaffected.
- Pixel/visual smoke = Sadin.

## 8. Execution model
Sonnet builds **stop-at-review** (commit to `feature/lead-associations-rail` only — no push, no PR, no DB).
Opus reviews + re-runs gates, then pushes + PR to stage. Prod only on Sadin GO.

---

## 9. Sonnet handoff prompt (copy-paste)

```
Implement the Lead Detail "Associations Rail" for edgeX CRM (education_consultancy). Full spec:
docs/LEAD-ASSOCIATIONS-RAIL-BRIEF.md — read it completely. Context: on /leads/[id] for education
prospects, move Applications from a center TAB into the RIGHT RAIL as a compact HubSpot-style
associations card, and remove the redundant Checklist there (it's redundant with Activity → Tasks).

You are ALREADY on branch feature/lead-associations-rail (off origin/stage, which includes Application
Tracking + the /applications/[id] inner page). Do all work here.

Build A1→A6 from the brief. Key rules:
- A1: new COMPACT applications-card.tsx (in application-tracking/components) — fetch
  GET /api/v1/leads/[id]/applications, render "Applications (N)" + Add (when canManage) + compact rows
  (university_name + StatusBadge + intake_term), each row a <Link> to /applications/[id]; empty state.
  Use OUR design language (match ManagementPanel / lead-detail card style), NOT HubSpot's look.
- A2: extract the per-lead Add sheet currently inline in applications-panel.tsx (the one POSTing to
  /api/v1/leads/[id]/applications, no lead-search) into its own file; the card opens it.
- A3: lead-detail-v2.tsx right column (~:547) — industry-aware: education_consultancy && lead_type==='prospect'
  → a space-y-4 stack containing <ApplicationsCard leadId canManage={canManageApplications ?? isAdmin}/>;
  else → <ManagementPanel> unchanged.
- A4: lead-tabs.tsx — remove the Applications TabsTrigger + TabsContent + the ApplicationsPanel import +
  the now-unused canManageApplications prop (keep it available in lead-detail-v2 for the rail).
- A5: delete the orphaned applications-panel.tsx (confirm no other imports first).
- NO new migration, NO new API route. Reuse existing endpoints + status-badge.tsx.

STOP AT REVIEW: commit to feature/lead-associations-rail only — NO push, NO PR, NO DB writes. Run
`npm run build` and `npx eslint --max-warnings 50` and paste the real output. Re-verify the gate matrix in
the brief (education prospect → Applications card in rail, no tab, no checklist; education non-prospect →
checklist stays; non-education → unchanged). Then hand back for Opus review.
```

---

## 10. Round 2 — UI: richer Applications card (Sadin-approved, 2026-06-20)

Sonnet built the rail (`bd85c73`, gates green). The card rows are a **single cramped line**
(`university_name` truncated + intake + badge). Sadin wants each application shown as a **HubSpot-style
mini detail card** with more fields visible. **Single-component change to `applications-card.tsx`** — no
data/logic change (data is already fetched).

Replace the one-line `<Link>` row with a **bordered mini-card per application**, stacked `space-y-2`, the
whole card linking to `/applications/[id]` (`hover:bg-muted/30`, `border rounded-md p-3`, our design
language). Per application show:

```
┌───────────────────────────────────────┐
│ University of Sydney            →      │  app.university_name — full title, no truncate (allow wrap), font-medium
│ MSc Data Science                       │  app.program_name — text-sm text-muted-foreground
│ Fall 2026 · Australia                  │  app.intake_term · app.country — text-xs muted (join with " · " only when both present; omit gracefully if either missing)
│ ● Conditional Offer    Sep 15, 2026    │  <StatusBadge .../> + app.application_deadline formatted (toLocaleDateString month-short/day/year) when set
└───────────────────────────────────────┘
```

Keep unchanged: the header (`Applications (N)` + Add button), loading spinner, empty state, and the
`AddApplicationToLeadSheet`. Stage object resolution stays as-is (`app.application_stages ?? stages.find(...)`).
No "View all" footer (the card lists all of the student's applications; the per-student tab is gone).

### Round-2 gate (same stop-at-review)
`npm run build` + `npx eslint --max-warnings 50` clean (paste output). No DB writes. Commit to
`feature/lead-associations-rail` only — no push, no PR. Re-verify: the rail card shows university +
program + intake·country + stage badge + deadline per application; clicking a card opens `/applications/[id]`.

### Sonnet handoff prompt (Round 2)

```
Round 2 UI refinement for the Lead Associations Rail. Spec: §10 "Round 2 — UI: richer Applications card"
in docs/LEAD-ASSOCIATIONS-RAIL-BRIEF.md (committed on this branch) — read it. You are on
feature/lead-associations-rail.

Single change: in
src/industries/education-consultancy/features/application-tracking/components/applications-card.tsx,
replace the cramped one-line row with a bordered mini-card per application (stacked space-y-2, the whole
card a <Link> to /applications/[id], border rounded-md p-3 hover:bg-muted/30 — our design language). Per
application show, on separate lines: university_name (full title, font-medium, NO truncate — allow wrap);
program_name (text-sm muted); intake_term · country (text-xs muted, join with " · " only when both present,
omit gracefully if either missing); and a row with the StatusBadge + the application_deadline formatted
(toLocaleDateString month:'short',day:'numeric',year:'numeric') when set. Keep the header (Applications (N)
+ Add), loading spinner, empty state, AddApplicationToLeadSheet, and stage resolution unchanged. No data or
logic changes.

STOP AT REVIEW: commit to feature/lead-associations-rail only — NO push, NO PR, NO DB writes. Run
`npm run build` and `npx eslint --max-warnings 50` and paste the real output. Then hand back for Opus review.
```
