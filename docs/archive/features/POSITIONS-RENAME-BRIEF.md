# Rename "Positions" → "Roles & Permissions" (access-control surfaces) — BUILD BRIEF (for Sonnet)

**Type:** UI copy only. **No DB, no migration, no API, no schema, no type changes.** Global feature (all tenants/industries).
**Branch:** `git fetch origin && git switch -c feature/positions-rename-roles origin/stage`
**Guardrails:** branch only — **do NOT merge, do NOT push to stage/main, do NOT touch prod.** Build + lint, then **STOP for Opus review.**

---

## Why (context)

The `positions` feature is a **permission/RBAC profile** ("what can this person DO in the app"). But the surface is labelled **"Positions"** and invites job-title-style names ("Developer", "CEO"), so it collides with the **Job title** field on the People page (`employee_profiles.job_title`, "what this person IS"). Users read the permission profile as if it were the job title. Fix = **relabel the access-control surfaces to "Roles & Permissions"** and steer naming toward access levels. This is purely cosmetic — the entity, columns, API, and slugs are correct and stay untouched.

Two design facts that bound the scope:
- The **seeded** education roles are already coarse and correct (`Owner / Admin / Counselor / Viewer` — see `030_positions.sql`). **Nothing to rename in seed data.**
- The job-titley names on Zunkiree (`Developer / CEO / Business Development Executive`) are **tenant-created data — DO NOT alter any tenant data.** The naming guidance change (below) is what steers future entries.

---

## Scope — RENAME on these surfaces only (visible strings → "Role")

Change only **user-visible text**. Do **not** rename any identifier (see the DO-NOT list). Re-grep for current line numbers before editing (they drift).

### 1. `src/components/dashboard/settings/positions-manager.tsx` (primary — Screenshot 2)
- Card title **"Positions"** (appears twice: loading state ~L306 and main ~L323) → **"Roles & Permissions"**
- `CardDescription` ~L326: `Define permission profiles and assign them to team members` → **`Roles control what a person can do in the app — not their job title. Set job titles in People.`**
- Button **"New Position"** ~L331 → **"New Role"**
- Dialog title ~L393: `{editingPosition ? \`Edit "${editingPosition.name}"\` : "New Position"}` → replace the literal `"New Position"` with **`"New Role"`** (keep the `Edit "name"` branch as-is)
- Name-field placeholder ~L405: `"e.g. Branch Manager"` → **`"e.g. Manager, Member, Read-only"`** (steers access-level naming, not job titles — this is change #2)
- Toasts: `"Position updated"` / `"Position created"` ~L239 → **"Role updated" / "Role created"**; `"Position deleted"` ~L257 → **"Role deleted"**
- Submit button ~L666: `"Create position"` → **"Create role"**
- **Optional (nice):** add one line of helper text under the Name field in the dialog: *"This controls access, not the person's title."* Only if trivial; skip if it complicates layout.
- Keep the **"Access tier"** field label exactly as-is (already correct).

### 2. `src/components/dashboard/team-management.tsx` (assigning a profile to a member)
- `placeholder="Pick position"` ~L397 → **`"Pick role"`**
- `title="Change position"` ~L429 → **`"Change role"`**
- `placeholder="Position"` ~L525 → **`"Role"`**
- Any other **visible** "position" word in this file (e.g. a column header / empty-state) → "role". Re-grep the file for visible strings; leave state vars like `editingPositionFor` **unchanged** (identifier).

### 3. `src/components/dashboard/settings/lead-lists-manager.tsx` (per-role list access)
- `<Label>Position access</Label>` ~L397 → **`Role access`**
- `"No positions defined yet"` ~L413 → **`"No roles defined yet"`**

That is the complete rename set. Nothing else.

---

## DO NOT rename (leave exactly as-is)

- **Org Structure** (`src/components/dashboard/org-structure/**` — `position-card.tsx`, `org-structure-hierarchy.tsx` "No positions", `org-structure-editor.tsx` "N positions → Unassigned", etc.). That surface uses positions as **org-chart nodes ("where you sit")**, a distinct frame; renaming it to "roles" would read oddly. Unifying it is a **separate, deferred** follow-up — out of scope here. Do not touch these files.
- **Any code identifier**, on any surface: the `positions` table, `position_id`/`layer_id` columns, `/api/v1/positions*` routes, TS types (`Position`, `PositionPermissions`), props/vars (`editingPosition`, `assignablePositions`, `positionSlugMap`, `position_name`), slugs (`owner`/`admin`/`counselor`/…). URLs, request bodies, and DB stay identical.
- **Unrelated `.position` fields** that mean *ordering*, not RBAC — do not touch: `shell.tsx` nav `e.position` (`"after-home"` etc.), `leads-table.tsx`/`stats-cards.tsx` stage `.position` sorts, `application_stages.position`. These are sort indices, a different concept that happens to share the word.
- **Seed data / tenant data** — no SQL, no migration, no data edits.
- The settings section nav label **"Team & Roles"** — already correct, keep it. ("Roles & Permissions" nests cleanly under it.)

---

## Verify + report (then STOP)

1. `npm run build` — clean.
2. `npx eslint --max-warnings 50` — 0 errors, 0 new warnings in touched files.
3. Manual (local `npm run dev`, log in as `admin@zunkireelabs.com` / `edgexdev123`):
   - Settings → **Team & Roles** now shows card **"Roles & Permissions"**, button **"New Role"**, dialog **"New Role"**, new placeholder + description. Create/edit/delete a role → toasts say "Role …". Existing roles (Developer/CEO/BDE) still render, still editable, permissions unchanged.
   - **Team** page: the profile picker reads "Pick role" / "Role"; assigning a member still works (no behavior change).
   - **Org Structure** page unchanged (still says "position" there — expected, deferred).
   - Settings → Lead lists: "Role access" label; access toggles still work.
4. Report the diff (file + before→after string list) and confirm **zero** identifier/API/DB changes. **STOP — Opus reviews, re-runs gates, and drives the branch to stage.** Do not merge or push.

---

## Notes for the reviewer (Opus)
- Post-review, this is a normal small squash-merge to `stage` (0 approvals). No prod DB step (code-only). It can ride the next `stage→main` promotion.
- Deferred follow-ups intentionally not in this brief: (a) job-title free-text **autocomplete** on the People form (change #3 from the discussion); (b) unifying Org Structure's "position" wording; (c) the deeper decoupling of org-chart placement from permission roles.
