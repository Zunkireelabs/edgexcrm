# Polish: Contacts list (IT agency) — Avatars + Sort + Pagination

**Owner**: Opus (plan + review) → Sonnet (implement)
**Branch**: `chore/contacts-list-polish`
**Base**: `stage` (currently `285b2a8` — chrome match just shipped)
**Scope**: IT agency `/contacts` list page only. Same file, additive on top of the chrome match that shipped in `285b2a8`. Do NOT touch `/contacts/[id]`, education_consultancy paths, APIs, queries, or hooks.

## Why

After the chrome match, the IT agency `/contacts` list visually parallels `/leads` except for 4 deferred items (avatars, sort, pagination, preview panel). This branch ships 3 of them: **avatars, sort, pagination**. Preview panel is deferred to its own branch — it's real feature work (404px side-panel component) not chrome polish.

Reference file to mirror: **`src/components/dashboard/leads-table.tsx`**. The exact line ranges to mirror are called out below.

## File to change

**Only this file**:
- `src/industries/it-agency/features/crm-contacts/pages/contacts-list.tsx`

## The 3 changes

### 1. Avatars — initials circle next to Name

Mirror leads-table.tsx — the `getInitials()` helper (lines 81–85) + the avatar cell (lines 819–823).

**Helper** (add near the existing `fullName` helper):
```tsx
function getInitials(firstName?: string | null, lastName?: string | null): string {
  const first = firstName?.charAt(0)?.toUpperCase() || "";
  const last = lastName?.charAt(0)?.toUpperCase() || "";
  return first + last || "?";
}
```

**Table header** — insert a new `<th>` BEFORE the Name column (so avatar gets its own thin column):
```tsx
<th className="px-2 py-2 text-left text-xs font-medium text-gray-600 w-8"></th>
<th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Name</th>
```

Empty `<th>` (no header text) — matches leads-table.tsx:772.

**Table row** — insert the avatar cell BEFORE the Name cell:
```tsx
<td className="px-2 py-1.5">
  <div className="h-6 w-6 rounded-full flex items-center justify-center bg-gray-100 border border-gray-300 text-gray-500 text-xs font-medium">
    {getInitials(contact.first_name, contact.last_name)}
  </div>
</td>
```

Match leads' exact avatar chrome (h-6 w-6, rounded-full, bg-gray-100 + border-gray-300 + text-gray-500). Don't introduce contact-specific colors.

### 2. Sort — Popover with field + direction toggle

Mirror leads-table.tsx — Sort button + Popover (lines 506–558). The Popover sits in the toolbar's top row, BEFORE the Add Contact button (i.e. between the spacer and Add).

**State** (add near other useState calls):
```tsx
type SortField = "name" | "email" | "title" | "created";
type SortDirection = "asc" | "desc";
const [sortField, setSortField] = useState<SortField>("name");
const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
```

`"name"` ascending is the natural default for an address-book-style table — leads uses `"created"` desc because newer leads are more interesting, but for contacts alphabetical-by-name is the standard CRM expectation.

**Sort the contacts client-side** — add a `sorted` useMemo that wraps the `contacts` array. This goes BETWEEN the existing contacts state and the pagination slice (next item). Sort fields:
- `"name"` → compare `${first_name} ${last_name}`.toLowerCase()
- `"email"` → compare `(email || "").toLowerCase()`
- `"title"` → compare `(title || "").toLowerCase()`
- `"created"` → compare `new Date(created_at).getTime()`

```tsx
const sorted = useMemo(() => {
  const result = [...contacts];
  result.sort((a, b) => {
    let cmp = 0;
    switch (sortField) {
      case "name": {
        const aName = `${a.first_name || ""} ${a.last_name || ""}`.trim().toLowerCase();
        const bName = `${b.first_name || ""} ${b.last_name || ""}`.trim().toLowerCase();
        cmp = aName.localeCompare(bName);
        break;
      }
      case "email":
        cmp = (a.email || "").toLowerCase().localeCompare((b.email || "").toLowerCase());
        break;
      case "title":
        cmp = (a.title || "").toLowerCase().localeCompare((b.title || "").toLowerCase());
        break;
      case "created":
        cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        break;
    }
    return sortDirection === "asc" ? cmp : -cmp;
  });
  return result;
}, [contacts, sortField, sortDirection]);
```

