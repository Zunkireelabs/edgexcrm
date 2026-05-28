# Design system: table text hierarchy — primary name → #0f0f10, secondary text → #787871

**Owner**: Opus (plan + review) → Sonnet (implement)
**Branch**: `chore/design-text-hierarchy`
**Base**: `stage` (currently `f3ad73d`)
**Scope**: Name links + secondary data cells in the two CRM tables that share a chrome (`/leads` and `/contacts`). Token consolidation is out-of-scope; we hardcode the two colors in 2 files. No DB, API, or business logic.

## Why

The previous design branch (`f3ad73d`) bumped table data cells from `text-gray-500 font-light` (placeholder-y) to `text-gray-700 font-normal` (confident). Sadin's reviewing the result on dev and wants a refined hierarchy:

- **Primary text** (the Name link — the row's main identifier) → `#0f0f10` (very near-black, darker even than `--foreground` at `#171717`). Drops the `text-[#2272B4]` blue link convention for names; the underline-on-hover stays as the clickable affordance.
- **Secondary text** (Email, Location, Assigned, Date, Account, Title — everything not Name or Status) → `#787871` (a warm-muted gray; slightly lighter and warmer than the cool `text-gray-700` we just shipped).

Net visual effect: names "pop" as the row's primary identifier; data recedes calmly. Standard CRM hierarchy.

Reference: Sadin's screenshot (Screenshot 2026-05-28 at 15.31.40.png) annotating Name = primary, Email = secondary.

## Files to change

Exactly two:
1. `src/components/dashboard/leads-table.tsx`
2. `src/industries/it-agency/features/crm-contacts/pages/contacts-list.tsx`

No other files. No new tokens, no globals.css edit, no Button changes.

## The 2 changes per file (4 total)

### 1. `leads-table.tsx` — Name link color (1 occurrence)

Today (around line 830):
```tsx
className="text-sm font-medium text-[#2272B4] hover:underline block pr-0 group-hover/name:pr-[72px] transition-[padding] duration-100"
```

Change ONLY the color: `text-[#2272B4]` → `text-[#0f0f10]`.

Result:
```tsx
className="text-sm font-medium text-[#0f0f10] hover:underline block pr-0 group-hover/name:pr-[72px] transition-[padding] duration-100"
```

Keep `hover:underline` — that's the new clickable affordance now that the link is no longer blue. Keep `font-medium`, keep all the group-hover Preview-button layout classes.

### 2. `leads-table.tsx` — Data cells (4 occurrences)

Search for `text-sm text-gray-700 font-normal` — should match exactly 4 `<td>` lines (Email, Location, Assigned, Date) that were just updated in the prior design branch.

For each, replace `text-sm text-gray-700 font-normal` → `text-sm font-normal text-[#787871]`.

Keep the surrounding classes (`px-3 py-1.5 hidden md:table-cell` etc.) untouched.

### 3. `contacts-list.tsx` — Name link color (1 occurrence)

Today (around line 341):
```tsx
className="text-sm font-medium text-[#2272B4] hover:underline"
```

Change to:
```tsx
className="text-sm font-medium text-[#0f0f10] hover:underline"
```

### 4. `contacts-list.tsx` — Data cells (3 occurrences)

Search for `text-sm text-gray-700 font-normal` — should match exactly 3 `<td>` lines (Account, Email, Title).

For each, replace `text-sm text-gray-700 font-normal` → `text-sm font-normal text-[#787871]`.

## What to LEAVE ALONE

- **Status column** (`ContactStatusBadge` in contacts; the inline stage/status badge in leads) — own color scheme, untouched.
- **Em-dash placeholders** `<span className="text-gray-400">—</span>` — stay gray-400. Lighter than #787871 so the dash visibly differs from missing-data secondary text. Good contrast.
- **Header cells** (`text-xs font-medium text-gray-600`) — calibrated; leave alone.
- **Avatar initials circle** styling (`text-gray-500`, `border-gray-300`, `bg-gray-100`) — unchanged.
- **Source badge / tag pills / Type/Tag toggles** in leads-table.tsx (the rendered badge styles for sources, the Lead/Prospect + Student/Parent toggles) — own color schemes.
- **Pagination footer text** (`text-xs text-gray-500` / `text-gray-600`) — pagination chrome, unrelated.
- **Mobile email line in leads** (`text-xs text-gray-500`) — mobile-only fallback rendering; leaving until we do a separate mobile pass.
- **`button.tsx`** — out of scope.
- **`filter-dropdown.tsx` / `pipeline-selector.tsx`** — out of scope (still using #2272B4 hardcoded for active state; tracked as a future consolidation).
- **The third-party education_consultancy `ProspectsView`** at `src/industries/education-consultancy/features/contacts/ui.tsx` — different feature, different industry, untouched.

## Why hardcode instead of adding tokens

A clean version of this would add `--text-primary: #0f0f10` and `--text-muted: #787871` design tokens to `globals.css`, with components reading via `text-text-primary` / `text-text-muted` utilities. Two problems with doing that here:

1. Tailwind v4's auto-utility generation produces awkward names — `--text-primary` becomes `text-text-primary`. The clean fix is to use a non-`text-`-prefixed token like `--ink` and `--ink-muted`, but that's a naming convention to design separately.
2. We have only 9 instances across 2 files. The cost of hardcoding (a future grep-and-replace if we change the values) is small. The cost of designing a new token namespace right now is bigger.

We'll consolidate into a proper `--ink` / `--ink-muted` (or similar) token pair in a dedicated design-tokens branch once we've seen the colors hold up across more surfaces.

## Verification matrix

Local before pushing:

- [ ] `npm run build` clean.
- [ ] `npx eslint --max-warnings 50 .` clean.
- [ ] Visually on dev as `admin@zunkireelabs.com`:
  - `/leads`: Name column shows names in near-black (`#0f0f10`) at medium weight. They're no longer blue. Hover still shows the underline + Preview button appears.
  - `/leads`: Email, Location, Assigned, Date columns render in warm-muted gray (`#787871`) at normal weight.
  - `/contacts`: Name links render near-black (`#0f0f10`) medium weight. Hover underlines.
  - `/contacts`: Account, Email, Title columns render warm-muted gray (`#787871`) normal weight.
  - Em-dash placeholders still render `text-gray-400` — visibly lighter than the new secondary text. Good.
  - Status badges unchanged.
  - Header text unchanged.
  - Pagination footer unchanged.
- [ ] Compare side-by-side with Sadin's reference (Screenshot 2026-05-28 at 15.31.40.png): visual hierarchy should match — names dark and confident, data calmer and warm-muted.
- [ ] Education_consultancy tenant unaffected on `/leads`. (Their `/contacts` uses ProspectsView, not the IT-agency contacts-list.tsx — untouched by this branch.)

## Edge cases

- **Names with no first/last name**: existing code renders `{lead.first_name || ""} {lead.last_name || ""}.trim() || "—"`. The `—` placeholder will now render at `text-[#0f0f10]` (very dark). Slightly heavier than the gray-400 em-dash convention elsewhere, but only fires when a contact/lead has neither name — rare. Acceptable.
- **Truncated text helper**: `<TruncatedText>` wraps the visible content; color is on the parent. No change needed there.
- **Counselor email split fallback** (`assignedEmail.split("@")[0]` in leads) — same `text-[#787871]` applies. The `—` fallback wrapped in `text-gray-400` stays gray-400.

## Code-review checklist (6 standing items)

All N/A — pure styling change, no DB / no API / no new page / no `<SelectItem value="">` / no PostgREST embed / no cross-cutting predicate.

## Handoff format

Sonnet pushes the branch when done and stops. Opus fetches, reviews diff, runs gates, squash-merges to stage. Sadin smokes on dev before any prod push.

---

## Handoff prompt (paste to Sonnet)

```
You are implementing a small text-hierarchy styling change on a fresh feature branch in the Lead Gen CRM repo at /Users/sadinshrestha/Projects/edgeXcrm. Full instructions are in the brief at docs/DESIGN-TEXT-HIERARCHY-BRIEF.md — read it end-to-end before writing any code, then follow it precisely.

This is a tightly-scoped color refinement across EXACTLY two files:
1. src/components/dashboard/leads-table.tsx
2. src/industries/it-agency/features/crm-contacts/pages/contacts-list.tsx

The goal: switch the Name-column link color in both tables from text-[#2272B4] (blue) to text-[#0f0f10] (near-black, very dark), and switch the secondary data-cell text (which was JUST changed in the previous branch from text-gray-500 font-light to text-gray-700 font-normal) to text-[#787871] font-normal (warm-muted gray). Net effect is a clearer visual hierarchy: names pop dark and confident; data recedes warm and calm.

Important context: the previous design branch (f3ad73d, already on stage) JUST changed text-gray-500 font-light → text-gray-700 font-normal in these same cells. This brief overrides that gray-700 with #787871 — that's intentional (refinement, not regression). Don't second-guess the brief on this point.

Workflow:

1. From the repo root: git checkout stage && git pull origin stage && git checkout -b chore/design-text-hierarchy.
2. Read the brief, then read the two target files end-to-end so you know which lines you're touching.
3. Implement the 4 changes (2 per file):
   - leads-table.tsx: (a) Name link color text-[#2272B4] → text-[#0f0f10] (keep all other classes on that Link, especially the group-hover Preview-button layout classes); (b) all 4 data cells where you find `text-sm text-gray-700 font-normal` → `text-sm font-normal text-[#787871]`.
   - contacts-list.tsx: (a) Name link color text-[#2272B4] → text-[#0f0f10]; (b) all 3 data cells where you find `text-sm text-gray-700 font-normal` → `text-sm font-normal text-[#787871]`.
4. Before editing, grep each file to confirm the occurrence counts:
   - leads-table.tsx: 1 instance of `text-[#2272B4]` (the Name link) AND 4 instances of `text-sm text-gray-700 font-normal`.
   - contacts-list.tsx: 1 instance of `text-[#2272B4]` AND 3 instances of `text-sm text-gray-700 font-normal`.
   If counts don't match, STOP and report — don't guess.
5. LEAVE ALONE per the brief: header cells, status badges, ContactStatusBadge, em-dash placeholders (text-gray-400 stays), avatar circle, pagination footer, source/tag pills, button.tsx, filter-dropdown.tsx, pipeline-selector.tsx, the .dark color block, education_consultancy ProspectsView.
6. Run BOTH gates locally before pushing:
   - npm run build — must finish clean.
   - npx eslint --max-warnings 50 . — must finish clean.
7. Commit with a single descriptive message. Standard project style. Do NOT include any Claude/Anthropic co-author trailer; the repo's commit-msg hook handles co-authoring.
8. Push: git push -u origin chore/design-text-hierarchy. DO NOT open a PR. DO NOT merge. Stop after the push.

Final summary should report: (1) the diff stat (files / insertions / deletions), (2) build + eslint exact tail output, (3) commit SHA + branch push confirmation, (4) anything you noticed — especially: did the grep counts match? Did you find any other text-[#2272B4] in these two files that wasn't a name link (e.g., for emphasis text, or accidentally on a secondary cell)? Did any text-gray-700 font-normal appear OUTSIDE data cells (e.g., on the toolbar)? If you find a mismatch with the brief's assumptions, flag it rather than working around it.
```
