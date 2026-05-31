# Sidebar nav grouping — Project Management group for IT agency

> Introduce a 1-level-deep nested sidebar group pattern, then use it to consolidate IT-agency's Projects / Time Tracking / Approvals entries under a single "Project Management" parent. Also reposition Pipeline above the new group (it currently renders after all industry items because it lives in UNIVERSAL_NAV_MIDDLE). Discriminated-union schema change + a new `position` field; minimal renderer rework; one existing UX precedent (Public Forms) to mirror.

---

## Goal

The IT-agency sidebar currently has 5 industry-contributed entries listed flat (Contacts, Accounts, Projects, Time Tracking, Approvals). As more industry features land, the flat list grows unwieldy.

Sadin wants the 3 *delivery-side* surfaces (Projects, Time Tracking, Approvals) grouped under a collapsible **"Project Management"** parent. Contacts and Accounts stay top-level (they're CRM-side, distinct from delivery). Pipeline stays top-level (it's lead-side / sales).

This brief introduces a generic group pattern (so any industry manifest can use it later) and applies it to IT-agency's manifest.

---

## Scope

### In scope

1. Extend `src/industries/_types.ts` with a `SidebarGroup` type and a `SidebarEntry = SidebarItem | SidebarGroup` discriminated union. Update `IndustryManifest.sidebar` to use `readonly SidebarEntry[]`.
2. **Also add an optional `position?: "before-pipeline" | "after-pipeline"` field on both `SidebarItem` and `SidebarGroup`** (or on the shared `SidebarEntry`). Default is `"before-pipeline"` — matches current behavior for all 6 existing manifests. New for IT-agency's Project Management group: `position: "after-pipeline"`.
3. Update `getIndustrySidebarItems` in `src/industries/_loader.ts` to filter recursively — filter children by `minRoles` + `featureId`-registration, and **omit empty groups** when all children get filtered out. `position` is passed through unchanged (it's consumed by the shell renderer).
4. In `src/industries/it-agency/manifest.ts`, wrap the 3 entries (Projects / Time Tracking / Approvals) in a single `SidebarGroup` named "Project Management" with icon `FolderKanban` AND `position: "after-pipeline"`. Contacts and Accounts stay flat top-level items with default position (before-pipeline).
5. In `src/components/dashboard/shell.tsx`, **restructure the render order to 5 regions** (was 4):
   - UNIVERSAL_NAV_TOP
   - industry entries with `position === "before-pipeline"` (or undefined)
   - UNIVERSAL_NAV_MIDDLE (Pipeline)
   - industry entries with `position === "after-pipeline"` (Project Management group)
   - UNIVERSAL_NAV_BOTTOM (Team, Settings)
   Branch on `kind`:
   - `kind === "item"` → existing Link behavior (unchanged).
   - `kind === "group"` → collapsible button + indented children panel, mirroring the existing "Public Forms" pattern (`shell.tsx:204-235`).
6. Active-state logic: a child Link is active using the existing rule; a **group is active** (highlighted) when any child is active.
7. **Default expansion: groups render expanded by default.** No localStorage persistence in v1 — user-toggled collapse state resets on page reload. Acceptable for v1; persistence is a v2 polish.
8. Add `FolderKanban` to the `INDUSTRY_ICONS` registry in `shell.tsx`.

### Out of scope (explicit)

- **Pipeline grouping**: Pipeline is universal-middle nav (`UNIVERSAL_NAV_MIDDLE` in `shell.tsx`), sales/lead-side. Doesn't belong under Project Management; keep as a sibling top-level item.
- **CRM grouping**: Contacts and Accounts could conceivably be grouped under a "CRM" parent in a future pass. Don't do it now — Sadin only asked about the 3 delivery items.
- **Nested groups > 1 level deep**: the discriminated union allows it shape-wise, but the renderer assumes 1 level only. If we ever need 3 levels, that's a separate brief. Don't pre-build it.
- **localStorage persistence of collapse state**: re-expands on reload. Add in v2 if user-toggled collapse becomes annoying in practice.
- **Mobile / Sheet sidebar treatment**: the `sidebarContent` block is shared between desktop and mobile, so the group rendering will work in both automatically. No additional work needed.
- **Other industry manifests**: education_consultancy, healthcare, etc. stay as flat `SidebarItem[]` — the discriminated union doesn't require them to change. Their existing entries default to `kind: "item"` (or no `kind`, which the renderer treats as item).
- **aria-expanded / a11y polish on the existing Public Forms toggle**: the Public Forms pattern doesn't have aria-expanded today. The new group toggle should add it (small drive-by improvement); leave Public Forms unchanged.

---

## The changes

### Change 1 — `src/industries/_types.ts`

Add the new types as a discriminated union plus the `position` field:

```ts
type SidebarPosition = "before-pipeline" | "after-pipeline";

export interface SidebarItem {
  kind?: "item";              // NEW: optional discriminator. Existing manifests without `kind` work as items.
  position?: SidebarPosition; // NEW: defaults to "before-pipeline". Existing manifests work unchanged.
  featureId: string;
  href: string;
  label: string;
  icon: string;
  minRoles?: readonly ("owner" | "admin" | "viewer" | "counselor")[];
}

export interface SidebarGroup {
  kind: "group";
  position?: SidebarPosition; // NEW: defaults to "before-pipeline".
  id: string;                 // stable identifier, e.g. "project-management". Used for keys + (future) localStorage state.
  label: string;
  icon: string;
  children: readonly SidebarItem[];
}

export type SidebarEntry = SidebarItem | SidebarGroup;
```

Update `IndustryManifest.sidebar`:

```ts
export interface IndustryManifest {
  id: IndustryId;
  features: readonly FeatureRegistration[];
  sidebar: readonly SidebarEntry[];   // was: readonly SidebarItem[]
  ai?: AiConfig;
}
```

**Note on discriminator**: the `kind?: "item"` on SidebarItem is optional so all 6 existing industry manifests with flat sidebars compile unchanged. The renderer treats missing `kind` as `"item"`.

### Change 2 — `src/industries/_loader.ts`

`getIndustrySidebarItems` becomes group-aware. The function now returns `readonly SidebarEntry[]`:

```ts
export function getIndustrySidebarItems(
  industryId: string | null | undefined,
  role?: string,
): readonly SidebarEntry[] {
  const m = getManifest(industryId);
  const registeredFeatureIds = new Set(m.features.map((f) => f.meta.id));

  function isItemAllowed(item: SidebarItem): boolean {
    if (!registeredFeatureIds.has(item.featureId)) return false;
    if (item.minRoles && (!role || !item.minRoles.includes(role as never))) return false;
    return true;
  }

  return m.sidebar.flatMap((entry): SidebarEntry[] => {
    if (entry.kind === "group") {
      const allowedChildren = entry.children.filter(isItemAllowed);
      if (allowedChildren.length === 0) return [];   // drop empty groups
      return [{ ...entry, children: allowedChildren }];
    }
    // item or no kind = item
    return isItemAllowed(entry) ? [entry] : [];
  });
}
```

**Why `flatMap`**: cleanly handles "drop this entry" (empty array) and "keep this entry" (single-element array) in one pass. Same downstream consumers (`shell.tsx` reads the returned array) — no API churn.

### Change 3 — `src/industries/it-agency/manifest.ts`

Replace the 3 entries with the group. Final shape:

```ts
sidebar: [
  { featureId: FEATURES.CRM_CONTACTS, href: "/contacts", label: "Contacts", icon: "Contact" },
  { featureId: FEATURES.ACCOUNTS, href: "/accounts", label: "Accounts", icon: "Building2" },
  {
    kind: "group",
    position: "after-pipeline",   // sits below the universal Pipeline item
    id: "project-management",
    label: "Project Management",
    icon: "FolderKanban",
    children: [
      { featureId: FEATURES.PROJECT_BOARD, href: "/projects", label: "Projects", icon: "LayoutGrid" },
      { featureId: FEATURES.TIME_TRACKING, href: "/time-tracking", label: "Time Tracking", icon: "Clock" },
      {
        featureId: FEATURES.TIME_TRACKING,
        href: "/time-tracking/approvals",
        label: "Approvals",
        icon: "Stamp",
        minRoles: ["owner", "admin"],
      },
    ],
  },
],
```

Final rendered order for IT-agency: Dashboard → All Leads → Contacts → Accounts → **Pipeline** → **Project Management group (Projects / Time Tracking / Approvals)** → Team → Settings → View Public Form.

Contacts and Accounts have no explicit `position`, so they default to `"before-pipeline"` and render in their current slot. Project Management's `position: "after-pipeline"` is what shifts the group to below the universal Pipeline item.

### Change 4 — `src/components/dashboard/shell.tsx`

This is the bulk of the work. Three sub-changes:

**4a. Add `FolderKanban` to `INDUSTRY_ICONS`** (`shell.tsx:65-78`):

```ts
import { /* existing */, FolderKanban } from "lucide-react";

const INDUSTRY_ICONS: Record<string, LucideIcon> = {
  /* existing entries */,
  FolderKanban,
};
```

**4b. Update the type & data flow for `industrySidebarItems` prop**:

```ts
import type { SidebarEntry } from "@/industries/_types";

interface DashboardShellProps {
  // ...
  industrySidebarItems?: readonly SidebarEntry[];   // was: readonly SidebarItem[]
}
```

The current `navItems` array (`shell.tsx:143-152`) flattens universal-top + industry items + universal-middle + universal-bottom into one flat list, then maps each to a `{ href, label, icon }` shape. This flattening can't handle groups, and it can't honor `position` (industry items always come before universal-middle today).

**Restructure into 5 regions**: universal-top → industry "before-pipeline" → universal-middle (Pipeline) → industry "after-pipeline" → universal-bottom. The universal regions still flat-map; the two industry regions partition `industrySidebarItems` by `position` and branch on `kind`:

```tsx
// Partition industry entries by position (default "before-pipeline" when not set).
const industryBefore = industrySidebarItems.filter(
  (e) => (e.position ?? "before-pipeline") === "before-pipeline"
);
const industryAfter = industrySidebarItems.filter(
  (e) => e.position === "after-pipeline"
);

function renderIndustryEntry(entry: SidebarEntry) {
  if (entry.kind === "group") {
    return <SidebarGroupRender key={entry.id} group={entry} pathname={pathname} onNavigate={() => setMobileOpen(false)} />;
  }
  return renderItem({ href: entry.href, label: entry.label, icon: INDUSTRY_ICONS[entry.icon] ?? FileText });
}

// In the JSX:
{/* Universal top */}
{UNIVERSAL_NAV_TOP.map(renderItem)}

{/* Industry entries that come before Pipeline */}
{industryBefore.map(renderIndustryEntry)}

{/* Universal middle (Pipeline) */}
{UNIVERSAL_NAV_MIDDLE.map(renderItem)}

{/* Industry entries that come after Pipeline */}
{industryAfter.map(renderIndustryEntry)}

{/* Universal bottom (Team, Settings) */}
{UNIVERSAL_NAV_BOTTOM.map(renderItem)}
```

Where `renderItem` is a small inline function that renders the existing Link with active-state logic. Keep `renderItem` and `renderIndustryEntry` inline rather than extracting to new files — they're specific to this shell.

**For the 5 other industries (education_consultancy, healthcare, etc.)** that have no `position` field on any entry: `industryBefore` collects all of them, `industryAfter` is empty. Their rendered order is unchanged from today (industry items → Pipeline → Team/Settings). Zero risk of regression.

**4c. Group rendering — mirror Public Forms** (`shell.tsx:204-235`):

```tsx
function SidebarGroupRender({ group, pathname, onNavigate }: {
  group: SidebarGroup;
  pathname: string;
  onNavigate: () => void;
}) {
  const ParentIcon = INDUSTRY_ICONS[group.icon] ?? FileText;

  const isChildActive = (item: SidebarItem) =>
    pathname === item.href ||
    (item.href !== "/dashboard" && pathname.startsWith(item.href));

  const hasActiveChild = group.children.some(isChildActive);
  const [expanded, setExpanded] = useState(true);   // default expanded per brief

  // Re-expand if a child becomes active via navigation (don't auto-collapse).
  useEffect(() => {
    if (hasActiveChild) setExpanded(true);
  }, [hasActiveChild]);

  return (
    <div>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        className={`w-full flex items-center justify-between gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
          hasActiveChild
            ? "bg-[#ebebeb] text-gray-900"
            : "text-gray-500 hover:bg-[#ebebeb] hover:text-gray-900"
        }`}
      >
        <div className="flex items-center gap-3">
          <ParentIcon className="w-[18px] h-[18px]" />
          {group.label}
        </div>
        <ChevronDown className={`w-4 h-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>
      {expanded && (
        <div className="relative mt-1 ml-[20px] pl-[18px] border-l border-gray-300 space-y-1">
          {group.children.map((child) => {
            const ChildIcon = INDUSTRY_ICONS[child.icon] ?? FileText;
            const active = isChildActive(child);
            return (
              <Link
                key={child.href}
                href={child.href}
                onClick={onNavigate}
                className={`w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
                  active
                    ? "bg-[#ebebeb] text-gray-900 font-medium"
                    : "text-gray-500 hover:bg-[#ebebeb] hover:text-gray-900"
                }`}
              >
                <ChildIcon className="w-4 h-4" />
                {child.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

**Notes on the implementation:**

- **`useEffect` re-expand on `hasActiveChild` change**: handles the case where the user clicks a top-level item, then clicks a child link via the URL bar — group re-opens. Doesn't force collapse-on-leave (if user manually collapsed but child is no longer active, group stays collapsed).
- **`aria-expanded` on the toggle button**: a11y improvement over the existing Public Forms pattern. Worth adding here even though Public Forms didn't have it.
- **Child link styling**: smaller padding (`px-2 py-1.5`), smaller icon (`w-4 h-4`), and `font-medium` only when active. Mirrors Public Forms' children density.
- **`SidebarGroupRender` lives inside `shell.tsx`** — don't extract to a new file. It's tightly coupled to the shell's styling and only used here.

**4d. The mobile Sheet sidebar** (around `shell.tsx:240+`): no changes needed. The `sidebarContent` block is shared between desktop and mobile via the same `nav` element. The new group rendering inherits.

---

## Patterns to reuse (from existing code)

- **Public Forms collapsible group**: `src/components/dashboard/shell.tsx:204-235`. Copy the chevron + indent + left-border pattern verbatim, just for industry groups.
- **Active-state logic**: existing on lines 183-185 of `shell.tsx`. Reuse the formula for child active-check.
- **`INDUSTRY_ICONS` resolution pattern**: existing on lines 65-78. Add `FolderKanban` alongside other Lucide imports.
- **`useState` for expansion** (Public Forms uses `formsExpanded`). Same approach for groups.

---

## Files to touch

| File | Change | LOC est. |
|---|---|---|
| `src/industries/_types.ts` | Add `SidebarGroup` + `SidebarEntry`, update `IndustryManifest.sidebar` typing, add optional `kind?: "item"` to `SidebarItem`. | ~20 |
| `src/industries/_loader.ts` | Update `getIndustrySidebarItems` to filter recursively + drop empty groups using `flatMap`. | ~25 |
| `src/industries/it-agency/manifest.ts` | Wrap 3 entries in a group. | ~12 net |
| `src/components/dashboard/shell.tsx` | Update prop type, restructure nav render into 4 regions, add `SidebarGroupRender` helper component, add `FolderKanban` to `INDUSTRY_ICONS`. | ~80 |

**Total: 4 files. ~135 LOC net. UI + types only — no DB, no API, no migrations.**

---

## Verification

Before merging:

- [ ] `npm run build` clean locally.
- [ ] `npx eslint --max-warnings 50 .` clean locally (CI hard gate).
- [ ] **IT agency (Zunkireelabs login)**:
  - Sidebar shows in this exact order: Dashboard · All Leads · Contacts · Accounts · **Pipeline** · **Project Management** (group, **expanded by default**) · Team · Settings · View Public Form.
  - Pipeline now sits **between Accounts and Project Management** (was previously between the 3 delivery items and Team — verify the move via DOM order).
  - Project Management group has chevron icon; clicking the parent toggles between expanded and collapsed.
  - Group is highlighted (bg-`#ebebeb`) when on `/projects`, `/time-tracking`, or `/time-tracking/approvals`.
  - Children indented under the parent with left border + smaller padding, mirroring Public Forms.
  - Children are: Projects (LayoutGrid icon) · Time Tracking (Clock icon) · Approvals (Stamp icon).
  - **As a counselor user** (manjila@zunkireelabs.com): Approvals child does NOT appear (filtered by `minRoles`). Group still renders because Projects + Time Tracking remain.
  - Active child has the same bg-`#ebebeb` + font-medium treatment.
  - Manually collapsing the group keeps it collapsed until: page reload OR navigation to a child page (which re-expands).
- [ ] **Mobile Sheet sidebar**: open the mobile sidebar and verify the group renders identically. Clicking a child closes the sheet (existing `setMobileOpen(false)` behavior preserved via `onNavigate` prop).
- [ ] **Other industries** (login as Admizz Education): sidebar uses the existing flat layout — Check-In + Forms still render as flat top-level items, no groups, no regressions. The discriminated union's optional `kind` field + the default `"before-pipeline"` position together handle back-compat without forcing those manifests to change. Sidebar order for Admizz should be unchanged from today (Pipeline still appears after Check-In + Forms because they default to before-pipeline).
- [ ] **Active-state precision**: visiting `/time-tracking/approvals` highlights Approvals + Project Management parent (but NOT Time Tracking, since Time Tracking is `/time-tracking` and Approvals starts with that prefix — verify the `startsWith` rule still works correctly for non-overlap. If Time Tracking erroneously highlights when on `/time-tracking/approvals`, that's a pre-existing bug, not caused by this brief).
- [ ] **Page-padding stacks with shell**: N/A (no page wrapper changes).
- [ ] **All 7 code-review checklist items considered**: PostgREST FK / PATCH invariants / route shell / .select shape / Radix Select / cross-cutting predicate / page-padding — all N/A. This is a pure UI + types change.

### Manual smoke matrix

After deploying to dev, smoke against:

1. Owner (admin@zunkireelabs.com): see all 3 children, group expanded.
2. Counselor (manjila@zunkireelabs.com if rotated, else any non-admin): only see Projects + Time Tracking (no Approvals); group still expanded.
3. Click parent → collapses; click again → expands.
4. Navigate to `/projects` while group is collapsed → group auto-expands (`useEffect` on `hasActiveChild`).
5. Navigate to `/dashboard` after manually collapsing the group → stays collapsed (correct: no child active, no force re-expand).
6. Mobile viewport: open Sheet sidebar; group renders + child click closes sheet.

---

## Sonnet handoff prompt

Paste the block below to a fresh Sonnet session.

```
You're implementing a sidebar nav grouping change on a feature branch. Read /Users/sadinshrestha/Projects/edgeXcrm/docs/SIDEBAR-NAV-GROUPING-BRIEF.md end-to-end before touching any code — it has the full scope, the file list, the discriminated-union schema design, the renderer pattern to copy from Public Forms, and the verification checklist.

Workflow:
1. From the repo root, fetch latest stage and branch off it:
   git fetch origin && git checkout -b feat/sidebar-nav-grouping origin/stage
2. Implement the 4 file changes per the brief:
   - src/industries/_types.ts — add SidebarGroup + SidebarEntry discriminated union; add optional kind?: "item" to SidebarItem; add optional position?: "before-pipeline" | "after-pipeline" to both SidebarItem and SidebarGroup; update IndustryManifest.sidebar typing
   - src/industries/_loader.ts — update getIndustrySidebarItems to filter recursively via flatMap, drop empty groups (position passes through unchanged)
   - src/industries/it-agency/manifest.ts — wrap Projects/Time Tracking/Approvals in a single Project Management group with FolderKanban icon AND position: "after-pipeline"
   - src/components/dashboard/shell.tsx — update industrySidebarItems prop type, restructure nav render into 5 regions (universal-top, industry-before-pipeline, universal-middle Pipeline, industry-after-pipeline, universal-bottom), partition industry entries by position field, add SidebarGroupRender helper component (inline, not extracted), add FolderKanban to INDUSTRY_ICONS
3. Verify locally before pushing:
   - npm run build  (clean)
   - npx eslint --max-warnings 50 .  (clean — this is the CI hard gate, local build does NOT run ESLint)
4. Self-check against the verification checklist at the bottom of the brief, including the per-role and per-route smoke notes.
5. Commit with a clear message and push the branch. Don't merge; Opus reviews and squash-merges to stage.

Important constraints from the brief:
- Default group expansion is EXPANDED (per Sadin's choice). v1 ships without localStorage persistence — manually collapsing resets on reload. Don't add localStorage.
- 1-level nesting only. The discriminated union shape-wise allows nested groups but the renderer doesn't need to support that. Don't pre-build.
- Other industry manifests (education_consultancy, healthcare, etc.) stay flat — the optional kind?: "item" on SidebarItem makes their existing arrays compile unchanged. Don't touch them.
- Pipeline + Contacts + Accounts stay top-level (no group). Only Projects + Time Tracking + Approvals go inside the Project Management group.
- Pipeline gets repositioned: it should now sit BETWEEN Accounts and the Project Management group, not below Project Management. This is achieved by setting position: "after-pipeline" on the Project Management group (NOT by moving Pipeline itself out of UNIVERSAL_NAV_MIDDLE — keep Pipeline where it is in the universal arrays). The shell render order naturally produces: TOP → industry-before-pipeline (Contacts, Accounts) → UNIVERSAL_MIDDLE (Pipeline) → industry-after-pipeline (Project Management group) → BOTTOM (Team, Settings). Final visible order: Dashboard, All Leads, Contacts, Accounts, Pipeline, Project Management group, Team, Settings.
- Other industries (education_consultancy, healthcare, etc.) have no entries with position set, so they default to "before-pipeline" and render unchanged — Pipeline still appears after their industry items. Zero regression risk.
- aria-expanded on the new group toggle button (small a11y improvement over the existing Public Forms pattern). Don't retrofit Public Forms in this brief.
- SidebarGroupRender lives inside shell.tsx as a local helper component. Don't extract to a separate file.
- Counselor users should see the group with only Projects + Time Tracking (Approvals filtered out by minRoles). If all children are filtered, the group itself drops via the loader's empty-group check.
- Active-state: parent group is highlighted (bg-#ebebeb) when any child's pathname matches. Active child has bg-#ebebeb + font-medium.
- Auto-expand on hasActiveChild via useEffect — handles the case where user collapses then navigates to a child via URL.

If anything in the brief is ambiguous or you find a real issue with the approach, surface it in the handoff back to Opus rather than guessing.
```
