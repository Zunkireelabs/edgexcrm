# Design system: primary button → near-black, 8px radius, token-driven + darker table text

**Owner**: Opus (plan + review) → Sonnet (implement)
**Branch**: `chore/design-primary-button`
**Base**: `stage` (currently `0d47bf3`)
**Scope**: Global design tokens + Button component + table data cell text in the two tables that use the muted-light pattern. Education_consultancy is unaffected (no education-specific touch). Production-safe — no DB, API, or business logic.

## Why

Today's primary button is `bg-[#2272B4]` (Zunkireelabs blue) hardcoded in `button.tsx`, with 4px corners (`rounded`). The brand is moving to a calmer near-black primary (matches the chrome restyle and the `#fafafa` outer / white inset card aesthetic). At the same time we're consolidating the hardcoded hex into the CSS-variable token so future color changes are one-edit in `globals.css`.

The table data-cell text (`text-gray-500 font-light`) reads as placeholder-grey against the new white inset card. Bumping to `text-gray-700 font-normal` makes data confident without going all the way to near-black body text.

Reference image Sadin provided (Anthropic-style "+ New blank project" button): near-black `bg-foreground` with `border-radius: 10px`. We're matching the near-black tone and going slightly tighter at 8px to harmonize with the outer chrome card's 8px corners.

## Files to change

Exactly four:
1. `src/app/globals.css`
2. `src/components/ui/button.tsx`
3. `src/components/dashboard/leads-table.tsx`
4. `src/industries/it-agency/features/crm-contacts/pages/contacts-list.tsx`

No other files. **Do NOT touch** `filter-dropdown.tsx` or `pipeline-selector.tsx` (they also hardcode `#2272B4` but for active-state styling — separate concern, follow-up branch). Do NOT touch `--sidebar-primary`, `--ring`, or any sidebar tokens.

## The 4 changes

### 1. `globals.css` — flip the `--primary` token + delete the dead `--primary-hover`

Today (lines 60–62):
```css
  /* Primary: Zunkireelabs blue #2272B4 */
  --primary: #2272B4;
  --primary-foreground: #ffffff;
  --primary-hover: #0E538B;
```

Replace with:
```css
  /* Primary: near-black for actions (matches --foreground tone) */
  --primary: #171717;
  --primary-foreground: #ffffff;
```