**Sort UI** — copy the exact Popover pattern from leads-table.tsx:506–558. Add imports for Popover, PopoverTrigger, PopoverContent, Select pieces, and the ArrowUpDown icon.

```tsx
<Popover>
  <PopoverTrigger asChild>
    <Button variant="outline" size="sm" className="h-9 gap-2">
      <ArrowUpDown className="h-4 w-4" />
      Sort
    </Button>
  </PopoverTrigger>
  <PopoverContent align="end" className="w-72 p-4">
    <div className="space-y-4">
      <p className="text-sm font-medium">Sort by</p>
      <div className="flex items-center gap-2">
        <Select value={sortField} onValueChange={(v) => setSortField(v as SortField)}>
          <SelectTrigger className="flex-1 h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name">Name</SelectItem>
            <SelectItem value="email">Email</SelectItem>
            <SelectItem value="title">Title</SelectItem>
            <SelectItem value="created">Date created</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex rounded-md border shrink-0">
          <button
            type="button"
            onClick={() => setSortDirection("desc")}
            className={`px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
              sortDirection === "desc"
                ? "bg-primary text-primary-foreground"
                : "bg-background hover:bg-muted"
            }`}
          >
            Z→A
          </button>
          <button
            type="button"
            onClick={() => setSortDirection("asc")}
            className={`px-3 py-2 text-xs font-medium transition-colors border-l whitespace-nowrap ${
              sortDirection === "asc"
                ? "bg-primary text-primary-foreground"
                : "bg-background hover:bg-muted"
            }`}
          >
            A→Z
          </button>
        </div>
      </div>
    </div>
  </PopoverContent>
</Popover>
```

**Placement** — in the toolbar top row, AFTER `<div className="flex-1" />` (spacer) and BEFORE the Add Contact button. Match leads-table.tsx:504–572 ordering: search · spacer · Sort · Add. (Leads also has Export between Sort and Add — we are NOT adding Export to contacts in this branch. Defer.)

### 3. Pagination — per-page selector + page nav

Mirror leads-table.tsx — pagination state (lines 188–190, 316–322), and the footer UI inside the table card (lines 950–998).

**State**:
```tsx
const [currentPage, setCurrentPage] = useState(1);
const [itemsPerPage, setItemsPerPage] = useState(25);
```

**Slice the sorted array** — after the `sorted` useMemo, add:
```tsx
const totalPages = Math.ceil(sorted.length / itemsPerPage);
const startIndex = (currentPage - 1) * itemsPerPage;
const endIndex = Math.min(startIndex + itemsPerPage, sorted.length);
const paginatedContacts = useMemo(() => {
  return sorted.slice(startIndex, endIndex);
}, [sorted, startIndex, endIndex]);
```

Use `paginatedContacts` in the `.map()` inside the table body (replaces the current `contacts.map(...)`).

**Reset to page 1 on filter or sort change** — the existing filter `useEffect` already triggers refetch when filters change; the contacts array is replaced server-side. Add a separate `useEffect` to reset currentPage when filters/sort change:
```tsx
useEffect(() => {
  setCurrentPage(1);
}, [debouncedQ, filterAccountId, filterStatus, sortField, sortDirection]);
```

Mirror the existing `currentPage > totalPages` recovery effect from leads-table.tsx:325–329:
```tsx
useEffect(() => {
  if (currentPage > totalPages && totalPages > 0) {
    setCurrentPage(1);
  }
}, [currentPage, totalPages]);
```

**Pagination footer UI** — copy leads-table.tsx:950–998 verbatim, replacing "leads" with "contacts" semantically (though the visible footer text is "Showing X-Y of Z" with no entity name). Place INSIDE the table card, AFTER the scrollable region:

