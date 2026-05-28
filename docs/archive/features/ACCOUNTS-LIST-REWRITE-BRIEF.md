# /accounts list rewrite — convert card-list to leads-pattern table

**Owner**: Opus (plan + review) → Sonnet (implement)
**Branch**: `chore/accounts-list-rewrite`
**Base**: `stage` (currently `aec9cf5`)
**Scope**: Full UI rewrite of `/accounts` list page for IT agency. Card-list → table that mirrors `/leads` and `/contacts` exactly. No DB / API / hook / business-logic touched — the API at `/api/v1/accounts` already returns what we need (accounts with `project_count` joined). One file changed.

## Why

After the chrome match + design pass shipped across `/leads` and `/contacts`, the `/accounts` page is the visible odd-one-out: it's a stack of card components (one Card per account with `border shadow-none hover:shadow-sm`, 12px gap between cards) sitting inside the white chrome card. Reads as "grey cards inside the white card" — same issue Sonnet flagged earlier for `/pipeline`, `/projects`, `/leads`. The visual gap is bigger here than just toning, so we're rewriting `/accounts` to be a real table matching the established pattern.

After this branch, `/accounts` will visually parallel `/leads` and `/contacts`: same toolbar, same filter chips, same table card chrome, same sort popover, same pagination footer.

## File to change

Exactly one:
- `src/industries/it-agency/features/accounts/pages/accounts-list.tsx`

No other files. Do NOT touch:
- `account-detail.tsx` — separate follow-up branch.
- `account-form.tsx`, `project-form.tsx` — the create/edit dialogs are fine.
- `/api/v1/accounts/*` routes — server already returns what we need.
- `meta.ts`, sidebar entry — unaffected.
- The Education Consultancy code paths — accounts is IT-agency-only.

## Reference files to mirror

The brief works by mirroring established patterns:
- **Toolbar + filter row chrome**: `src/components/dashboard/leads-table.tsx` lines 478–718 — count + search + Sort + Add button + divider + FilterDropdown chips + active-filter badge + Clear.
- **Table card chrome**: leads-table.tsx lines 759–998 — `bg-white rounded-lg border border-gray-200` wrapper, sticky `bg-gray-50` thead, divide-y body, hover rows, pagination footer.
- **Avatars, sort popover, pagination**: `src/industries/it-agency/features/crm-contacts/pages/contacts-list.tsx` (the polish patterns just shipped). Specifically:
  - Avatar cell: contacts-list.tsx around lines 330–334 (the `h-6 w-6` initials circle).
  - Sort popover with field+direction toggle: contacts-list.tsx around lines 195–250.
  - Pagination footer: contacts-list.tsx around lines 380–425.
  - Client-side sort + paginate logic: contacts-list.tsx around lines 115–150.

Read both reference files end-to-end before writing the new accounts-list.tsx.

## What the new `/accounts` page should look like

### Page shell
```tsx
<div className="flex flex-1 min-h-0 gap-0">
  <div className="flex flex-col flex-1 min-h-0 min-w-0 gap-2 overflow-hidden pr-6">
    <h1 className="shrink-0 text-lg font-bold mb-4">Accounts</h1>
    {/* Toolbar card */}
    {/* Table card OR empty/loading state */}
  </div>
</div>
```

Drop the outer `p-6 space-y-6`, the `text-2xl font-semibold` H1, and the subtitle "Companies and clients your team works with". The count line replaces the subtitle's role.

### Toolbar card (mirror leads / contacts exactly)

Wrap in `<div className="shrink-0 bg-card rounded-lg border">`. Two rows separated by `<div className="h-px bg-border" />`.

**Top row** (flex flex-wrap items-center gap-3 p-3):
- Count: `{sorted.length} Accounts`
- Search input (`w-60` raw input, leads-style), debounced 250ms, filters on `name` + `primary_contact_email`
- Spacer
- Sort Popover (mirror contacts polish — field options: Name / Created / Projects; direction A→Z / Z→A; default sortField="name", sortDirection="asc")
- New Account button (`<Button size="sm" className="h-9 gap-2">` with `<Plus>` icon)

