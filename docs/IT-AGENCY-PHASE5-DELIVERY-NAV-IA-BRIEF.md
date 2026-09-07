# BRIEF — it_agency Phase 5: Delivery nav / IA pass

**Author:** Opus (planner) · **Executor:** Sonnet · **Date:** 2026-09-07
**Tenant/industry:** Zunkiree Labs, `it_agency` · **Base branch:** latest `origin/stage`
**Migrations:** **none.** No DB work of any kind in this round.

---

## Why

Phase 4 ("My Work" on Home) shipped to prod 2026-09-07 and **planted a rule without acting on it**:

> Home → Tasks is the canonical *"everything assigned to me, any context"* surface.
> `/tasks` is the canonical *"project work, any assignee"* surface.
> Every other task view is a **summary that links into one of those two** and must not grow
> into a third destination.

Phase 5 is the round that makes the nav and the surfaces obey it. This is the IA pass, not a
redesign — the cockpit redesign is Phase 6 and is explicitly out of scope.

### Verified findings

1. **The manifest does not drive it_agency's sidebar.** `shell.tsx:682-842` hand-assembles it with
   `itItem("/projects")`-style href lookups and literal `<NavSectionHeader label="Delivery">` JSX.
   The manifest's `sidebar[]` ordering is **ignored** for it_agency — it's a bag the shell picks
   from by string. ~160 lines of JSX for one industry.
2. **Resourcing and Utilization are filed under "Organization"** (`shell.tsx:838-839`), next to
   Leave and Attendance. They are delivery-capacity tools. This is a straight misfiling, not a
   matter of taste, and it contradicts the manifest, which registers both under `FEATURES.RESOURCING`
   alongside the delivery features.
3. **`SidebarGroup` exists but is the wrong tool here.** `_types.ts:77` defines `kind: "group"` and
   `_loader.ts:108` filters it — but `SidebarGroupRender` (`shell.tsx:490`) renders a **collapsible
   parent with indented children**, not a flat section header. it_agency's manifest declares zero
   groups. **The manifest has no concept of a flat section header at all** — that's the gap this
   round fills.
4. **Three hardcoded industry branches exist** — education (`:609`), it_agency (`:682`),
   real_estate (`:843`). This round converts **it_agency only**; the other two stay as they are.
5. **The sidebar interleaves manifest items with universal ones.** it_agency's Sales section alone
   mixes `LeadsOrganiseNavGroup`, three funnel nav-groups, `ArchiveNavLinks`, the industry Outreach
   item (with a badge), and the universal Pipeline item. Any declarative layout must handle
   **both kinds**, plus these bespoke Suspense-wrapped components. A naive "move it to the manifest"
   cannot work.

---

## Decisions already made by Sadin — do not relitigate

- **Delivery is flat, with Resourcing moved in.** Six items, one level, no collapsible parent —
  Projects and Tasks are daily-use pages and must not gain a click.
- **it_agency only.** Do not touch the education or real_estate branches.
- **Declarative, and done properly** — the it_agency sidebar becomes data, not JSX.
- **`/tasks` stays a top-level nav item.** It got its self-serve on-ramps in #500 barely a month
  ago; demoting it now would disorient the team that just started using it.
- **Phase 6 (cockpit redesign) is out of scope.**

---

## Phase 1 — A declarative nav layout for it_agency

### 1a. New: a flat section concept

The manifest can express items and collapsible groups, but not "a flat header followed by these
items". Add it. **Do not repurpose `SidebarGroup`** — it renders nested and collapsible, which is
the shape Sadin rejected.

New type in `src/industries/_types.ts`:

```ts
/**
 * One flat section of a sidebar: a non-collapsible header followed by its
 * entries at the same indent level. Distinct from SidebarGroup, which renders
 * a collapsible parent with indented children.
 */
export interface NavSection {
  /** Stable id — React key, and reserved for future collapse persistence. */
  id: string;
  /** Header text. Omit for a headerless section (e.g. the standalone Home row). */
  label?: string;
  /** Ordered entry keys — see NavEntryKey. */
  entries: readonly string[];
}
```

An **entry key** is one of:
- an industry item's `href` (`"/projects"`) — resolved from `industrySidebarItems`,
- a universal nav key (`"universal:/dashboard"`) — resolved to `renderNavItem`,
- a bespoke slot (`"slot:leads-funnels"`, `"slot:leads-organise"`, `"slot:archive-lists"`) — the
  Suspense-wrapped lead-list components that cannot be reduced to a plain item.

