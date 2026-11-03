# BRIEF — Port Hardik's `feature/site-revamp` work onto current stage

**Owner:** Sonnet (executor) · **Reviewer:** Opus · **Industry:** education_consultancy
**Source:** unmerged commits by `hardik` on `feature/site-revamp` (dated 2026-06-26), badly stale (predates global-search #47, lead-id #49, combined #52). **Do NOT rebase/merge that branch** — re-apply the wanted commits onto a fresh branch off current `stage`.

## Scope — implement these 5, skip the rest

| Apply | Commit | Feature |
|---|---|---|
| ✅ | `30f51ae` | Confirm modal on list change (per-destination message) |
| ✅ | `745b379` | Meetings: In Person / Online type in Log Meeting |
| ✅ | `10401bf` | Tasks sub-tab made functional via shared checklist |
| ✅ | `3e79c77` | Application-detail spacing pass |
| ✅ | `5617559` | "Pre Application" rename + lead-level fee (+ migration) |
| ⛔ SKIP | `055edcc`/`41122de` | "Created By" card — **already on stage** (PR #52, `application-detail.tsx:302`). Do not re-add. |
| ⛔ SKIP | `55615d6` | Shell account menu + branch switcher — **already implemented** separately. Do not touch shell.tsx. |
| ⛔ SKIP | `8cd3d01` | Notifications polish — already shipped (PR #52). Do not touch notifications-dropdown.tsx. |

## Strategy
Fresh branch off latest `stage` (e.g. `feature/site-revamp-port`). For each feature, prefer `git cherry-pick -x <sha>` (preserves Hardik's authorship); where it conflicts, use `git show <sha>` as the spec and hand-apply onto stage's current file. Commit **per feature** (revertible). Apply in the order below (easy → hard).

---

### 1. `745b379` — Meetings In Person/Online (🟢 clean, no DB)
`git cherry-pick -x 745b379` — all 3 files are unchanged on stage, applies clean.
- Files: `api/v1/leads/[id]/activities/route.ts`, `lead/activities/activity-card.tsx`, `lead/activities/log-activity-modal.tsx`.
- Adds a "Meeting Type" dropdown (In Person / Online, default In Person) to Log Meeting; location field adapts (Location/Office address vs Meeting Link/Zoom URL); stored in the activity's existing `metadata` JSONB; API validates `meeting_mode ∈ {in_person, online}`; the logged-meeting card labels Location:/Link: accordingly. **No migration.**

### 2. `30f51ae` — Confirm modal on list change (🟢 clean)
`git cherry-pick -x 30f51ae` — `move-to-list-selector.tsx` matches Hardik's base exactly, applies clean.
- Gates every **non-archive** list move (e.g. Pre-qualified → Qualified) through a Settings-styled confirm Dialog (`overlayClassName="bg-[#0000004d] backdrop-blur-[2px]"` — supported by our `ui/dialog`), per-destination message keyed by list slug + generic fallback. Since it lives in the shared `MoveToListSelector`, it covers **both** render sites (leads-table rows + lead-detail key info). Archive drop-reason panel, PATCH, bulk, and Qualify-button flows are unchanged.
- Verify it doesn't double-prompt with the green "Qualify →" button (separate component/path — it shouldn't).

### 3. `10401bf` — Tasks sub-tab functional (🟡 minor merge, no DB)
Cherry-pick; expect a conflict only in `lead-detail-v2.tsx` (stage has the display_id badge from #52 — different lines, resolve by keeping both).
- Files: `lead/activities/activities-panel.tsx` (clean), `lead/lead-tabs.tsx` (clean), `lead/management-panel.tsx` (clean, exports `ChecklistCard`), `lead/lead-detail-v2.tsx` (merge).
- Wires the existing `ChecklistCard` into the Tasks sub-tab (replacing the placeholder), threading `checklists` + `onChecklistsChange` from `lead-detail-v2 → lead-tabs → activities-panel` so the tab and right-rail stay in sync. Reuses the `lead_checklists` backend — **no DB/API changes.**

### 4. `3e79c77` — Application-detail spacing pass (🟡 merge around Created-By)
- Files: `lead/contact-card.tsx` (clean), `application-tracking/components/stage-stepper.tsx` (clean), `application-tracking/pages/application-detail.tsx` (**diverged** — now contains the shipped Created-By card).
- Apply Hardik's layout changes (`max-w-7xl mx-auto → w-full`, center `space-y-6 → space-y-4`, card `p-4 → p-5`, widened Details rail via minmax, tighter stepper, ContactCard action row `justify-between` + `h-9` circles so all 5 buttons fit) **on top of** the existing Created-By card — do not remove or duplicate the card.

### 5. `5617559` — "Pre Application" rename + lead-level fee (🔴 hardest)
- **Migration:** Hardik's file is `084_lead_pre_application_fee.sql` — **renumber to `086_lead_pre_application_fee.sql`** (084/085 are taken). Keep its `ADD COLUMN IF NOT EXISTS` body verbatim (adds `pre_app_fee_status` CHECK(paid|unpaid|waiver), `pre_app_fee_amount NUMERIC(14,2)`, `pre_app_fee_notes TEXT`). **NOTE: these columns already exist on BOTH stage and prod DBs** (added ad-hoc during the go-live), so applying the migration is a **no-op** — it's in the repo only for fresh-DB correctness. Do **not** expect/require a schema change on stage.
- `types/database.ts` (clean): add the three `pre_app_fee_*` fields to the `Lead` interface.
- `api/v1/leads/[id]/route.ts` (**diverged** — has lead-id/assignDisplayIds changes): add the three fields to the PATCH whitelist + validation (`pre_app_fee_status` must be one of paid|unpaid|waiver), merging into the existing whitelist section — do not disturb the assignDisplayIds logic.
- `application-tracking/components/consent-card.tsx` (**diverged — real manual merge**): stage's version has the consent-in-person work (#46) that Hardik's base lacks. Keep all consent-in-person behavior intact; layer on Hardik's changes: title → "Pre Application", a "Fee Paid?" dropdown (paid/unpaid/waiver) with a conditional Amount field (when paid) + Notes + Save, read-only when `!canManage`. Use `git show 5617559 -- .../consent-card.tsx` as the spec and port the additions by hand.
- `lead/lead-detail-v2.tsx` + `lead/lead-tabs.tsx` (diverged): thread current fee values (`pre_app_fee_*` off the lead) into the card; merge with existing changes.

---

## Gotchas (recap)
- **Skip** Created-By, shell/branch-switcher, notifications — all already on stage; touching those files re-introduces conflicts/dupes.
- Migration renumber **084 → 086**; idempotent no-op on stage/prod (cols exist).
- `consent-card.tsx` is the one true hand-merge — preserve consent-in-person.
- Authorship: cherry-pick keeps Hardik as author (good); the repo commit-msg hook will swap the co-author line.

## Verification (local dev → stage DB)
- `npm run build` clean + `npx eslint --max-warnings 0` clean on all changed files.
- **Confirm modal:** change a lead's list via the pill (Pre-qualified→Qualified) → tailored confirm dialog; Cancel aborts, Confirm moves; archive still shows the drop-reason panel; Qualify button still works without double-prompt.
- **Meetings:** Log Meeting → In Person/Online toggle adapts the field; saved card shows the type + Location/Link label.
- **Tasks tab:** add/complete/delete a task in the Tasks sub-tab; right-rail checklist stays in sync live.
- **Spacing:** application detail fills width, 5 action buttons fit, Created-By card still present and intact.
- **Pre Application:** card titled "Pre Application"; set Fee Paid?=paid → Amount appears; Save persists `pre_app_fee_*`; read-only for non-managers; consent-in-person still works.

## Rollout
One combined branch off stage, per-feature commits → one PR to **stage** → verify on dev. Migration 086 is a no-op on stage/prod but apply it on stage for the record. **STOP at review** — do not push to stage, do not merge, do not apply anything to prod. Report back with diff + per-feature verification; Opus re-runs gates and reviews before anything ships.
