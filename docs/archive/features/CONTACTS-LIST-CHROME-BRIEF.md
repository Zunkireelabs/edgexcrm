# Styling: align Contacts list (IT agency) with the Leads dashboard chrome pattern

**Owner**: Opus (plan + review) → Sonnet (implement)
**Branch**: `chore/contacts-list-chrome`
**Base**: `stage` (currently `f77fb01`)
**Scope**: **IT agency `/contacts` list page only**. Do NOT touch `/contacts/[id]` (detail page is in a separate follow-up branch). Do NOT touch the education_consultancy ContactsPage / ProspectsView path in `src/industries/education-consultancy/`. Do NOT touch any API route, query, hook, or DB code — this is **className + JSX structure only**.

## Why

`/contacts` for IT agency currently uses a one-off styling pattern (raw `<Select>` filter dropdowns, no toolbar card wrapper, bare-table-with-`bg-muted/40`-thead inside `border rounded-xl`, no count line, no active-filter indicator). The `/leads` page is the established gold-standard chrome for table-with-filters surfaces in this app: toolbar card with two rows, `FilterDropdown` chips, count line, active-filter badge + Clear, table inside its own card with sticky `bg-gray-50` thead. Make Contacts mirror Leads exactly so the IT agency dashboard feels coherent.

Reference file to mirror — **`src/components/dashboard/leads-table.tsx`** lines 478–998. Read it before writing any code; the patterns below are extracted from it.

## File to change

**Only this file**:
- `src/industries/it-agency/features/crm-contacts/pages/contacts-list.tsx`

No other files. No new components. No changes to `ContactStatusBadge`, `ContactForm`, or any sibling.

## The 5 changes

### 1. Page shell + header — match Leads

Today (lines 83–99 of contacts-list.tsx):
```tsx
<div className="p-6 space-y-6">
  <div className="flex items-center justify-between">
    <div>
      <h1 className="text-2xl font-semibold">Contacts</h1>
      <p className="text-muted-foreground text-sm mt-0.5">People at your client accounts</p>
    </div>
    {isAdmin && <Button onClick={...}>Add Contact</Button>}
  </div>
```

Replace with Leads' shell (see leads/page.tsx:50–51 + leads-table.tsx:479):
```tsx
<div className="flex flex-1 min-h-0 gap-0">
  <div className="flex flex-col flex-1 min-h-0 min-w-0 gap-2 overflow-hidden pr-6">
    <h1 className="shrink-0 text-lg font-bold mb-4">Contacts</h1>
    {/* Toolbar card goes here */}
    {/* Table card goes here */}
  </div>
</div>
```

Key changes:
- Drop the outer `p-6` — the dashboard layout's white inset card already provides padding (`<main className="... p-4 mr-4 mb-4 bg-white">` in `shell.tsx`).
- Drop the subtitle `"People at your client accounts"` — the count line in the toolbar will tell the story instead.
- H1 from `text-2xl font-semibold` → `text-lg font-bold`. Matches leads.
- The Add Contact button **moves out of the H1 row** and into the toolbar top row (next step). Don't render it next to H1 anymore.

### 2. Toolbar card — replicate Leads' two-row pattern with divider

The toolbar wraps everything filter-related in a single card with two rows separated by a 1px divider. See leads-table.tsx:483–718.

Structure to build:
```tsx
{/* Enhanced Toolbar - matching leads style */}
<div className="shrink-0 bg-card rounded-lg border">
  {/* Top Row: count + search + spacer + Add */}
  <div className="flex flex-wrap items-center gap-3 p-3">
    {/* Contact count */}
    <div className="text-sm font-medium text-muted-foreground shrink-0">
      {contacts.length} Contacts
    </div>

    {/* Search */}
    <div className="relative w-60">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <input
        type="text"
        placeholder="Search by name, email, title…"
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        className="w-full h-9 pl-9 pr-3 rounded-md border border-input bg-background text-sm outline-none focus:ring-2 focus:ring-ring"
      />
    </div>

    <div className="flex-1" />

    {/* Add Contact */}
    {isAdmin && (
      <Button size="sm" className="h-9 gap-2" onClick={() => setCreateOpen(true)}>
        <Plus className="h-4 w-4" />
        Add Contact
      </Button>
    )}
  </div>

  {/* Divider */}
  <div className="h-px bg-border" />

  {/* Filter Row */}
  <div className="flex flex-wrap items-center gap-1.5 px-3 py-2">
    {/* FilterDropdown chips go here — see step 3 */}

    <div className="flex-1" />

    {/* Active filters indicator + Clear — see step 4 */}
  </div>
</div>
```

