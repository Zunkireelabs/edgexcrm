# Orca UI Port — Implementation Brief

> **Owner:** Opus (plan) → Sonnet (execute) → Opus (review + CI + merge)
> **Branch:** `feat/orca-ui-shell` off `stage`
> **Scope:** UI ONLY. No DB, no API, no agent logic. Static/mock data preserved as-is.
> **Approved plan:** `~/.claude/plans/lets-still-work-on-playful-noodle.md`

---

## Context

The dashboard sidebar has an `Ops | Orca` tab switcher (`src/components/dashboard/shell.tsx`). The **Orca**
tab currently renders a placeholder ("Orca coming soon"). A complete Orca UI shell (6 screens, 12
components) was built on the never-merged branch `feature/ai-orchestrate-orca` (2026-04-10). That branch is
197 commits stale and predates the current architecture, so we **do not rebase it** — we **harvest** its
self-contained UI files (verbatim) onto a fresh branch and wire the sidebar.

Orca will be powered externally by the real Orca product later. This pass is purely to get the surface
rendering. The old branch's later phases (DB migration `009`, `/api/v1/orca/*` CRUD, agent wiring,
`cta-shimmer` globals.css animation) are **explicitly out of scope** — do not port any of them.

**Why it's safe:** the harvested components import only `cn` from `@/lib/utils`, `lucide-react`,
`next/link`, `react`, and their own local `./types` + sibling components. Zero `@/components/ui/*` (shadcn)
dependency. Destination directories do not exist on `stage` (no collisions).

**Locked decisions:**
1. Clicking the **Orca** tab navigates to `/orca` (Overview); visiting any Ops route flips back to Ops mode.
2. **No gate** — every role, every tenant/industry sees the Orca tab + all 6 pages.
3. All 6 screens ported **as-is** (static data, no redesign).

---

## Step 0 — Branch

```bash
git checkout stage && git pull --rebase origin stage && git checkout -b feat/orca-ui-shell
```

## Step 1 — Harvest the 12 components (verbatim, no edits)

Create `src/components/dashboard/orca/` and extract each file from the old branch unchanged:

```bash
mkdir -p src/components/dashboard/orca
for f in types mode-toggle tasks-matrix stats-cards handoffs-flow org-hierarchy \
         overview-content structure-content roles-content tasks-content \
         agents-content compare-content; do
  git show "feature/ai-orchestrate-orca:src/components/dashboard/orca/$f.tsx" \
    > "src/components/dashboard/orca/$f.tsx"
done
```

Do **not** modify the contents of these files. (`types.ts` exports `AutomationLevel`, `RoleType`,
`ViewMode`, `RoleTask`, `TaskRole`, `OrgRole`, `OrgLayer`, `Handoff`, `OrcaStats`, `AUTOMATION_COLORS`,
`AUTOMATION_LABELS` — all consumed by siblings.)

## Step 2 — Harvest the 6 page shells (verbatim, no edits)

Create the route tree and extract each page unchanged:

```bash
mkdir -p "src/app/(main)/(dashboard)/orca/structure" \
         "src/app/(main)/(dashboard)/orca/roles" \
         "src/app/(main)/(dashboard)/orca/tasks" \
         "src/app/(main)/(dashboard)/orca/agents" \
         "src/app/(main)/(dashboard)/orca/compare"
for p in page structure/page roles/page tasks/page agents/page compare/page; do
  git show "feature/ai-orchestrate-orca:src/app/(main)/(dashboard)/orca/$p.tsx" \
    > "src/app/(main)/(dashboard)/orca/$p.tsx"
done
```