**Filter row** (flex flex-wrap items-center gap-1.5 px-3 py-2):
- Status `<FilterDropdown>`: options [Active (default), Inactive, All]. Icon optional — pass nothing (no icon needed). `searchable={false}`.
- Spacer
- Active-filter badge + Clear ghost button (mirror contacts pattern; default status is "active" — counts non-default state)

Use the existing FilterDropdown, Badge, X icon, ArrowUpDown, ChevronLeft, ChevronRight imports — all already in the codebase.

### Active filter helpers
```tsx
const activeFiltersCount = [
  searchInput !== "",
  filterStatus !== "active",
].filter(Boolean).length;
const hasActiveFilters = activeFiltersCount > 0;

function clearFilters() {
  setSearchInput("");
  setFilterStatus("active");
  setCurrentPage(1);
}
```

### Client-side filter + sort + paginate

Fetch once on mount via `fetch("/api/v1/accounts")`. No server-side query params — we filter client-side on the loaded array (like leads does). The API already orders by name ascending; the client sort takes over after that.

```tsx
type SortField = "name" | "created" | "projects";
type SortDirection = "asc" | "desc";
const [sortField, setSortField] = useState<SortField>("name");
const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
const [currentPage, setCurrentPage] = useState(1);
const [itemsPerPage, setItemsPerPage] = useState(25);

const filtered = useMemo(() => {
  return accounts.filter((a) => {
    if (filterStatus === "active" && !a.is_active) return false;
    if (filterStatus === "inactive" && a.is_active) return false;
    // "all" keeps everything
    if (debouncedQ) {
      const q = debouncedQ.toLowerCase();
      const matchesName = a.name.toLowerCase().includes(q);
      const matchesEmail = (a.primary_contact_email ?? "").toLowerCase().includes(q);
      if (!matchesName && !matchesEmail) return false;
    }
    return true;
  });
}, [accounts, debouncedQ, filterStatus]);

const sorted = useMemo(() => {
  const result = [...filtered];
  result.sort((a, b) => {
    let cmp = 0;
    switch (sortField) {
      case "name":
        cmp = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
        break;
      case "created":
        cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        break;
      case "projects":
        cmp = a.project_count - b.project_count;
        break;
    }
    return sortDirection === "asc" ? cmp : -cmp;
  });
  return result;
}, [filtered, sortField, sortDirection]);

const totalPages = Math.ceil(sorted.length / itemsPerPage);
const safePage = totalPages > 0 ? Math.min(currentPage, totalPages) : 1;
const startIndex = (safePage - 1) * itemsPerPage;
const endIndex = Math.min(startIndex + itemsPerPage, sorted.length);
const paginatedAccounts = useMemo(() => sorted.slice(startIndex, endIndex), [sorted, startIndex, endIndex]);
```

Use the `safePage` derivation pattern from contacts-list.tsx — same React 19 reason (avoids `react-hooks/set-state-in-effect`).

Reset to page 1 on filter or sort change via inline `setCurrentPage(1)` calls in handlers (same pattern as contacts-list.tsx).

### Table card

```tsx
<div className="flex-1 min-h-0 bg-white rounded-lg border border-gray-200 flex flex-col overflow-hidden">
  <div className="flex-1 min-h-0 overflow-auto">
    <table className="w-full">
      <thead className="sticky top-0 z-10">
        <tr className="border-b border-gray-200 bg-gray-50">
          <th className="px-2 py-2 text-left text-xs font-medium text-gray-600 w-8"></th>
          <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Name</th>
          <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Contact Email</th>
          <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 w-28">Projects</th>
          <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 w-24">Status</th>
          {isAdmin && <th className="px-3 py-2 text-right text-xs font-medium text-gray-600 w-24">Actions</th>}
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {paginatedAccounts.map((account) => (
          <tr key={account.id} className="hover:bg-gray-50 transition-colors">
            <td className="px-2 py-1.5">
              <div className="h-6 w-6 rounded-full flex items-center justify-center bg-gray-100 border border-gray-300 text-gray-500 text-xs font-medium">
                {getInitials(account.name)}
              </div>
            </td>
            <td className="px-3 py-1.5">
              <Link
                href={`/accounts/${account.id}`}
                className="text-sm font-medium text-[#0f0f10] hover:underline"
              >
                {account.name}
              </Link>
            </td>
            <td className="px-3 py-1.5 text-sm font-normal text-[#787871]">
              {account.primary_contact_email ? (
                <a href={`mailto:${account.primary_contact_email}`} className="hover:underline">
                  {account.primary_contact_email}
                </a>
              ) : (
                <span className="text-gray-400">—</span>
              )}
            </td>
            <td className="px-3 py-1.5 text-sm font-normal text-[#787871]">
              {account.project_count} {account.project_count === 1 ? "project" : "projects"}
            </td>
            <td className="px-3 py-1.5">
              <Badge
                variant="outline"
                className={
                  account.is_active
                    ? "bg-green-50 text-green-700 border-green-200"
                    : "bg-gray-100 text-gray-500 border-gray-200"
                }
              >
                {account.is_active ? "Active" : "Inactive"}
              </Badge>
            </td>
            {isAdmin && (
              <td className="px-3 py-1.5 text-right">
                <div className="flex items-center justify-end gap-1">
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={(e) => { e.preventDefault(); setEditTarget(account); }}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive" onClick={(e) => { e.preventDefault(); setDeleteTarget(account); }}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
  {/* Pagination footer mirroring contacts-list.tsx — see reference */}
</div>
```