```tsx
{/* inside the table card, after the overflow-auto scroll region */}
<div className="shrink-0 flex justify-between items-center px-3 py-2 border-t border-gray-100">
  <span className="text-xs text-gray-500">
    Showing {sorted.length === 0 ? 0 : startIndex + 1}-{endIndex} of {sorted.length}
  </span>
  <div className="flex items-center gap-4">
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-500">per page</span>
      <Select
        value={String(itemsPerPage)}
        onValueChange={(v) => {
          setItemsPerPage(Number(v));
          setCurrentPage(1);
        }}
      >
        <SelectTrigger className="h-7 w-16 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="10">10</SelectItem>
          <SelectItem value="25">25</SelectItem>
          <SelectItem value="50">50</SelectItem>
          <SelectItem value="100">100</SelectItem>
        </SelectContent>
      </Select>
    </div>
    <div className="flex items-center gap-1">
      <button
        disabled={currentPage <= 1}
        onClick={() => setCurrentPage((p) => p - 1)}
        className="p-1 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
      <span className="text-xs text-gray-600 px-2">
        Page {currentPage} of {totalPages || 1}
      </span>
      <button
        disabled={currentPage >= totalPages}
        onClick={() => setCurrentPage((p) => p + 1)}
        className="p-1 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  </div>
</div>
```

Add icon imports: `ChevronLeft`, `ChevronRight`, `ArrowUpDown` (from `lucide-react`).
Add component imports: `Popover, PopoverTrigger, PopoverContent` (from `@/components/ui/popover`), `Select, SelectContent, SelectItem, SelectTrigger, SelectValue` (from `@/components/ui/select` — re-introducing these since the chrome branch dropped them).

**Important — count line in the toolbar**: today the toolbar count reads `{contacts.length} Contacts`. Update to use the sorted-but-not-paginated total: `{sorted.length} Contacts`. The count should reflect "how many match the current filter+sort", not "how many on this page". Matches leads' use of `filtered.length`.

## What to LEAVE ALONE

- All existing chrome from the previous branch (toolbar card, FilterDropdown chips, active filter badge, table card with bg-gray-50 thead).
- The empty-state block (polished icon + h3 + CTA).
- The loading state.
- `ContactForm` dialog.
- All API/fetch/useEffect logic for loading contacts and accounts.
- `clearFilters` and `activeFiltersCount` from the chrome branch.
- `fullName` helper.

## What NOT to add

- **Checkboxes / bulk select** — out of scope (no bulk actions wired; would be decorative).
- **Eye/Preview column** — separate branch when we decide to invest in a contact preview panel.
- **Export CSV** — feature work; defer.
- **Sort indicators in column headers** (clickable th to sort) — leads doesn't do this either; the Popover is the single sort surface.
- **Server-side pagination / sort** — client-side only; same as leads.

## Verification matrix

Local before pushing:

- [ ] `npm run build` clean.
- [ ] `npx eslint --max-warnings 50 .` clean.
- [ ] As `admin@zunkireelabs.com` on dev (after stage deploy):
  - Avatar circle (initials, gray-100 bg, gray-300 border) appears in a thin column left of each contact name. Matches leads visually.
  - Sort button is in the toolbar top row, between the search-spacer and the Add Contact button. Clicking opens a popover with Sort-by Select (Name / Email / Title / Date created) + A→Z / Z→A direction toggle. Changing sort visibly reorders the table.
  - Pagination footer at the bottom of the table card shows "Showing 1-10 of N" with the per-page Select (10/25/50/100) and Page X of Y nav.
  - Changing per-page resets to page 1.
  - Changing any filter (search, account, status) OR sort resets currentPage to 1.
  - Clicking through pages with Chevron buttons works; buttons disabled at boundaries.
  - Toolbar count "X Contacts" reflects total post-sort, not just visible page.