Each shell is an `async` server component that calls `getCurrentUserTenant()` → `redirect("/login")` if
absent → renders its `*Content` component. They sit under the `(dashboard)` route group, so they inherit
the layout + `DashboardShell` automatically. **No `getFeatureAccess`/gate** (decision #2).

## Step 3 — Wire the Orca-mode sidebar nav (the only hand-edited file)

All edits are in `src/components/dashboard/shell.tsx`. Match the existing code style exactly.

**3a. Add lucide icon imports.** In the `lucide-react` import block (lines 14–38), add `Network`,
`ListChecks`, `GitCompare` (others needed — `LayoutDashboard`, `Bot`, `Contact` — are already imported).

**3b. Add the Orca nav list** next to the `UNIVERSAL_NAV_*` consts (after line 65). It uses `LucideIcon`
component references directly (these consts live inside the client component, so no serialization concern —
the `INDUSTRY_ICONS` string registry is only for manifest items crossing the Server→Client boundary):

```ts
const ORCA_NAV = [
  { href: "/orca", label: "Overview", icon: LayoutDashboard },
  { href: "/orca/structure", label: "Org Structure", icon: Network },
  { href: "/orca/roles", label: "Roles", icon: Contact },
  { href: "/orca/tasks", label: "Tasks", icon: ListChecks },
  { href: "/orca/agents", label: "Agents", icon: Bot },
  { href: "/orca/compare", label: "Compare", icon: GitCompare },
];
```

**3c. Derive mode from the route; drop localStorage.**
- Delete the `navMode` state seed at line 185 (`const [navMode, setNavMode] = useState<"ops" | "orca">("ops");`).
- Delete the entire localStorage hydration effect at lines 199–207.
- After `const router = useRouter();` (line 182), add:
  ```ts
  const isOrcaRoute = pathname === "/orca" || pathname.startsWith("/orca/");
  const navMode = isOrcaRoute ? "orca" : "ops";
  ```
  (Keep the name `navMode` so the existing `<Tabs value={navMode}>` at line 287 and the
  `navMode === "ops" ? ... : ...` conditional at line 303 continue to work unchanged.)

**3d. Make the tab navigate** instead of just setting state. Replace `handleNavModeChange` (lines 216–223):
```ts
function handleNavModeChange(value: string) {
  setMobileOpen(false);
  if (value === "orca") router.push("/orca");
  else if (value === "ops") router.push("/dashboard");
}
```

**3e. Fix Overview active-highlight.** In `renderNavItem` (lines 232–256), `/orca` would otherwise be
flagged active on every `/orca/*` subroute (prefix match). Extend the existing `/dashboard` exact-match
guard at lines 233–235 to also exclude `/orca`:
```ts
const isActive =
  pathname === item.href ||
  (item.href !== "/dashboard" && item.href !== "/orca" && pathname.startsWith(item.href));
```

**3f. Replace the placeholder.** Swap the `navMode === "orca"` else-branch (lines 367–375, the "Orca coming
soon" block) for the nav list:
```tsx
) : (
  <>
    {ORCA_NAV.map(renderNavItem)}
  </>
)}
```

---

## Hard rules

- Do **not** edit the contents of any harvested component or page (Steps 1–2 are verbatim copies).
- Do **not** port `globals.css` changes (`cta-shimmer`) — unused by the tab approach.
- Do **not** add any DB migration, `/api/v1/orca/*` route, manifest/registry entry, or `getFeatureAccess`
  gate. Orca is universal + ungated for this pass.
- `shell.tsx` is the **only** file changed by hand. `router` is already imported (used by logout).
- Keep `Bot` imported — it's still used by the Orca `TabsTrigger` icon (line 294).

---

## Verification (run before handing back for review)

1. **CI gates — both required:**
   - `npm run build` → clean.
   - `npx eslint --max-warnings 50` → 0 errors (~17 baseline warnings OK).
2. **Click-through** (`npm run dev`, login as Admizz admin):
   - Click **Orca** → URL = `/orca`, sidebar shows the 6 Orca items, main pane shows Overview.
   - Click each item → right page renders; active highlight follows; `/orca` Overview is highlighted only
     on `/orca` exactly (not on `/orca/structure` etc.).
   - On `/orca/compare` the People/Agents toggle works; on `/orca/structure` the Editor/Hierarchy toggle
     works (static data, but interactive).
   - Click **Ops** (or go to `/leads`) → flips back to Ops mode, full Ops nav returns.
   - Hard-reload on an `/orca/*` URL → still Orca mode (route-derived, no localStorage).
3. **No-gate check:** log in as a non-education tenant (Zunkiree Labs) and as a counselor → Orca tab + all
   6 pages visible and open.
4. **Mobile:** narrow viewport → open the Sheet sidebar → Orca tab + nav render there too.

---

## Sonnet handoff prompt

```
Implement the Orca UI port exactly per docs/ORCA-UI-BRIEF.md. Read that brief in full first — it is
self-contained with exact shell commands and exact shell.tsx edits.

This is a UI-ONLY port: harvest a shelved UI shell verbatim and wire one sidebar file. No DB, no API
routes, no manifest changes, no feature gate. Orca is powered externally later; all data here stays
static/mock.

Branch: git checkout stage && git pull --rebase origin stage && git checkout -b feat/orca-ui-shell

Then, committing logically:
1. Step 1 — harvest the 12 components into src/components/dashboard/orca/ via the `git show ... > file`
   loop in the brief. Verbatim — do not edit their contents.
2. Step 2 — harvest the 6 page shells into src/app/(main)/(dashboard)/orca/ the same way. Verbatim.
3. Step 3 — edit ONLY src/components/dashboard/shell.tsx per sub-steps 3a–3f: add lucide imports
   (Network, ListChecks, GitCompare); add the ORCA_NAV const; derive navMode from the pathname and
   delete the localStorage useState seed + hydration effect; make handleNavModeChange navigate
   (orca→/orca, ops→/dashboard, close mobile); add the `&& item.href !== "/orca"` guard to renderNavItem's
   isActive; replace the "Orca coming soon" placeholder with {ORCA_NAV.map(renderNavItem)}.

Hard rules (brief § Hard rules): no content edits to harvested files; do NOT port globals.css cta-shimmer;
no migration/API/manifest/gate; shell.tsx is the only hand-edited file; keep Bot imported.

Verify before reporting back: `npm run build` clean AND `npx eslint --max-warnings 50` 0 errors, then the
click-through in the brief's Verification section (Orca tab → /orca Overview, 6 nav items render + active
state correct, Ops tab flips back, reload stays in Orca mode, visible to counselor + non-education tenant).

Commit trailer on every commit:
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```