### Pagination footer

Copy verbatim from contacts-list.tsx's pagination footer. Mirror the "Showing X-Y of Z" + per-page + Chevron nav pattern. Replace "Contacts" semantic with "Accounts" wherever it's user-visible (which is just the count line in the toolbar — pagination text is entity-agnostic).

### Status pill (inline, no new component)

Inline the active/inactive Badge styling using shadcn Badge with `variant="outline"`:
- Active: `bg-green-50 text-green-700 border-green-200` (same colors as `ContactStatusBadge` for Active)
- Inactive: `bg-gray-100 text-gray-500 border-gray-200` (same colors as `ContactStatusBadge` for Inactive)

Don't create a new `AccountStatusBadge` component. The two-row pill is simple enough inline.

### `getInitials` helper

Accounts have a single `name` field, not first/last. Compute initials from the first 2 words, or the first 2 letters if single-word:

```ts
function getInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const words = trimmed.split(/\s+/);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}
```

Example outputs:
- "Zunkireelabs" → "ZU"
- "CarbonSpark Inc" → "CI"
- "Admizz Education" → "AE"
- "A" → "A"

### Empty state

When `accounts.length === 0` (initial empty, not filter-zero), keep the existing polished empty state:
```tsx
<div className="border rounded-xl p-12 text-center bg-background">
  <Building2 className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
  <h3 className="font-semibold text-lg mb-1">No accounts yet</h3>
  <p className="text-muted-foreground text-sm mb-6">
    Add your first client account to start tracking projects and time.
  </p>
  {isAdmin && (
    <Button onClick={() => setCreateOpen(true)}>
      <Plus className="h-4 w-4 mr-2" />
      Create your first account
    </Button>
  )}
</div>
```

When `accounts.length > 0` but `sorted.length === 0` (filter-zero), don't render the polished empty state — instead, render the table card with zero rows (the pagination footer will show "Showing 0-0 of 0"). The active-filter badge + Clear button serves as the recovery affordance. This matches leads' filter-zero behavior.

### Loading state

Keep the existing centered spinner pattern:
```tsx
if (loading) {
  return (
    <div className="flex items-center justify-center h-48">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}
```

### Edit + Delete dialogs

Keep verbatim — the existing AccountForm dialog and Delete confirmation Dialog at the bottom of the file are fine. Just make sure the `setEditTarget` / `setDeleteTarget` state and handlers carry over to the new layout's row-action buttons.

## Imports needed

```tsx
import { useState, useEffect, useRef, useMemo } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Plus, Building2, Loader2, Pencil, Trash2, Search, X,
  ArrowUpDown, ChevronLeft, ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FilterDropdown } from "@/components/ui/filter-dropdown";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { AccountForm } from "../components/account-form";
import type { Account } from "@/types/database";
```

The `Card` / `CardContent` imports are GONE — no more cards in the new layout.

## What NOT to include

- **No bulk select / checkboxes** — accounts has no bulk action infrastructure. Same logic as contacts: don't add decorative checkboxes without real bulk actions.
- **No Export CSV** — feature work, defer.
- **No preview panel** — feature work, defer.
- **No sort indicators on column headers** — leads + contacts don't have this; the Sort popover is the single sort surface.
- **No server-side filtering** — client-side only, like leads. The API supports `?is_active=` but we don't use it.
- **No "Default" badge or similar** — accounts don't have a "default" concept.

