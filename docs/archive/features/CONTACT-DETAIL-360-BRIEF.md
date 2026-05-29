# Contact detail page — Lead-style 360° redesign

> Restructure `/contacts/[id]` from a single-column form view into a 3-column "stakeholder 360°" page that mirrors the Lead detail v2 shape. Same visual chrome as the Lead page, but the **semantics shift**: where the Lead page is solitary ("work this person"), the Contact page is **relational** ("understand this person in the context of their account"). UI restructure + 2 small backend additions; no DB migrations in v1.

---

## Goal

Today's `/contacts/[id]` is a single-column-ish layout: back nav + name + status + edit/delete icons; a "Contact Info" card with email/phone/account next to a "Projects" card with role pills; an optional "Notes" card rendering `contact.notes` as a text blob. It's functional but reads as a form view, not a stakeholder summary.

The user wants `/contacts/[id]` to feel as substantive as `/leads/[id]` — the Lead detail v2 (`src/components/dashboard/lead/lead-detail-v2.tsx`) is the reference. That page has a 3-column layout: identity + key info on the left, tabbed content in the middle, related work on the right.

This brief mirrors that shape for contacts, with **CRM-expert-informed differences** that account for the fact that contacts are post-conversion stakeholders (not pipeline-stage leads).

---

## What the CRM domain expert pushed back on

Before locking scope, an industry-best-practice review by the `/crm-expert` skill flagged five things to NOT copy from the Lead page:

1. **Don't show "Stage" or "Convert to Contact"** — contacts are post-conversion; no pipeline stage applies.
2. **Don't carry over "Assigned To" as-is** — leads have a counselor assignee; contacts inherit the *account owner*. Surface that on the Account card in the right column, not as a separate field.
3. **Don't blindly copy the Lead "AI Insights" tab** — for a lead it means qualification-readiness; for a contact, the AI signal is undefined. Skip entirely in v1; revisit only if we can name the signal.
4. **Don't add a "Score"** — same reason. Lead score = qualification. Contact score = ill-defined. Skip.
5. **Don't build a parallel tasking system on contacts** — project tasks already exist. Adding a Lead-style checklist on contacts competes with project ownership of tasks. CRM-expert recommendation: omit the right-column Checklist entirely in v1; possibly add "Relationship Reminders" in a future brief if the owner asks.

And **the right column ordering Sadin proposed ("projects + account + real work types") got flipped**: the expert says **Account first, then Projects, then Related Contacts**. Account is the umbrella; everything else nests under it.

---

## Scope

### In scope (v1)

