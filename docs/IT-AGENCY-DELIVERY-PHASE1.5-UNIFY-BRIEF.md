# it_agency Delivery — PHASE 1.5: Unify Project Home + IA fix (for Sonnet)

**Planner:** Opus. **Executor:** you (Sonnet). **Reviewer:** Opus (re-runs gates independently; do not merge/push/PR — stop at "ready for review" on the branch).

**Why this exists:** Phase 1 built a great project **cockpit** at `/projects/[id]` — but it's **orphaned**. Every project link in the app still points to the *old* `/time-tracking/projects/[id]` page, so no one can reach the cockpit by clicking, and the two pages split a project's information in half. This slice makes `/projects/[id]` the **single canonical project home** and retires the duplicate. Almost entirely frontend — **no schema, no migration.**

**Branch:** CONTINUE on the existing **`feature/it-agency-delivery-and-ui`** (do not create a new branch — this hardens Phase 1 before we move on). Commit on top.

---

## 0. Guardrails
- No DB changes. No migration. `scopedClient` unchanged; you're mostly moving UI + repointing links.
- Respect industry-module pattern: cockpit UI stays under `src/industries/it-agency/features/project-board/`.
- Per slice: `npm run build` clean · `npx tsc --noEmit` clean · `npm run lint` (0 errors) · **hands-on** local (`npm run dev`, login `admin@zunkireelabs.com / edgexdev123` on Zunkiree Labs; also test a **non-admin** user to confirm view-not-mutate).
- Do not merge/push. Report with pasted gate output.

---

## 1. The problem (mapped)

Two project detail pages exist:
- **OLD** `/time-tracking/projects/[id]` → `src/app/(main)/(dashboard)/time-tracking/projects/[id]/page.tsx` → `ProjectDetailPage` (`src/industries/it-agency/features/time-tracking/pages/project-detail.tsx`). Shows **Billable summary · Contacts · Tasks**. Back button hardcoded **"← Accounts"** (wrong). Gated only on `getFeatureAccess(TIME_TRACKING)` — **non-admins can view**.
- **NEW** `/projects/[id]` → `project-board/pages/project-cockpit.tsx`. Shows **Health · Overview(Brief+Qualify) · Delivery · Reconciliation & Reports · Timeline**. Back → "Projects" (correct). Shell **404s non-admins** (`if (!isAdmin) notFound()`).

**12 links point to the OLD page; 0 point to the cockpit.** Full list to repoint (all `/time-tracking/projects/${…}` → `/projects/${…}`):
1. `src/industries/it-agency/features/project-board/components/project-card.tsx` — **lines 77, 99, 121**
2. `src/industries/it-agency/features/project-board/components/project-row.tsx` — **line 74**
3. `src/industries/it-agency/features/project-board/components/views/members-view.tsx` — **lines 234, 271**
4. `src/industries/it-agency/features/project-board/components/views/tasks-view.tsx` — **line 387**
5. `src/components/dashboard/tasks/task-row.tsx` — **line 105**
6. `src/industries/it-agency/features/accounts/components/account-detail/projects-tab.tsx` — **line 75**
7. `src/industries/it-agency/features/crm-contacts/components/contact-detail/linked-projects-card.tsx` — **line 99**
8. `src/industries/it-agency/features/deals/pages/deal-detail.tsx` — **lines 378, 453**
9. `src/app/(main)/api/v1/tasks/[id]/route.ts` — **line 169** (notification `link`)
10. `src/app/(main)/api/v1/projects/[id]/tasks/route.ts` — **line 166** (notification `link`)

---

## 2. The fix — three slices

### Slice A — Unify the project page (Overview = scrolling, per Sadin)
Fold the old page's content into the cockpit's **Overview** tab as stacked sections (NOT new tabs). Keep the tab bar as **Overview · Delivery · Reconciliation & Reports · Timeline**.

**Overview scroll order (answer-first, then operational):**
1. Health banner (exists)
2. Brief (exists)
3. Qualify gate — only when unqualified (exists)
4. **Billable summary** — the "Billable hours / Billable amount · Approved entries only" card (port from `project-detail.tsx`)
5. **Contacts** — linked project contacts + "Add contact" (port)
6. **Tasks** — project task list + "Add task" (port)