- Drop `--primary-hover` — it's referenced nowhere in the codebase (verified by grep). The button uses `bg-primary/90` for hover instead of a separate token, matching shadcn's idiom.
- Update the comment above the token to reflect the new semantics ("near-black for actions" vs the old "Zunkireelabs blue" comment).
- Leave the surrounding `:root` block otherwise unchanged — `--accent`, `--ring`, `--chart-1`, sidebar tokens stay as-is for this branch. They're separate consolidations.
- Leave the `.dark` block unchanged. Dark mode tokens are a separate concern (and dark mode isn't on right now).

### 2. `button.tsx` — switch default variant to tokens + bump all sizes to `rounded-lg` (8px)

Today (button.tsx:7–39):
```ts
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-blue-100 focus-visible:border-blue-400",
  {
    variants: {
      variant: {
        default: "bg-[#2272B4] text-white shadow-sm hover:bg-[#0E538B]",
        destructive: ...
        outline: "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50",
        secondary: "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50",
        ghost: "hover:bg-gray-100 hover:text-gray-900",
        link: "text-[#2272B4] underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        xs: "h-6 gap-1 rounded px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 rounded gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-xs": "size-6 rounded [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    ...
  }
)
```

Make exactly two edits:

**Edit A — base class string + default variant**: replace `rounded` (4px Tailwind default) with `rounded-lg` (8px), and switch the default variant to token-driven:

- Base string: `... whitespace-nowrap rounded text-sm font-medium ...` → `... whitespace-nowrap rounded-lg text-sm font-medium ...`
- `default` variant: `"bg-[#2272B4] text-white shadow-sm hover:bg-[#0E538B]"` → `"bg-primary text-primary-foreground shadow-sm hover:bg-primary/90"`

**Edit B — size variants with `rounded`**: each `size` variant that explicitly re-sets `rounded` to 4px needs the same bump:

- `xs`: `"h-6 gap-1 rounded px-2 ..."` → `"h-6 gap-1 rounded-lg px-2 ..."`
- `sm`: `"h-8 rounded gap-1.5 px-3 ..."` → `"h-8 rounded-lg gap-1.5 px-3 ..."`
- `lg`: `"h-10 rounded px-6 ..."` → `"h-10 rounded-lg px-6 ..."`
- `icon-xs`: `"size-6 rounded [&_svg:not([class*='size-'])]:size-3"` → `"size-6 rounded-lg [&_svg:not([class*='size-'])]:size-3"`
- `default`, `icon`, `icon-sm`, `icon-lg` — these don't set `rounded` directly, they inherit from the base string. The base-string edit (Edit A) covers them.

**Leave alone** in `button.tsx`:
- `destructive` variant — already uses tokens (`bg-destructive`, `focus-visible:ring-destructive/20`). No change.
- `outline` variant — Sadin specifically said "keep the secondary as it is". Verbatim leave the class string `"border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"`.
- `secondary` variant — same as outline today, also leave alone. (It's a pre-existing duplication worth cleaning up later, but out of scope here.)
- `ghost` variant — neutral hover, no brand color, no change.
- **`link` variant** — keeps `text-[#2272B4]` HARDCODED (do not change to `text-primary`). Rationale: links keep the blue link-convention color even though primary buttons turn black. Links are navigation affordances, buttons are action affordances; they're allowed to differ. Future consolidation can add a separate `--link` token; out of scope here.
- `focus-visible:ring-blue-100 focus-visible:border-blue-400` — focus ring stays the same blue tone. Out of scope to retune; pairs fine against the new near-black button.

### 3. `leads-table.tsx` — bump data-cell text from `text-gray-500 font-light` → `text-gray-700 font-normal`

Four occurrences, all in data cells (not header cells, not status badges, not the name link). Search the file for `text-sm text-gray-500 font-light` — should match exactly 4 `<td>` lines:

- Line ~878: Email cell
- Line ~881: Location cell (city)
- Line ~884: Assigned cell (counselor email prefix)
- Line ~930: Date cell

For each, replace `text-sm text-gray-500 font-light` → `text-sm text-gray-700 font-normal`.

Leave alone:
- Header cells (`text-xs font-medium text-gray-600`) — already calibrated.
- Status badges (own color scheme).
- Name link `text-[#2272B4]` — stays blue.
- Em-dash placeholders `<span className="text-gray-400">—</span>` — stays gray-400.
- Avatar circle styling.
- Any row with `text-gray-700` already — no double-edit.

### 4. `contacts-list.tsx` — same data-cell text bump, three occurrences

Search the file for `text-sm text-gray-500 font-light`. Should match exactly 3 `<td>` lines (Account, Email, Title). Replace each `text-sm text-gray-500 font-light` → `text-sm text-gray-700 font-normal`.

Leave alone: header cells, status badge, name link (`text-[#2272B4]`), em-dash placeholders, avatar styling.

## What NOT to change

- `filter-dropdown.tsx` — has 3 hardcoded `#2272B4` references for active state. Out of scope.
- `pipeline-selector.tsx` — has 4 hardcoded `#2272B4` references. Out of scope.
- `--ring`, `--sidebar-primary`, `--sidebar-ring`, `--accent`, `--chart-1` — these still reference blue; they're a separate cleanup branch when we decide whether focus rings + sidebar accents should also retune.
- Tenant `primary_color` field in DB — separate decision about whether to make brand color per-tenant. Out of scope.
- The `.dark` color block in `globals.css` — leave the dark-mode primary at `#3b82f6` (existing value). Dark mode isn't deployed.
- Education_consultancy code paths.
- All non-button shadcn UI primitives (`Badge`, `Card`, `Dialog`, `Select`, `Tabs`, etc.) — they read from tokens already; changing `--primary` flows to whatever they use. Don't touch their files.
- Add-Lead button text / label / icon — only the color and radius change.

## Edge cases to think about

- **Pre-existing duplicates of `outline` and `secondary`**: identical class strings today. Leaving alone per Sadin's "keep secondary as is" instruction. Don't dedupe in this branch.
- **`rounded` in `xs`/`sm`/`lg`/`icon-xs` size variants**: today they explicitly re-set `rounded` (4px), which would have OVERRIDDEN any `rounded-lg` set on the base. That's why Edit B is necessary — without it, only `default` + `icon` + `icon-sm` + `icon-lg` would get the 8px bump.
- **Buttons used elsewhere with custom `className` overrides**: e.g. `className="h-9 gap-2"` (no rounded override). These will inherit `rounded-lg` from the base. Good. If any caller adds `rounded-md` or `rounded` in their className, they keep their override — that's correct Tailwind precedence.
- **Sign-out button + tenant dropdown** in `shell.tsx` — they use raw `<button>` elements with their own class strings, NOT the Button component. They will NOT be affected by this change. That's fine and correct.

## Verification matrix

Local before pushing:

- [ ] `npm run build` clean.
- [ ] `npx eslint --max-warnings 50 .` clean.
- [ ] Visually as `admin@zunkireelabs.com` on dev (after stage deploy):
  - Primary buttons (`Add Lead` on `/leads`, `Add Contact` on `/contacts`) render with near-black `#171717` fill, white text, and 8px corners. Hover slightly lightens (90% opacity).
  - Outline buttons (`Sort` and `Export` on `/leads`, `Sort` on `/contacts`) UNCHANGED — still white bg + gray border + gray-700 text + 8px corners (new from the base change; this is the only intended change to outline). Confirm visually that this still feels right with Sadin; if outline buttons look wrong at 8px, flag and we'll iterate.
  - Destructive buttons in confirm dialogs (Delete confirmation on `/leads` bulk-delete) render at 8px corners. No color change.
  - Link variant (any Button with `variant="link"` — sparse usage in the app) stays blue text + underline.
  - Table data cells on `/leads` and `/contacts` render at `text-gray-700` (visibly darker than before) with normal weight (not the previous thin weight). Em-dash placeholders stay light gray (gray-400) — the contrast between dash and real value is now sharper.
  - Header cells on tables unchanged (`text-gray-600 font-medium`).
  - Status badges + ContactStatusBadge unchanged in color.
  - Name links in tables stay blue (`text-[#2272B4]`).
- [ ] As education_consultancy (`admizzdotcom2020@gmail.com`): no visual regression on `/leads`, `/check-in`, `/forms`, `/contacts` (which renders the ProspectsView, untouched by this branch).
- [ ] Focus ring on primary buttons: tab to a primary button, confirm the focus ring renders (it stays `ring-blue-100 border-blue-400` — that's intentional for now).
- [ ] Loading spinners, ContactForm dialog, ProjectPicker dialog buttons — confirm Cancel (outline) and Submit (primary near-black) both render correctly.

## Code-review checklist (6 standing items)

All N/A — pure styling change, no DB / no API / no new page / no `<SelectItem value="">` / no PostgREST embed / no cross-cutting predicate filter.

## Handoff format

Sonnet pushes the branch when done and stops. Opus fetches, reviews diff, runs gates, squash-merges to stage. Sadin smokes on dev before any prod promotion.

---

## Handoff prompt (paste to Sonnet)

```
You are implementing a design-system change on a fresh feature branch in the Lead Gen CRM repo at /Users/sadinshrestha/Projects/edgeXcrm. Full instructions are in the brief at docs/DESIGN-PRIMARY-BUTTON-BRIEF.md — read it end-to-end before writing any code, then follow it precisely.

This is a tightly-scoped styling change across EXACTLY four files:
1. src/app/globals.css
2. src/components/ui/button.tsx
3. src/components/dashboard/leads-table.tsx
4. src/industries/it-agency/features/crm-contacts/pages/contacts-list.tsx

The goal: switch the primary button color from #2272B4 (Zunkireelabs blue) to #171717 (near-black) via the --primary CSS variable, bump all button sizes from `rounded` (4px) to `rounded-lg` (8px), and bump table data-cell text from text-gray-500 font-light to text-gray-700 font-normal in the two tables that use that pattern.

Workflow:

1. From the repo root, ensure you're on stage with the latest: git checkout stage && git pull origin stage && git checkout -b chore/design-primary-button.
2. Read the brief, then read the current state of each of the 4 files above so you understand what's there.
3. Implement the 4 changes in the brief in order:
   1. globals.css — change --primary from #2272B4 to #171717, drop the unused --primary-hover line, update the comment above --primary.
   2. button.tsx — base string `rounded` → `rounded-lg`; default variant from hardcoded hex to bg-primary text-primary-foreground hover:bg-primary/90; size variants xs/sm/lg/icon-xs each have `rounded` → `rounded-lg`.
   3. leads-table.tsx — find all 4 occurrences of `text-sm text-gray-500 font-light` and change to `text-sm text-gray-700 font-normal`.
   4. contacts-list.tsx — find all 3 occurrences of `text-sm text-gray-500 font-light` and change to `text-sm text-gray-700 font-normal`.
4. LEAVE ALONE per the brief: filter-dropdown.tsx, pipeline-selector.tsx, link variant of Button (text-[#2272B4] stays blue), all sidebar / ring / accent / chart CSS variables, the .dark color block, the destructive/outline/secondary/ghost button variants (only `rounded` → `rounded-lg` if they have it; no color changes), Status badges, name links in tables, em-dash placeholders, header cells, header text color.
5. Use grep to confirm the exact occurrence counts before editing: leads-table.tsx should have 4 instances of `text-sm text-gray-500 font-light`, contacts-list.tsx should have 3. If the counts don't match, STOP and report — don't edit a different file.
6. Run BOTH gates locally before pushing:
   - npm run build — must finish clean.
   - npx eslint --max-warnings 50 . — must finish clean.
7. Commit with a single descriptive message. Standard project style. Do NOT include any Claude/Anthropic co-author trailer; the repo's commit-msg hook handles co-authoring.
8. Push: git push -u origin chore/design-primary-button. DO NOT open a PR. DO NOT merge. Stop after the push.

Final summary should report: (1) the diff stat (files / insertions / deletions), (2) build + eslint exact tail output, (3) commit SHA + branch push confirmation, (4) anything you noticed — especially: did the grep counts match (4 in leads-table, 3 in contacts-list)? Did you find any other place where Button's default variant color was hardcoded outside button.tsx (e.g. someone reproducing `bg-[#2272B4]` on a raw <button>)? Did the `rounded` token appear in any unexpected places? Judgment-over-adherence is welcome — surface anything that looks wrong to you about the brief.
```