1. **3-column layout** matching `lead-detail-v2.tsx`'s grid: `grid-cols-1 lg:grid-cols-[280px_1fr] xl:grid-cols-[280px_1fr_320px] gap-6`.
2. **Left column**: `ContactSummaryCard` (avatar + name + status badge + email/phone + 5 action buttons) + `ContactKeyInfoSection` (Title · Account link · Account owner · Created · Last updated).
3. **Middle column**: tabbed content. **v1 ships with one wired tab — Overview**. The tab strip is scaffolded for Notes / Activity but those tabs are explicitly disabled or labeled "Coming soon" so v2 expansion is one-step.
4. **Right column**: `AccountCard` (org name + owner + project count + sibling-contact count) → `LinkedProjectsCard` (existing project-link UI, relocated from middle) → `RelatedContactsCard` (other contacts at the same account) → `LeadProvenanceCard` (only when this contact was converted from a lead).
5. **Two small backend additions** to extend `/api/v1/contacts/[id]` GET response with: (a) `source_lead` (one row from `leads` where `converted_contact_id = this contact's id`, or null), (b) `account_siblings` (other contacts at the same `account_id`, excluding self, capped at e.g. 10 for the v1 card; show "see all" link if there are more).
6. **Action buttons on left card** (CRM-expert recommended set): **Note · Email · Call · Add to Project · More**. "More" dropdown contains: Set as Primary Contact (when not already primary; PATCH the account's `primary_contact_id`) · Edit (opens `ContactForm`) · Delete (admin only, with confirmation).
7. **Header restructure**: `← Contacts` back link · contact name + status badge inline · (right) edit/delete icon buttons hover-revealed (preserved from current).
8. **Preserve all existing features**: ProjectContactPicker dialog, role-change dropdown on project links, remove-project-link confirmation, ContactForm edit dialog, delete confirmation. Just relocated into the new column structure.

### Out of scope (deferred to v2)

- **`contact_notes` migration + Notes timeline composer.** Today `contact.notes` is a single text blob. Building a notes-table-backed timeline (like `lead_notes`) requires a DB migration + new API routes + composer UI. v2 brief. In v1, the notes blob lives inside the Overview tab with the existing edit-via-`ContactForm` pattern; "Notes" tab in the strip is disabled with a "Coming soon" hover hint.
- **Contact activity audit log.** Today contacts have no activity history. v2 could either filter the existing `events` table or add a new `contact_activities` table. v1 leaves the "Activity" tab disabled with "Coming soon" hover hint.
- **Last interaction date.** A computed/cached field on contact (`MAX(updated_at)` across notes/activities/project links). Out of scope without the timeline + audit log to feed it. v2.
- **"Log Meeting" action.** CRM-expert flagged meetings as agency-specific high-value. Needs either a `meetings` table or a notes-table with type discriminator. v2 brief — drop from the v1 action set entirely (do NOT add a stub action that just shows a "Coming soon" toast; that's noise).
- **AI Insights tab.** No clear contact-specific signal. Don't add the tab.
- **Checklist / Reminders.** Per CRM-expert pushback, no v1 parallel tasking. v2 only if explicitly requested.
- **Communications history** (emails / calls timeline). HubSpot's killer feature, requires Gmail / calendar integration. v3 territory.
- **The Lead-page subcomponents** (`src/components/dashboard/lead/`) are NOT moved or shared. They stay lead-shaped. Build contact equivalents in `src/industries/it-agency/features/crm-contacts/components/contact-detail/` instead.

---

## Layout — per column

Use the same 3-column grid as `lead-detail-v2.tsx:250`:

```tsx
<div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] xl:grid-cols-[280px_1fr_320px] gap-6">
  {/* Left, Middle, Right */}
</div>
```

### Left column (280px)

**`ContactSummaryCard`** — modeled on `src/components/dashboard/lead/contact-card.tsx`. Visual structure:

- Large avatar circle with initials (use existing `getInitials` pattern from `accounts-list.tsx:120`-ish — same helper exists in multiple places).
- Name (text-xl font-semibold #0f0f10).
- `ContactStatusBadge` below the name (existing component).
- Truncated email and phone with copy-to-clipboard tooltips (mirror `lead/contact-card.tsx`'s `CopyButton` pattern).
- Action button row (5 buttons, horizontal, each a circle + label below — same `QuickActionButton` shape used on Lead):
  1. **Note** — scrolls to the Notes block within the Overview tab and focuses the textarea (because we're not building a notes composer in v1, this opens `ContactForm` with the notes field auto-focused).
  2. **Email** — `mailto:`. Disabled when `!contact.email`.
  3. **Call** — `tel:`. Disabled when `!contact.phone`.
  4. **Add to Project** — opens the existing `ProjectContactPicker` (mode="pick-project").
  5. **More** — `DropdownMenu` containing: Set as Primary Contact · Edit · Delete (admin only).

**`ContactKeyInfoSection`** — modeled on `lead/key-info-section.tsx`. Single section with a header "KEY INFORMATION" (uppercase, tracking-wide, text-xs text-muted-foreground), then key/value rows:

- **Status** — `ContactStatusBadge` (display-only in v1; editing via ContactForm edit flow).
- **Title** — text field (display-only in v1, edit via ContactForm).
- **Account** — Link to `/accounts/[id]` showing account name.
- **Account owner** — display the account's `owner_id`'s email if available (this is the contact's effective assignee, surfaced here per CRM-expert recommendation rather than as a separate "Assigned To" row).
- **Created** — formatted date.
- **Last updated** — formatted date.

### Middle column (flex)

**`ContactTabs`** — single wired tab in v1.

**Tab strip**: `<Tabs>` with three triggers (Overview · Notes · Activity). Notes and Activity have `disabled` prop set + tooltip "Coming soon" on hover (mirror shadcn's disabled trigger pattern).

**Overview tab** contains three stacked cards:

1. **Personal Information** card — Full Name · Email · Phone (read-only display in `key:value` two-column layout mirroring `lead/info-section.tsx`).
2. **Professional Details** card — Title · Account (link) · Status · Notes (the blob, shown with whitespace-pre-wrap; empty-state "No notes yet"). Card has an "Edit" icon button in the top-right that opens `ContactForm`.
3. *(no third card in v1 — leave it at two cards for cleanliness)*

**Notes / Activity tabs**: disabled in v1. The disabled-tab visual + hover hint "Coming soon" is enough — don't render empty content panels.

### Right column (320px)

**`ContactRelatedPanel`** — orchestrator. Renders four cards top-to-bottom in this order (per CRM-expert):

1. **`AccountCard`** — top of the column. Account name (Link to `/accounts/[id]`) · "Owner: {email}" (the account's owner_id email) · two small badges: "{N} projects" + "{N} other contacts". Compact, ~80px tall.
2. **`LinkedProjectsCard`** — relocated from the current page's middle "Projects" card. Same content (role badges, change-role dropdown, remove action, "Add to project" button) — just visually re-skinned to match the right-column card chrome. Add the `FileText` icon next to "Projects" header (already in current code).
3. **`RelatedContactsCard`** — other contacts at the same account, sourced from the extended `/api/v1/contacts/[id]` GET response (see Backend section). Each row: avatar circle (initials) · name (Link to `/contacts/[id]`) · title (text-xs muted). Cap at first 10; if `account_siblings.length > 10`, show a "See all at {account.name}" link at the bottom pointing to `/accounts/[id]`. Empty state: "No other contacts at this account yet."
4. **`LeadProvenanceCard`** — **only renders when `source_lead` is non-null**. Compact card with: "Converted from lead" label · `← {lead.first_name} {lead.last_name}` link to `/leads/[id]` · created date of the lead. If the contact wasn't converted from a lead (was created directly), this card is omitted entirely (don't render an empty state).

---

## Backend additions

Two small changes to **one existing endpoint**. No new routes, no migrations.

### Extend `GET /api/v1/contacts/[id]`

**File**: `src/app/(main)/api/v1/contacts/[id]/route.ts` (existing).

Add two fields to the response payload:

```ts
{
  // existing fields...
  data: {
    ...contact,
    accounts: { id, name } | null,       // already exists
    project_contacts: [...]               // already exists
    source_lead: {                        // NEW — null when not converted
      id, first_name, last_name, created_at
    } | null,
    account_siblings: [                   // NEW — empty array when none
      { id, first_name, last_name, title }, ...  // capped at 10
    ]
  }
}
```

**Implementation notes for Sonnet:**

- **`source_lead`**: query `leads` table for `WHERE converted_contact_id = contact.id AND tenant_id = auth.tenantId LIMIT 1`. Select only `id`, `first_name`, `last_name`, `created_at`. Use `scopedClient(auth)` per CLAUDE.md's tenant-isolation rule (or follow the existing pattern in this route file — if the route currently uses raw `createServiceClient()` + `.eq("tenant_id", ...)`, mirror that and don't migrate the whole route in this brief).
- **`account_siblings`**: query `contacts` table for `WHERE account_id = contact.account_id AND id != contact.id AND tenant_id = auth.tenantId ORDER BY first_name ASC LIMIT 10`. Select only `id`, `first_name`, `last_name`, `title`. Skip the query entirely when `contact.account_id` is null.
- Both queries run in parallel with the existing fetches via `Promise.all`.
- Counselor scoping: contacts are not counselor-scoped today (per the `crm-contacts` Phase E postmortem in SESSION-LOG), so no special filter is needed for `account_siblings`. `source_lead` does need counselor scoping if the source lead has an `assigned_to` — but in practice, if a counselor can see the contact, they can see the source lead too (the contact wouldn't exist if the lead wasn't converted by someone). Skip the assigned_to filter on `source_lead` for v1.

### NO other backend changes

- No new endpoints.
- No DB migrations.
- No changes to `/api/v1/contacts/[id]` PATCH or DELETE.
- No changes to `/api/v1/contacts/[id]/projects/*`.

---

## Files to touch

| File | Change | LOC est. |
|---|---|---|
| `src/industries/it-agency/features/crm-contacts/pages/contact-detail.tsx` | **Rewrite**. Replace current single-column structure with the 3-column layout. Delegate to new subcomponents. State management for `contact`, `loading`, `editOpen`, `deleteOpen`, `projectLinks`, `pickerOpen`, `removeTarget`, `removing`, `changingRoleFor` stays here (orchestrator pattern). | ~250 (down from 498) |
| `src/industries/it-agency/features/crm-contacts/components/contact-detail/contact-summary-card.tsx` | **New**. Avatar + name + status + email/phone + 5 action buttons. Modeled on `src/components/dashboard/lead/contact-card.tsx`. | ~180 |
| `src/industries/it-agency/features/crm-contacts/components/contact-detail/contact-key-info-section.tsx` | **New**. KEY INFORMATION section: Status / Title / Account / Account owner / Created / Last updated. Modeled on `src/components/dashboard/lead/key-info-section.tsx` (much simpler — no editable dropdowns; all display-only in v1). | ~80 |
| `src/industries/it-agency/features/crm-contacts/components/contact-detail/contact-tabs.tsx` | **New**. Tabs orchestrator: Overview (wired) · Notes (disabled) · Activity (disabled). Renders the Personal Information + Professional Details cards inside Overview. Receives `contact` + `onEditClick` callback. | ~120 |
| `src/industries/it-agency/features/crm-contacts/components/contact-detail/contact-related-panel.tsx` | **New**. Orchestrator for the right column. Renders AccountCard → LinkedProjectsCard → RelatedContactsCard → LeadProvenanceCard (conditional). Passes the project-link state + handlers down. | ~80 |
| `src/industries/it-agency/features/crm-contacts/components/contact-detail/account-card.tsx` | **New**. Account name + owner email + project count + sibling count badges. ~50 LOC. | ~50 |
| `src/industries/it-agency/features/crm-contacts/components/contact-detail/linked-projects-card.tsx` | **New**. The existing project-links UI (with role pills, change-role dropdown, remove action, Add to project button) extracted from the current `contact-detail.tsx`. Same logic, just relocated. | ~120 |
| `src/industries/it-agency/features/crm-contacts/components/contact-detail/related-contacts-card.tsx` | **New**. List of `account_siblings` with avatars + names + titles. Empty state. "See all" link if `>10`. | ~60 |
| `src/industries/it-agency/features/crm-contacts/components/contact-detail/lead-provenance-card.tsx` | **New**. Conditional card: "Converted from lead" + link + date. Renders null when `source_lead` is null. | ~40 |
| `src/industries/it-agency/features/crm-contacts/components/contact-detail/index.ts` | **New**. Barrel export for the subcomponents. | ~10 |
| `src/app/(main)/api/v1/contacts/[id]/route.ts` | **Extend**. GET response gains `source_lead` + `account_siblings` fields. Add two parallel queries via `Promise.all`. PATCH and DELETE untouched. | ~30 new lines |

**Total: 11 files (10 new + 1 rewrite + 1 extend). ~1,020 LOC net.** Mostly new composition; the existing `contact-detail.tsx` shrinks by ~50% as logic moves to subcomponents.

---

## Patterns to reuse (from existing code)

- **Overall 3-column layout**: `src/components/dashboard/lead/lead-detail-v2.tsx:195-319`. Same grid template, same column widths, same gap. Don't reinvent.
- **Left-column avatar card**: `src/components/dashboard/lead/contact-card.tsx`. Avatar + name + status + email/phone + QuickActionButton row. Mirror the visual structure; swap lead-specific bits (stage color, WhatsApp button) for contact-specific ones.
- **Key info section**: `src/components/dashboard/lead/key-info-section.tsx`. Key/value rows with uppercase tracking-wide header. Don't include the editable Stage/Assignee dropdowns — contacts don't have those.
- **Tab strip**: `src/components/dashboard/lead/lead-tabs.tsx`. Same `<Tabs>` shape. Render `disabled` triggers for Notes + Activity in v1.
- **ContactStatusBadge**: existing at `src/industries/it-agency/features/crm-contacts/components/contact-status-badge.tsx`. Use as-is.
- **ContactForm**: existing at `src/industries/it-agency/features/crm-contacts/components/contact-form.tsx`. Use as the edit dialog (no changes).
- **ProjectContactPicker**: existing at `src/industries/it-agency/features/crm-contacts/components/project-contact-picker.tsx`. Use for the Add-to-project flow.
- **Role pill rendering**: existing `rolePill` function in current `contact-detail.tsx:64-82`. Extract into the new `linked-projects-card.tsx`.
- **Design tokens**: per the established design pass — primary text `#0f0f10`, secondary `#787871`, dropdown hover overlay `#0000170b`, status pills bg-green-50/700 + bg-gray-100/500, card chrome `border border-border bg-card rounded-lg`.

---

## Verification

Before merging:

- [ ] `npm run build` clean locally.
- [ ] `npx eslint --max-warnings 50 .` clean locally (CI hard gate).
- [ ] `/contacts/[id]` opens with the new 3-column layout.
- [ ] **Left column**:
  - Avatar shows correct initials.
  - Name + ContactStatusBadge render inline.
  - Email + phone with copy buttons (when present); buttons disabled when fields are null.
  - 5 action buttons (Note, Email, Call, Add to Project, More) render in a row with icon + label below.
  - Email/Call buttons launch `mailto:`/`tel:` correctly; disabled when field is null.
  - Note button opens ContactForm with the notes field focused (acceptable v1 substitute for a real notes composer).
  - Add to Project opens the existing ProjectContactPicker.
  - More dropdown contains: Set as Primary Contact (hidden if already primary at the account) · Edit · Delete.
  - KEY INFORMATION section shows: Status · Title · Account (link) · Account owner email · Created · Last updated.
- [ ] **Middle column**:
  - Tab strip shows Overview · Notes (disabled, "Coming soon" on hover) · Activity (disabled, "Coming soon" on hover).
  - Overview tab renders Personal Information card + Professional Details card.
  - Professional Details card has an Edit icon that opens ContactForm.
  - Notes blob renders as `whitespace-pre-wrap` text; empty state "No notes yet" when null/empty.
- [ ] **Right column** (in order top to bottom):
  - **AccountCard**: Account name (link) + owner email + "{N} projects" badge + "{N} other contacts" badge.
  - **LinkedProjectsCard**: same content as before (role pills, change-role dropdown, remove, Add to project button). All existing handlers work (link to project detail, role change persists, remove confirmation flow).
  - **RelatedContactsCard**: shows other contacts at the same account (max 10), each row links to their detail page. Empty state "No other contacts at this account yet." "See all" link only when >10.
  - **LeadProvenanceCard**: renders only when `source_lead` is non-null. Shows the link to the originating lead. Test by visiting a contact created via Lead → Contact conversion. Skip-render verified by visiting a contact created directly (no source lead).
- [ ] **Set as Primary Contact action** in More dropdown: PATCHes the account's `primary_contact_id` to this contact's ID; dropdown item is hidden when already primary; toast on success.
- [ ] **Edit / Delete flows preserved** — ContactForm edit dialog updates the page on save; Delete dialog deletes + navigates to `/contacts`.
- [ ] **API change**: `GET /api/v1/contacts/[id]` response includes `source_lead` (null or object) + `account_siblings` (array). Verify with a curl or browser DevTools.
- [ ] **`/contacts/[id]/projects` page** (if it exists): unchanged.
- [ ] **Non-IT-agency tenants**: `/contacts` is industry-gated to `it_agency` already — Admizz still gets the existing ProspectsView. Verify by switching tenants.
- [ ] **All 7 code-review checklist items** considered:
  - PostgREST embed FK disambiguation: relevant for the new `source_lead` query (leads ↔ contacts via `converted_contact_id` — confirm no reverse FK ambiguity).
  - PATCH preserves POST invariants: N/A (no POST/PATCH changes).
  - New page components need a route shell: N/A (route shell `/contacts/[id]/page.tsx` already exists).
  - `.select()` after insert/update: N/A (no inserts/updates in this brief).
  - Radix Select forbids empty-string `<SelectItem value="">`: relevant for the More dropdown — Set as Primary should use a proper handler, not a SelectItem.
  - Cross-cutting predicate audits: N/A.
  - Page-padding stacks with the shell: the dashboard shell already provides `p-4`; the current `contact-detail.tsx` uses `<div className="p-6 space-y-6 max-w-3xl">` which double-pads. **DROP the `p-6` and the `max-w-3xl`** in the rewrite — let the page use the full width of the shell and rely on the shell's padding. This mirrors the `/projects` workspace fix from `f9af70d`.

---

## Sonnet handoff prompt

Paste the block below to a fresh Sonnet session.

```
You're implementing a Contact detail page redesign on a feature branch. Read /Users/sadinshrestha/Projects/edgeXcrm/docs/CONTACT-DETAIL-360-BRIEF.md end-to-end before touching any code — it has the full scope (with explicit out-of-scope items), the file list, the exact patterns to mirror from the existing Lead detail v2 code, the small backend additions, and the verification checklist.

Workflow:
1. From the repo root, fetch latest stage and branch off it:
   git fetch origin && git checkout -b feat/contact-detail-360 origin/stage
2. Implement the 11 file changes per the brief:
   - 1 rewrite: contact-detail.tsx (the page orchestrator, shrinks ~50% as logic moves into subcomponents)
   - 9 new subcomponents under src/industries/it-agency/features/crm-contacts/components/contact-detail/ (summary-card, key-info-section, tabs, related-panel, account-card, linked-projects-card, related-contacts-card, lead-provenance-card, index)
   - 1 extend: src/app/(main)/api/v1/contacts/[id]/route.ts — add source_lead + account_siblings to the GET response via parallel queries
3. Verify locally before pushing:
   - npm run build  (clean)
   - npx eslint --max-warnings 50 .  (clean — this is the CI hard gate, local build does NOT run ESLint)
4. Self-check against the verification checklist at the bottom of the brief. Including the page-padding check (drop the existing p-6 + max-w-3xl on the wrapper — the dashboard shell at src/components/dashboard/shell.tsx:409 already provides p-4).
5. Commit with a clear message and push the branch. Don't merge; Opus reviews and squash-merges to stage.

Important constraints from the brief (and the CRM-expert review baked into it):
- This is a UI restructure + 2 small backend additions. NO database migrations. NO new API routes. The notes blob stays a blob; the notes timeline + contact_activities table are explicit v2 work.
- Notes tab and Activity tab in the middle column are DISABLED with "Coming soon" hover hints. Don't render fake/empty content panels for them. Only the Overview tab is wired in v1.
- Right column ordering is fixed: AccountCard → LinkedProjectsCard → RelatedContactsCard → LeadProvenanceCard (conditional). Don't reorder. The expert specifically flipped the user's proposed "projects + account + real" ordering because the account is the umbrella.
- LeadProvenanceCard renders nothing when source_lead is null (don't show an empty-state card).
- Do NOT add: Stage, Convert, AI Insights, Score, Checklist, Log Meeting action. All explicitly excluded by the brief's CRM-expert pushback section.
- Do NOT reuse or move src/components/dashboard/lead/ files — those stay lead-shaped. Build contact-shaped equivalents in the new components/contact-detail/ directory.
- DO drop the page wrapper's p-6 + max-w-3xl in the rewrite — this is the same dashboard-shell padding fix from f9af70d on /projects. The new code-review checklist item explicitly covers it.
- DO preserve all existing functionality: edit/delete dialogs, project link CRUD with role changes, ProjectContactPicker, etc. They just relocate into the new column structure.
- DO use design tokens from the design pass: #0f0f10 primary text, #787871 secondary, #0000170b dropdown hover overlay.

If anything in the brief is ambiguous or you find a real issue with the approach, surface it in the handoff back to Opus rather than guessing. Especially: if extending the existing GET endpoint feels wrong (e.g. the route uses an unusual pattern), call it out instead of forcing it.
```