**How:** reuse the existing section components/data hooks that `time-tracking/pages/project-detail.tsx` already uses for Billable/Contacts/Tasks — import them into the cockpit's Overview rather than rewriting. They fetch from existing endpoints (`/api/v1/projects/[id]/tasks`, `/contacts`, `/time-entries/summary`). Once these sections live in the cockpit, `ProjectDetailPage` becomes unused (Slice C retires it).

**Role model (fixes the non-admin regression):**
- In `src/app/(main)/(dashboard)/projects/[id]/page.tsx`: **remove** `if (!isAdmin) notFound();`. Allow any authenticated tenant member (keep the `getFeatureAccess(PROJECT_BOARD)` gate). Pass `role` into `ProjectCockpitPage` (mirror how the old shell passed `role`).
- In the cockpit UI: **gate mutation controls by role** — hide/disable qualify, commit-plan, add/accept/approve/publish/reconcile actions for non-admins (owner/admin only). Reads render for everyone.
- Server already enforces this (mutations `requireAdmin`, GETs feature-gated only) — but gate the buttons so non-admins don't see dead actions.

### Slice B — Repoint all 12 links
Change every site in §1 from `/time-tracking/projects/${id}` → `/projects/${id}`. Straight string swaps; keep surrounding `Link`/`router.push`/notification-object shape intact.

### Slice C — Redirect the old route + retire the component
- Replace the body of `src/app/(main)/(dashboard)/time-tracking/projects/[id]/page.tsx` with a redirect:
  ```ts
  import { redirect } from "next/navigation";
  export default async function ProjectDetailRoute({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    redirect(`/projects/${id}`);
  }
  ```
  (Keeps bookmarks / old notification links working.)
- Delete `src/industries/it-agency/features/time-tracking/pages/project-detail.tsx` **only if** its sections were reused in Slice A and it's now unimported (grep to confirm no other importer). If anything still imports it, leave it and flag — don't break the build.

---

## 3. Robustness pass (fold in — from the Phase 1 review; small)
While here, close these so Phase 1 is solid before we move on:
1. **`milestone_rejected` event** — the reject route emits nothing; add a `milestone_rejected` event symmetric with change-requests (`recordProjectEvent`), so the ledger captures denials.
2. **Status-report hour snapshots** — confirm `hours_actual_snapshot` / `hours_estimate_snapshot` store a consistent unit. The schema uses **minutes** everywhere; either store minutes (preferred, rename intent in code comments) or clearly document they're rounded hours. Pick minutes for consistency and format at display.
3. **CR-approve race** — the approve path reads CR status then updates project estimate in two calls. Add a guarded update (`.eq("status","proposed")` on the CR update, and only apply the estimate delta if that update affected a row) so a double-approve can't double-count the delta.
4. **Board health dot** — leave the simplified proxy, but add a one-line code comment stating it's an approximation and the cockpit's `GET /api/v1/projects/[id]` is the authoritative health (already noted by prior author — just ensure the comment is there).
5. **Verify no orphaned actions** — confirm the **Commit-plan** button, **retro-lesson** form, and per-task **Reconcile** action are actually reachable/wired in the cockpit tabs; if any is missing a trigger, add it.

---

## 4. Verify (hands-on, paste output)
- **Click-through every entry point** → all land on `/projects/[id]` (cockpit), never `/time-tracking/projects/...`: board card (body + icons), table row, members view, tasks view, universal task row (Home/attention), account → Projects tab, contact → linked projects, deal detail (linked project + after convert-to-project).
- Old URL `/time-tracking/projects/<id>` **redirects** to `/projects/<id>`.
- Cockpit **Overview** now shows Billable summary + Contacts + Tasks below Brief/Qualify; Delivery/Reports/Timeline tabs unchanged.
- **Non-admin** login: can open a project and view it (no 404); mutation buttons hidden/disabled; a direct mutation still 403s server-side.
- Gates: build / tsc / lint clean.

## 5. Report back (do not merge)
Per slice: diff summary, the four gate outputs (pasted), and a click-through note (which entry points you verified land on the cockpit, admin vs non-admin behavior). Flag any link you couldn't repoint or component you couldn't cleanly retire. Leave the branch local.

## 6. Out of scope
No schema/migration. No client-portal/role-scoping build (non-admin = view-only is the Phase-1 stance). No new delivery features — this is purely making Phase 1 reachable, unified, and robust.