Keep the key vocabulary small and typed (a union of string literals, not `string`), so a typo is a
compile error rather than a silently missing nav item.

### 1b. Declare it_agency's layout

Put the layout in **`src/industries/it-agency/nav-layout.ts`** (not `manifest.ts` — the manifest
already crosses the Server→Client boundary and this keeps the diff readable). Export it from the
manifest so `getIndustrySidebarItems`'s existing permission filtering still applies to the industry
items.

The target layout — **this is the spec, match it exactly**:

| Section | Entries (in order) |
|---|---|
| *(headerless)* | Home |
| **Intelligence** | Dashboard · Company Knowledge |
| **Sales** | Leads Organise · Leads funnels · Outreach · Archive lists · Pipeline |
| **Revenue** | Proposals · Deals · Services |
| **Clients** | Accounts · Contacts |
| **Delivery** | Projects · Tasks · Time Tracking · Approvals · **Resourcing** · **Utilization** |
| **Communication** | Inbox |
| **Organization** | Org Structure · People · Leave · Attendance |

The only *content* changes vs. today: **Resourcing and Utilization move from Organization to
Delivery.** Everything else is the same items in the same order — this phase changes the
*mechanism* and fixes one misfiling. Resist the urge to re-sequence anything else while you're in
there; an IA pass that silently reshuffles eight sections is unreviewable.

### 1c. Render it from a loop

Replace the it_agency branch (`shell.tsx:682-842`) with a loop over `NAV_LAYOUT` and one
`renderEntryByKey(key)` resolver. The resolver keeps every existing behaviour — `navAllowed()`
gating, `renderIndustryEntry()`'s `hideForBroadScope` / `allowedPositions` checks, the Outreach
badge (`shell.tsx:511`), the `counts.unread_leads` badge on All Leads, `sidebarCollapsed`,
`onNavigate={() => setMobileOpen(false)}`, and every `Suspense` fallback exactly as written.

**A section whose entries all resolve to null must render no header.** Today an empty section is
impossible because the JSX is hand-tuned; under a loop it is very possible (a non-admin has no
Approvals; a tenant with no lead lists has no funnels), and a dangling "Delivery" header above
nothing is the obvious regression. Test it.

**This is a pure refactor plus one item move.** For an owner/admin on a fully-featured it_agency
tenant the rendered sidebar must be **identical** to today except Resourcing/Utilization's position.
Say so in the PR, and prove it with the tests below.

---

## Phase 2 — Make Home Overview's task card an honest summary

**Do not delete it.** Overview is the landing tab; removing tasks from it would undo what Phase 4
just shipped. The problem is that `TasksCard` is an *undifferentiated parallel list* to the Tasks
tab on the same page — two equal-looking surfaces, one click apart.

In `src/components/dashboard/home/tasks-card.tsx`:
- Show **at most 5** open tasks, ordered by due date (soonest first, `null` due dates last) — reuse
  `groupTasksByDue` from `@/lib/home/task-grouping` rather than re-sorting by hand.
- Footer link **"View all N tasks"** that switches Home to the Tasks tab. `home-content.tsx`
  already owns `activeTab` and passes `onNewTaskClick` down to the rail — thread an equivalent
  callback rather than inventing a second mechanism.
- Drop the "Show completed (N)" toggle. Completed work is not a summary concern; it lives on the
  Tasks tab, which already has a Completed filter.
- Keep the inline `NewTaskRow` — creating a task from the landing tab is the card's real job.

Net effect: the card becomes a glance that *points at* the canonical surface, which is exactly what
the Phase 4 rule says a summary should be.

---

## Phase 3 — Docs

Edit from a branch off the **latest `origin/stage`**, surgical `Edit`s not rewrites
(`feedback_edit_docs_from_stage_copy`).

- `docs/FEATURE-CATALOG.md` — `project-board` row: Delivery section now carries Resourcing +
  Utilization; note that it_agency's sidebar is declarative (`nav-layout.ts`) while education and
  real_estate remain hardcoded in `shell.tsx`. Update the task-surface rule row to record that
  Home Overview's card is now a capped summary.
- `docs/FEATURE-ROADMAP.md` — move Phase 5 to shipped; note Phase 6 (cockpit redesign) still open.
  While you are in the file, add a follow-up line: *"convert education + real_estate sidebars to
  `nav-layout.ts` — the machinery now exists; deleting the remaining two hardcoded branches in
  `shell.tsx` is a separate round."*