Notes:
- Use the existing `Search` icon import (already in the file).
- Switch the search `<Input>` from shadcn's component to a raw `<input>` styled identically to leads. (Leads uses raw inputs in this surface, not the shadcn wrapper.)
- The search `w-60` is fixed-width — same as leads. Don't make it flex.
- The count line uses `contacts.length` (post-filter; matches leads' use of `filtered.length`).

### 3. Filter dropdowns — use `<FilterDropdown>` from `@/components/ui/filter-dropdown`

Today there are two raw shadcn `<Select>` filters (Account, Status; lines 112–134). Replace **both** with `<FilterDropdown>` components matching the leads pattern (leads-table.tsx:580–696). Keep the same filter state variables (`filterAccountId`, `filterStatus`) — only the UI changes.

Add the import (already a dependency, just not imported in this file yet):
```tsx
import { FilterDropdown } from "@/components/ui/filter-dropdown";
import { Building2 } from "lucide-react";
```

Replace the Account select:
```tsx
<FilterDropdown
  label="All Accounts"
  value={filterAccountId}
  onChange={(val) => setFilterAccountId(val)}
  icon={<Building2 className="h-3 w-3" />}
  options={[
    { value: "all", label: "All Accounts", description: "Show contacts at every account" },
    ...accounts.map((a) => ({
      value: a.id,
      label: a.name,
      description: `Contacts at ${a.name}`,
    })),
  ]}
/>
```

Replace the Status select:
```tsx
<FilterDropdown
  label="All Statuses"
  value={filterStatus}
  onChange={(val) => setFilterStatus(val as typeof filterStatus)}
  searchable={false}
  options={[
    { value: "active", label: "Active", description: "Active contacts only" },
    { value: "inactive", label: "Inactive", description: "Inactive contacts only" },
    { value: "all", label: "All Statuses", description: "Show every contact" },
  ]}
/>
```

The status default value stays `"active"` (not `"all"`) — preserve existing behavior. Just the UI changes.

Drop the unused shadcn Select imports (`Select`, `SelectContent`, `SelectItem`, `SelectTrigger`, `SelectValue`) — they'll no longer be referenced in this file. The `Input` import can also go (replaced by raw `<input>`).

### 4. Active filters badge + Clear button — mirror Leads exactly

Mirror leads-table.tsx:700–716. Add at the right side of the filter row (after the spacer):

```tsx
{hasActiveFilters && (
  <div className="flex items-center gap-1.5">
    <Badge variant="secondary" className="text-[11px] font-normal h-6 px-2">
      {activeFiltersCount} filter{activeFiltersCount !== 1 ? "s" : ""}
    </Badge>
    <Button
      variant="ghost"
      size="sm"
      onClick={clearFilters}
      className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
    >
      <X className="h-3 w-3 mr-1" />
      Clear
    </Button>
  </div>
)}
```

Add helpers above the JSX:
```tsx
const activeFiltersCount = [
  searchInput !== "",
  filterAccountId !== "all",
  filterStatus !== "active",  // "active" is the default — only count non-default
].filter(Boolean).length;
const hasActiveFilters = activeFiltersCount > 0;

function clearFilters() {
  setSearchInput("");
  setFilterAccountId("all");
  setFilterStatus("active");
}
```

Add imports:
```tsx
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";
```

### 5. Table card chrome — mirror Leads' card-wrapped table exactly

The current implementation (lines 158–211) uses `<div className="border rounded-xl overflow-hidden">` wrapping a bare `<table>` with `bg-muted/40 border-b` thead. Replace the entire `else` branch (the populated-contacts case) with the leads-style table card:

```tsx
{/* Table card */}
<div className="flex-1 min-h-0 bg-white rounded-lg border border-gray-200 flex flex-col overflow-hidden">
  <div className="flex-1 min-h-0 overflow-auto">
    <table className="w-full">
      <thead className="sticky top-0 z-10">
        <tr className="border-b border-gray-200 bg-gray-50">
          <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Name</th>
          <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Account</th>
          <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Email</th>
          <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Title</th>
          <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Status</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {contacts.map((contact) => (
          <tr key={contact.id} className="hover:bg-gray-50 transition-colors">
            <td className="px-3 py-1.5">
              <Link
                href={`/contacts/${contact.id}`}
                className="text-sm font-medium text-[#2272B4] hover:underline"
              >
                {fullName(contact)}
              </Link>
            </td>
            <td className="px-3 py-1.5 text-sm text-gray-500 font-light">
              {contact.accounts ? (
                <Link href={`/accounts/${contact.accounts.id}`} className="hover:underline">
                  {contact.accounts.name}
                </Link>
              ) : (
                <span className="text-gray-400">—</span>
              )}
            </td>
            <td className="px-3 py-1.5 text-sm text-gray-500 font-light">
              {contact.email ? (
                <a href={`mailto:${contact.email}`} className="hover:underline">
                  {contact.email}
                </a>
              ) : (
                <span className="text-gray-400">—</span>
              )}
            </td>
            <td className="px-3 py-1.5 text-sm text-gray-500 font-light">
              {contact.title ?? <span className="text-gray-400">—</span>}
            </td>
            <td className="px-3 py-1.5">
              <ContactStatusBadge status={contact.status as ContactStatus} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
</div>
```

Specific chrome details to copy verbatim from leads:
- Outer wrapper: `flex-1 min-h-0 bg-white rounded-lg border border-gray-200 flex flex-col overflow-hidden`.
- Scroll region: `flex-1 min-h-0 overflow-auto`.
- Thead: `sticky top-0 z-10` (no background on the thead itself).
- Header row: `border-b border-gray-200 bg-gray-50` (the `bg-gray-50` is on the **`<tr>`**, not the thead — this is intentional in leads).
- Header cells: `px-3 py-2 text-left text-xs font-medium text-gray-600` (NOT uppercase, NOT tracking-wide, NOT muted-foreground — match leads tone exactly).
- Body: `divide-y divide-gray-100`.
- Rows: `hover:bg-gray-50 transition-colors`.
- Cells: `px-3 py-1.5` padding; data cells use `text-sm text-gray-500 font-light` for muted columns, `text-sm font-medium text-[#2272B4]` for the Name link.
- Empty/missing values: `<span className="text-gray-400">—</span>` — leads' pattern for placeholders.

## What to LEAVE ALONE

- **Empty state block (lines 138–157 today)**: the polished `border rounded-xl p-12 text-center bg-background` with icon + h3 + CTA is BETTER than leads' bare `<td colSpan>` pattern. Keep contacts' empty state exactly as-is. Don't regress it to leads' inferior pattern.
- **Loading state (`<Loader2>`)**: keep as-is.
- **`ContactForm`** dialog at the bottom: keep as-is.
- **All useState / useEffect / fetch / handleCreated logic**: keep exactly as-is. UI-only change.
- **Status column position**: stays at column 5 (last). Don't reorder.
- **`fullName()` helper**: keep as-is.

## What about pagination?

Leads has pagination (per-page + ChevronLeft/Right). Contacts doesn't, and **don't add it in this branch**. Pagination is a feature add (state + UI + slicing), not chrome alignment. If volume of contacts grows, add it in a follow-up branch — but for now, the contacts table is short and visible-in-one-scroll for every IT agency tenant. Keep this branch tight.

## Verification matrix

Local, before pushing:

- [ ] `npm run build` clean.
- [ ] `npx eslint --max-warnings 50 .` clean.
- [ ] Visual on dev (after stage deploy) as `admin@zunkireelabs.com`:
  - H1 reads `Contacts` at the smaller text-lg size, no subtitle.
  - Toolbar card visible with count "X Contacts" on the left of the top row, search box `w-60` next to it, Add Contact button on the right.
  - Divider between top row and filter row is visible.
  - Filter row shows two `FilterDropdown` chips (Account with Building2 icon; Status with no icon, searchable=false). Default state: Account = "All Accounts", Status = "Active".
  - When you type in search OR change a filter from default, the active-filter badge "1 filter" / "2 filters" appears + Clear button (X icon) — clicking Clear resets all three.
  - Table card has `bg-white rounded-lg border border-gray-200` wrapper. Thead row is `bg-gray-50` with sticky behavior on scroll. Header text is `text-xs font-medium text-gray-600`, sentence-case (NOT uppercase, NOT tracking-wide).
  - Body rows hover to `bg-gray-50`. Name column is the `#2272B4` blue link. Empty cell values render `—` in `text-gray-400`.
  - Adding a contact via the dialog still works → row appears in the table.
- [ ] No regression for the empty-state branch — search for "zzznoresults" and confirm the existing polished empty card (Users icon + "No contacts found" + Try-adjusting / Add-your-first CTA) still renders unchanged.
- [ ] No regression for the loading branch — initial page load shows the centered spinner before contacts load.
- [ ] As a counselor / viewer (if any IT agency seed exists): Add Contact button hidden (existing `isAdmin` gate preserved).
- [ ] Education consultancy tenant (`admizzdotcom2020@gmail.com`): no change to that tenant's `/contacts` experience (this branch only touches the IT agency path).

## Code-review checklist (6 standing items)

All N/A — UI-only change, no DB / no API / no new page / no `<SelectItem value="">` / no PostgREST embed / no cross-cutting predicate.

## Handoff format

Sonnet pushes the branch when done and stops. Opus fetches, reviews diff, runs build + eslint, smokes the dev container after deploy, squash-merges to stage, deletes the branch. Doc updates by Opus.

---

## Handoff prompt (paste this to Sonnet)

```
You are implementing a UI styling change on a fresh feature branch in the Lead Gen CRM repo at /Users/sadinshrestha/Projects/edgeXcrm. Full instructions are in the brief at docs/CONTACTS-LIST-CHROME-BRIEF.md — read it end-to-end before writing any code, then follow it precisely.

This is className + JSX-structure-only work in ONE file: src/industries/it-agency/features/crm-contacts/pages/contacts-list.tsx. The goal is to make the IT agency /contacts list mirror the /leads dashboard chrome pattern exactly. The reference file is src/components/dashboard/leads-table.tsx (lines 478–998). Read it before editing contacts-list.tsx so you understand the toolbar card / FilterDropdown / table card patterns you're mirroring.

Workflow:

1. From the repo root, ensure you're on stage with the latest: git checkout stage && git pull origin stage && git checkout -b chore/contacts-list-chrome.
2. Read the brief, then read leads-table.tsx (esp. lines 478–718 and 759–998) and the existing contacts-list.tsx end-to-end.
3. Implement the 5 numbered changes in the brief in contacts-list.tsx ONLY:
   1. Page shell + H1 — drop p-6 and the subtitle, use the leads shell pattern.
   2. Toolbar card — two rows with divider, mirroring leads-table.tsx:483–718.
   3. FilterDropdown migration — replace both shadcn <Select> filters with <FilterDropdown> chips.
   4. Active filters badge + Clear button — mirror leads-table.tsx:700–716.
   5. Table card chrome — wrap the table in the leads-style card; replace thead bg-muted/40 with bg-gray-50 on the <tr>; rounded-xl → rounded-lg; header cells text-xs font-medium text-gray-600 (no uppercase).
4. LEAVE ALONE: the empty-state block (it's better than leads' empty state — don't regress it), the loading state, ContactForm, all state/fetch/effect logic, Status column position, fullName helper. The brief lists everything not to touch.
5. Do NOT add pagination. Do NOT touch any API/query/hook. Do NOT touch any other file. Do NOT touch /contacts/[id] or the education_consultancy ContactsPage path.
6. Drop unused imports after the swap (shadcn Select pieces, Input). Add new imports (FilterDropdown, Building2, Badge, X).
7. Run BOTH gates locally before pushing:
   - npm run build — must finish clean.
   - npx eslint --max-warnings 50 . — must finish clean. Don't skip; React 19 has bitten this codebase repeatedly.
8. Commit with a single descriptive message. Standard project style: subject line + short body. Do NOT include any Claude/Anthropic co-author trailer; the repo's commit-msg hook handles co-authoring.
9. Push: git push -u origin chore/contacts-list-chrome. DO NOT open a PR. DO NOT merge. Stop after the push.

Final summary should report: (1) the diff stat (files / insertions / deletions), (2) build + eslint exact tail output, (3) commit SHA + branch push confirmation, (4) anything you noticed that diverged from the brief or that I should know about during review — including any place where mirroring leads exactly looked wrong in context (judgment-over-adherence is welcome, just surface it).
```