## Edge cases

- **0 accounts**: empty-state card renders (existing polished pattern).
- **filter returns 0**: table card renders with 0 rows, pagination shows "0-0 of 0", active-filter badge + Clear visible.
- **Account with no `primary_contact_email`**: em-dash `<span className="text-gray-400">—</span>` placeholder.
- **Account with `name` that has special characters**: localeCompare handles unicode safely. `getInitials` handles single-character names.
- **Search by partial email**: case-insensitive `.includes()` on `primary_contact_email` lower-cased. Same as `name` search.

## Verification matrix

Local before pushing:

- [ ] `npm run build` clean.
- [ ] `npx eslint --max-warnings 50 .` clean.
- [ ] Visually on dev as `admin@zunkireelabs.com`:
  - Page renders as a table inside the white inset chrome (no more stacked Card components).
  - Toolbar: count "X Accounts" + search w-60 + Sort button + New Account button. Filter row: Status FilterDropdown (default Active) + active-filter badge + Clear when filter is non-default.
  - Table columns: Avatar (initials circle) · Name (near-black #0f0f10 link, hover underlines) · Contact Email (warm-muted #787871, mailto link if present) · Projects (#787871, "N projects" text) · Status (green Active pill or gray Inactive pill) · Actions (Edit + Delete ghost icons, admin-only). Status is the 5th column; Actions is the 6th (when shown).
  - Sticky thead `bg-gray-50` with `text-xs font-medium text-gray-600` headers, sentence-case (Name / Contact Email / Projects / Status / Actions).
  - Body rows: hover `bg-gray-50`, divide-y between rows.
  - Pagination footer: "Showing 1-10 of N" + per-page (10/25/50/100 default 25) + Chevron prev/next.
  - Sort popover: Name (default A→Z) / Date created / Projects, direction toggle works.
  - Status filter: select Inactive — only inactive accounts visible. Select All — both visible. Default Active — only active.
  - Search: type a partial name → table filters in real time (250ms debounce). Type a partial email → also filters.
  - Click Edit pencil → AccountForm dialog opens with that account. Submit → row updates in place. Click Delete trash → confirmation dialog → confirm → row removed.
  - Empty state still renders when zero accounts exist for tenant.
- [ ] As a non-admin (viewer/counselor) IT-agency user (if seed exists): Actions column header + cells should be hidden. New Account button hidden. Read-only experience works.
- [ ] Education_consultancy tenant (`admizzdotcom2020@gmail.com`): `/accounts` returns 404 (industry gate). Confirm unchanged behavior.
- [ ] After deploy, smoke that the Sort popover's "Projects" sort actually orders rows by project_count ascending/descending. (Don't ship if the field doesn't reach the row data.)

## Code-review checklist (6 standing items)

All N/A — UI-only rewrite, no DB / no new API / no new page / no `<SelectItem value="">` with empty string (the new ones use real values) / no PostgREST embed / no cross-cutting predicate.

## Handoff format

Sonnet pushes the branch when done and stops. Opus fetches, reviews diff, runs gates, smokes dev after deploy, squash-merges to stage.

---

## Handoff prompt (paste to Sonnet)

```
You are rewriting the /accounts list page on a fresh feature branch in the Lead Gen CRM repo at /Users/sadinshrestha/Projects/edgeXcrm. Full instructions are in the brief at docs/ACCOUNTS-LIST-REWRITE-BRIEF.md — read it end-to-end before writing any code, then follow it precisely.

This is a UI rewrite of ONE file: src/industries/it-agency/features/accounts/pages/accounts-list.tsx. The goal: convert the existing Card-stack layout to a table that mirrors /leads and /contacts exactly. The reference files to mirror are:
- src/components/dashboard/leads-table.tsx (toolbar + filter row + table card chrome — lines 478–998)
- src/industries/it-agency/features/crm-contacts/pages/contacts-list.tsx (avatars + sort popover + pagination + client-side filter+sort+paginate logic — entire file is the polished reference)

Read both reference files end-to-end BEFORE writing the new accounts-list.tsx. The patterns are well-established; this branch ports them to a new entity. Don't reinvent. Don't deviate stylistically from the reference unless the brief explicitly says so.

Workflow:

1. From repo root: git checkout stage && git pull origin stage && git checkout -b chore/accounts-list-rewrite.
2. Read the brief, then read both reference files (leads-table.tsx and contacts-list.tsx), then read the existing accounts-list.tsx end-to-end so you know what data shape you're working with.
3. Rewrite accounts-list.tsx per the brief. Structural pieces in order:
   a. Imports (the brief lists what's needed; remove Card / CardContent imports).
   b. getInitials helper for single-name accounts (first 2 words, or first 2 chars).
   c. State: contacts → loading, accounts, createOpen, editTarget, deleteTarget, deleting. Plus NEW state: searchInput, debouncedQ, filterStatus (default "active"), sortField (default "name"), sortDirection (default "asc"), currentPage, itemsPerPage. Plus a debounceTimer ref for the search debounce (mirror contacts).
   d. Existing useEffect to fetch /api/v1/accounts — keep as-is, no server-side params.
   e. Existing handleCreated / handleDelete / handleUpdated (carry over from current file).
   f. New: client-side filtered useMemo (status + search), sorted useMemo (3 fields × 2 directions), pagination calculations + safePage derivation (mirror contacts).
   g. New: activeFiltersCount + hasActiveFilters + clearFilters helpers.
   h. Page shell: flex flex-col h-full min-h-0 pattern matching contacts.
   i. Toolbar card: count + search + Sort popover + New Account button on top row, divider, Status FilterDropdown + Clear on bottom row.
   j. Table card with avatar / name / email / projects / status / actions columns. Status uses inline Badge (no new component).
   k. Pagination footer inside the table card.
   l. Empty state (accounts.length === 0) and loading state — both preserved from current file.
   m. AccountForm and Delete Dialog at the bottom — carry over verbatim.
4. LEAVE ALONE: account-detail.tsx, account-form.tsx, project-form.tsx, /api/v1/accounts routes, meta.ts, sidebar entries, education_consultancy code paths.
5. Do NOT add: bulk select / Export / preview panel / sort indicators on column headers / server-side filtering / a separate AccountStatusBadge component.
6. The brief specifies exact className patterns to mirror from the reference files — match them exactly. Particularly:
   - Toolbar card outer: shrink-0 bg-card rounded-lg border
   - Table card outer: flex-1 min-h-0 bg-white rounded-lg border border-gray-200 flex flex-col overflow-hidden
   - Sticky thead: bg-gray-50 on the <tr>, NOT on the <thead>
   - Header cells: text-xs font-medium text-gray-600 (no uppercase, no tracking)
   - Body rows: hover:bg-gray-50 transition-colors (note: hover bg here is gray-50, NOT the dropdown #0000170b — table rows on /leads + /contacts use gray-50; preserve that consistency)
   - Name link: text-sm font-medium text-[#0f0f10] hover:underline
   - Data cells: text-sm font-normal text-[#787871]
   - Em-dash: <span className="text-gray-400">—</span>
   - Avatar: h-6 w-6 rounded-full bg-gray-100 border border-gray-300 text-gray-500
7. Run BOTH gates locally before pushing:
   - npm run build — must finish clean.
   - npx eslint --max-warnings 50 . — must finish clean.
8. Commit with a single descriptive message. Standard project style. Do NOT include any Claude/Anthropic co-author trailer.
9. Push: git push -u origin chore/accounts-list-rewrite. DO NOT open a PR. DO NOT merge. Stop after the push.

Final summary should report: (1) diff stat (files / insertions / deletions — expect roughly +200 / -130 since this is a structural rewrite), (2) build + eslint exact tail output, (3) commit SHA + branch push confirmation, (4) anything you noticed — especially: did anything in the existing accounts-list.tsx state/logic feel like it should change but the brief said to preserve? Did the client-side filter/sort match the contacts pattern cleanly? Did the row-hover bg-gray-50 (not #0000170b) feel correct given the recent dropdown retone — i.e., is hover-gray-50 on table rows consistent with the dropdown #0000170b, or should table-row hover ALSO move to #0000170b? Surface judgment calls; don't bury them.
```