- [ ] Empty state still renders correctly when filters return zero contacts. Pagination footer shows "0-0 of 0", Page 1 of 1.
- [ ] As a non-admin counselor/viewer: Add Contact + Sort + pagination all visible (no role-gating on these surfaces — they're navigational/read affordances).
- [ ] Education consultancy tenant unchanged.

## Edge cases to verify

- 0 contacts: pagination shows `0-0 of 0`, both Chevron buttons disabled.
- Exactly 25 contacts (default per-page): pagination shows `1-25 of 25`, both Chevrons disabled, "Page 1 of 1".
- 26 contacts: shows `1-25 of 26` on page 1, next Chevron enabled; click → `26-26 of 26`, prev enabled.
- Sort by `title` when most contacts have null titles: localeCompare on empty string sorts them together, then the non-null titles alphabetically. Acceptable.

## Code-review checklist (6 standing items)

All N/A — UI/state-only, no DB / no API / no new page / no `<SelectItem value="">` / no PostgREST embed / no cross-cutting predicate. (The `<SelectItem>` instances added all use non-empty string values.)

## Handoff format

Sonnet pushes the branch when done and stops. Opus fetches, reviews diff, runs gates, smokes dev after deploy, squash-merges to stage.

---

## Handoff prompt (paste to Sonnet)

```
You are implementing a UI polish change on a fresh feature branch in the Lead Gen CRM repo at /Users/sadinshrestha/Projects/edgeXcrm. Full instructions are in the brief at docs/CONTACTS-LIST-POLISH-BRIEF.md — read it end-to-end before writing any code, then follow it precisely.

This is additive UI work in ONE file: src/industries/it-agency/features/crm-contacts/pages/contacts-list.tsx. The previous branch (chore/contacts-list-chrome, already merged at 285b2a8) aligned the chrome with /leads. This branch adds three deferred polish items: avatar initials column, Sort popover, and pagination. Reference file to mirror is src/components/dashboard/leads-table.tsx — exact line ranges are called out in the brief.

Workflow:

1. From the repo root, ensure you're on stage with the latest: git checkout stage && git pull origin stage && git checkout -b chore/contacts-list-polish.
2. Read the brief, then read leads-table.tsx (esp. lines 81–85 for getInitials, 506–558 for the Sort popover, 188–190 + 316–329 for pagination state, 819–823 for the avatar cell, 950–998 for the pagination footer). Then read the current contacts-list.tsx end-to-end so you understand what the chrome branch left in place.
3. Implement the 3 numbered changes in the brief, in this order:
   1. Avatars — new column before Name with the getInitials helper + 6x6 gray-100 circle.
   2. Sort — Popover with Name/Email/Title/Created field Select + A→Z/Z→A direction toggle. Add client-side useMemo to sort contacts.
   3. Pagination — currentPage/itemsPerPage state, slice the sorted array into paginatedContacts, render leads-style footer inside the table card. Reset to page 1 on filter or sort change.
4. Update the toolbar count line from `{contacts.length} Contacts` to `{sorted.length} Contacts` so the count reflects the full sorted set, not just the current page.
5. LEAVE ALONE: all chrome shipped in 285b2a8 (toolbar card, FilterDropdown chips, active-filter badge, table card thead pattern), the empty state, loading state, ContactForm, API/fetch logic, clearFilters, activeFiltersCount, fullName helper.
6. Do NOT add checkboxes / bulk select / Export / preview column / sort indicators on column headers / server-side sort or pagination. Brief lists everything not to add.
7. Add the new imports: ArrowUpDown, ChevronLeft, ChevronRight (lucide-react); Popover/PopoverTrigger/PopoverContent (ui/popover); Select/SelectContent/SelectItem/SelectTrigger/SelectValue (ui/select — re-introducing these; the chrome branch removed them).
8. Run BOTH gates locally before pushing:
   - npm run build — must finish clean.
   - npx eslint --max-warnings 50 . — must finish clean.
9. Commit with a single descriptive message. Standard project style: subject line + short body. Do NOT include any Claude/Anthropic co-author trailer; the repo's commit-msg hook handles co-authoring.
10. Push: git push -u origin chore/contacts-list-polish. DO NOT open a PR. DO NOT merge. Stop after the push.

Final summary should report: (1) the diff stat (files / insertions / deletions), (2) build + eslint exact tail output, (3) commit SHA + branch push confirmation, (4) anything you noticed that diverged from the brief — including any place where mirroring leads exactly looked wrong in context. Pay special attention to: did you verify the page-reset effect doesn't fight with the existing currentPage > totalPages recovery effect (run them in your head — if both fire on the same render they should still resolve to page 1 cleanly); and did you keep the pagination footer INSIDE the table card so it sits below the sticky thead and above the white card border.
```