- `docs/SESSION-LOG.md` — dated ship entry.
- `git mv docs/IT-AGENCY-PHASE5-DELIVERY-NAV-IA-BRIEF.md docs/archive/features/` when it ships.

---

## Out of scope — log, don't build

Phase 6 cockpit redesign; converting education or real_estate sidebars; removing `/tasks`, the
cockpit Tasks section, or any other surface; collapse-state persistence for sections; changing what
any page queries; badge-count changes; any migration.

---

## Tests — `npm run test`

There is no React Testing Library in this stack; `shell.nav.test.ts` and `shell.timer-chip.test.ts`
are the precedent for how nav is tested here. Follow whichever convention fits, and **do not** claim
a render-level assertion you did not make.

- **Layout integrity** — every entry key in `NAV_LAYOUT` resolves (no key naming a href absent from
  the manifest, no universal key absent from the nav registry). This is the test that catches a
  typo'd href silently deleting a nav item.
- **Resourcing/Utilization are in Delivery, not Organization** — assert the section membership
  directly, so a future edit can't quietly move them back.
- **Parity** — for an owner on a fully-featured it_agency tenant, the ordered list of rendered
  entry keys equals the expected sequence (the table in 1b). This is the "pure refactor" proof.
- **Empty sections render no header** — with Approvals filtered out for a non-admin *and* every
  other Delivery entry removed, no "Delivery" header appears.
- **Permission filtering still applies** — a non-admin does not get Approvals (`minRoles`), and
  `canSeeNav`/`allowedNavKeys` still suppress items as they do today.
- **TasksCard** — caps at 5, orders by due date with nulls last, and reports the true total in
  "View all N".
- Keep `shell.nav.test.ts` green.

---

## Verification — required before you report done

**No DB access of any kind.** There is no migration in this round.

1. **Local dev, hands on** (`feedback_verify_local_dev_before_push`,
   `feedback_no_pr_without_local_verification`): `supabase start` → `./scripts/local-db-setup.sh`
   → `npm run dev`.
2. **Side-by-side sidebar comparison as an it_agency owner.** Screenshot the sidebar on `stage`
   and on your branch. Every section and every item must match except Resourcing/Utilization moving
   into Delivery. **Both screenshots, in the report** — this is the acceptance criterion for
   Phase 1.
3. **As a non-admin member**: sidebar renders, Approvals is absent, no empty section header
   anywhere, no console errors. **Screenshot.**
4. **Collapsed sidebar**: toggle it and confirm section headers, icons and the lead-list nav groups
   behave exactly as before. **Screenshot.**
5. **Mobile**: open the sheet, tap a Delivery item, confirm it navigates and the sheet closes
   (`onNavigate` still wired).
6. **As an education user** (local `admizz-local`) **and a real_estate user**: sidebars completely
   unchanged. This round must not touch them — if anything differs, stop and report it.
7. **Home Overview**: card shows at most 5, "View all N" carries the correct total and switches to
   the Tasks tab, inline new-task still works. **Screenshot.**
8. `npm run test` green, `npm run build` clean, **`npm run lint`** clean (`npm run lint`, not
   `npx eslint` — `feedback_run_ci_lint_before_merge`).

---

## Process non-negotiables

- Branch from the **latest `origin/stage`**; rebase onto it again right before merge.
- **`shell.tsx` is this repo's #1 merge-conflict file and this round rewrites 160 lines of it.**
  Rebase immediately before merge and resolve **hunk-by-hunk** — never "keep my whole file". If a
  conflict looks non-trivial, stop and report rather than guessing.
- **Batch all three phases on one branch, one PR to `stage`**
  (`feedback_finish_features_end_to_end`). Keep the Phase 2 TasksCard change as its own commit —
  it is unrelated to the nav refactor and should be revertable alone.
- **Stop at review.** Open the PR, report back, and wait. Do not self-merge (stage requires
  ani-shh's approval), do not promote to `main` (`feedback_sonnet_oversteps_review_gate`).
- Report honestly: if a step was skipped or a check is red, say so with the output. Screenshots are
  the deliverable for steps 2, 3, 4 and 7 — not a description of what you saw.

## Note for the reviewer

Phase 4 is live on prod as of 2026-09-07 (promotion #517, deploy 34110946451, `0 pending — nothing
to apply`). This round carries no migration, so its promotion will be a plain code deploy —
**unless** another migration-bearing PR lands on stage first, in which case the `production-db`
gate pauses as usual. PR #514 (blast F3/F4/F5) is still open, `REVIEW_REQUIRED` and `BEHIND`; it is
independent of this work.
