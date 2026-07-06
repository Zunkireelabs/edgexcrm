# LEAD LISTS — Build Brief (Phase 2) · for Sonnet, STOP-AT-REVIEW

**Branch:** create `feature/lead-lists-phase-2` off the **latest `origin/stage`** (Phase 1 is already merged there — PR #15). Work only on that branch.
**Scope:** `education_consultancy` only. it_agency / other industries must stay byte-for-byte unaffected.
**Context:** Phase 1 shipped lifecycle lists (Pre-qualified → Qualified → Prospects → Archived), move-to-list, dynamic nav, per-list position access. Migration 059 is already applied to the shared DB. Plan/rationale: `~/.claude/plans/now-what-we-need-enchanted-parrot.md`; Phase 1 brief: `docs/LEAD-LISTS-BRIEF.md`.

---

## 🛑 HARD GUARDRAILS — read first
1. **STOP AT REVIEW.** Build, commit to the branch, then **STOP and report**. Do **NOT** `git push`, open a PR, or merge.
2. **NO MIGRATION / NO DB WRITES.** Phase 2 is **code-only** — the `lead_lists` table and the `leads` columns (`list_id`/`destinations`/`field_of_study`/`degree_level`/`archive_reason`) already exist and are already in the PATCH allowlist. Do not write SQL, do not touch the shared DB.
3. Commit in the **2a then 2b** order below as **separate commits** so each can be reviewed independently.
4. Before reporting, run and paste output of `npm run build` **and** `npx eslint --max-warnings 50`. Both must be clean (≤50 warnings, 0 errors).
5. Do **NOT** do Phase 3 (new-tenant provisioning, counsellor cleanup) or any deferred item.

---

## PART 2a — Create fields + Qualify flow + clearer activity wording

### A. Structured education lead fields (seeded constant dropdowns)
Create a config module `src/industries/education-consultancy/features/lead-lists/taxonomies.ts` exporting constant option lists (tenant-level editing is a later follow-up — do NOT build settings UI for these):
- `DESTINATIONS` = UK, Australia, USA, Germany, New Zealand, Canada, Finland, India, Europe, Malta, France, Sweden, Not decided.
- `FIELDS_OF_STUDY` = Engineering & Technology, Business & Management, Medical & Pharmacy, Allied Health Sciences, Humanities & Social Sciences, Not decided.
- `DEGREE_LEVELS` = UG, PG, PhD.

Surface on the **Create Lead** sheet (`src/components/dashboard/add-lead-sheet.tsx`) — **education only** (gate on `industryId === "education_consultancy"`; for other industries the sheet is unchanged):
- **Interested Destination** — multi-select (chips/checkbox dropdown) → writes `destinations TEXT[]`.
- **Field of Study** — single-select → `field_of_study`.
- **Degree Level** — single-select (UG/PG/PhD) → `degree_level`.
- Keep them optional and visually grouped; **do NOT add Processing Fee / Consent** (those are prospect-stage, deferred). Keep the form lean.
- New education leads still land in the intake (Pre-qualified) list automatically (Phase 1 default) — no change needed.

Also show these three fields on the **lead detail** (`key-info-section.tsx` / detail rail) as editable (they're already in the leads PATCH allowlist). Reuse the existing inline-edit pattern there.

If there is a public/create-lead API path that builds leads from the dashboard, ensure it passes these fields through (they're already whitelisted in `PATCH /api/v1/leads/[id]`; for POST `/api/v1/leads` add them to the create payload allowlist if a create path exists).

### B. Qualify flow (Pre-qualified → Qualified)
The Lead Caller's "pass it on" action. When viewing a lead in the **Pre-qualified** list (row action + detail rail):
- A **"Qualify"** primary action that opens a small confirm step: review/edit Destination / Field of Study / Degree Level + an optional **note** (textarea), then on submit:
  - PATCH the lead → `list_id` = the tenant's **Qualified** list (reuse the move mechanics + access checks already in place), persisting any edited destination/field/degree.
  - If a note was entered, create a lead note via the existing `lead_notes` path (find how notes are created today — reuse it, don't invent).
- Only show "Qualify" when the lead is currently in the Pre-qualified list (use `lead.list_id` vs the intake list). For other lists, the generic Move-to-list selector (Phase 1) is enough.

### C. Clearer System Activity wording for list moves
Today a move renders as the generic `"lead.updated lead"` because the audit record only carries the `list_id` UUID and there's no render case. Mirror the existing **branch** pattern (which stores the branch *name* in `changes`):
- **Backend** (`PATCH /api/v1/leads/[id]`, the list-move path): write the audit log's `changes` with human-readable **list names** — `changes.list = { old: <old list name|null>, new: <new list name> }` (resolve both names; the handler already fetches the target list — also fetch the old list's name from `existingLead.list_id`). Include `archive_reason` when moving into an archive list. Keep emitting the existing `lead.list_changed` event too.
  - Ensure a list-only move produces **one** clear activity row, not a duplicate generic "lead.updated" — if the generic audit-log write would also fire for the same PATCH, make the list move its own descriptive entry and avoid the redundant generic one (or set its `changes` so the renderer shows the list line). Use your judgment; the goal is exactly one human-readable row per move.
- **Frontend** (`getSystemActivityDescription` in `src/components/dashboard/lead/activities/activities-panel.tsx`): add a case **above** the generic fallback:
  ```
  if (changes.list) {
    const from = changes.list.old as string | null;
    const to = changes.list.new as string | null;
    const reason = changes.archive_reason?.new as string | null;
    if (reason) return `Archived · ${reason}`;
    return from ? `Moved from "${from}" to "${to}"` : `Added to "${to}"`;
  }
  ```
- Result: the timeline reads "Moved from Pre-qualified to Qualified", "Moved from Qualified to Prospects", "Archived · Not reachable".

---

## PART 2b — Admin list-management UI

A **Settings ▸ Lead Lists** section (education + admin only). The Phase 1 API already backs all of this — **no new endpoints needed**:
- `GET /api/v1/lead-lists` (list + counts), `POST` (create), `PATCH /[id]`, `DELETE /[id]`.

Build a manager component (model it on the existing `src/components/dashboard/settings/positions-manager.tsx` shape) mounted in `src/app/(main)/(dashboard)/settings/page.tsx`, gated education + admin:
- **List rows** in `sort_order`, each showing name, lead count, system/custom badge, archive badge.
- **+ Add list** dialog: name, optional color, **is_archive** toggle, and **per-list position access** — "All positions" vs an allow-list of positions (fetch from `/api/v1/positions`, same as the positions manager does). Writes `access: {mode:"all"} | {mode:"allow", positionIds:[...]}`.
- **Edit** (name / color / access; system lists allow editing access + name but the API already blocks structural changes / slug / delete — surface those as disabled).
- **Reorder** — up/down buttons or @dnd-kit drag; persist `sort_order` via PATCH. (Up/down is acceptable and simpler.)
- **Delete** — custom + empty only; the API returns 409 if non-empty — surface that message cleanly. System lists: no delete.
- After mutations, the sidebar nav reflects changes on next navigation/refresh (the layout fetches lists server-side — no need for live nav sync in v2).

Also wire the **"+ add list"** entry in the sidebar group (Phase 1 left it as a stub/omitted) to deep-link to this Settings section, **admin only**.

---

## Reuse (don't reinvent)
- Move mechanics + access: `MoveToListSelector` (`src/components/dashboard/leads/move-to-list-selector.tsx`), `canAccessList` (`src/lib/api/permissions.ts`).
- Activity rendering pattern: the branch cases in `activities-panel.tsx` (`getSystemActivityDescription`).
- Settings manager shape + positions fetch: `positions-manager.tsx`.
- Notes creation: the existing `lead_notes` create path (grep how the detail rail adds a note).
- Create sheet: `add-lead-sheet.tsx` (industry-gated sections already exist there for it_agency fields — follow that gating style).

## Self-check before reporting (paste results)
- [ ] `npm run build` clean · `npx eslint --max-warnings 50` clean.
- [ ] No migration / no SQL / no DB writes. No push / PR / merge. Commits only on `feature/lead-lists-phase-2`, in 2a then 2b order.
- [ ] Education-gated: Create-sheet fields, Qualify action, list-mgmt all hidden/no-op for it_agency; non-education leads PATCH/POST unchanged.
- [ ] Activity timeline shows "Moved from X to Y" / "Archived · reason" — exactly one row per move, no leftover "lead.updated lead".
- [ ] Report: what you built, files touched, decisions made, the two gate outputs. Then STOP.

## Hand back to Opus
Commit (commit-msg hook rewrites co-author), stop. Opus re-runs both gates, reviews the diff, then pushes + PRs to stage and watches the dev deploy.
