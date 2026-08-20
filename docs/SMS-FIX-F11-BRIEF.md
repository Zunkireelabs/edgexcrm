# SMS Fix F-11: Blast Audience filter picker has no option lists

## Found by

Sadin, prod, 2026-08-19, right after the F-10 promotion + Admizz entitlement/env grant went
live. Opened `/sms` → New Blast → Audience → Add filter → Form → search → **"No results found"**.
Admizz prod has 10 `form_configs` rows and 16,972 active leads — this is not an empty-data state,
it's a picker bug.

## Root cause

`src/industries/_shared/features/sms/ui/blast-composer.tsx:142` renders:

```tsx
<AdvancedFilterBar entity="leads" fields={fields} value={tree} onChange={setTree} allowGroups={false} />
```

No `optionOverrides` prop. `AdvancedFilterBar` → `useFilterOptions(optionOverrides)`
(`src/components/filters/use-filter-options.ts:27-34`):

```ts
const getOptions = useCallback((field: FieldDef): FilterOption[] => {
  if (field.options && field.options.length > 0) return field.options;
  return optionOverrides?.[field.key] ?? [];
}, [optionOverrides]);
```

`fields` comes straight from `leadFields()` (`src/lib/filters/registry/leads.ts`) — the shared
field registry, same one `leads-table.tsx` uses. None of `form`, `source`, `assignees`,
`collaborators`, `status` carry a static `field.options` array on that registry (by design — see
the comment atop `use-filter-options.ts`: "every list a host needs it supplies via
`optionOverrides`"). `industry` and `tags` are the only two that *could* be trivially static.

`leads-table.tsx` is the **only** existing consumer, and it computes
`advancedFilterOptionOverrides` itself (`leads-table.tsx:1995-2027`) from data it already has
loaded on that page (loaded leads, a `formMap` prop, a team-members fetch, a dedicated facets
fetch). `blast-composer.tsx` has none of that loaded — it's a from-scratch page — and never
built the equivalent. Every dynamic filter field on the Audience picker silently renders "No
results found," not just Form.

## Fix

Give `blast-composer.tsx` its own `optionOverrides`, reusing existing endpoints/constants —
**no new endpoint needed**, everything below already exists:

1. **`form`** — `GET /api/v1/form-configs` (existing, used by the form-builder feature) returns
   the tenant's forms. Map to `{ value: id, label: name }`.
2. **`source`** and **`assignees`** — reuse the existing facets endpoint, same one
   `leads-table.tsx` calls at line ~715: `GET /api/v1/leads?facets=source,assignee`. Response
   shape: `{ data: { facets: { source: { options: [{name,count}] }, assignee: { options: [...] } } } }`
   (see `leads-table.tsx:715-736` for the exact parse). Map `name` → `value`/`label` (counts are
   optional polish, not required for this fix).
3. **`collaborators`** — same team-members source `leads-table.tsx` uses for its `assignees`/
   `collaborators` overrides (`counselors` state, filtered by role in `leads-table.tsx:2016-2021`).
   Find where that page fetches team members and reuse the same call in `blast-composer.tsx`; if
   it's page-local state built from a prop passed down from `leads/page.tsx`, add a small client
   fetch to whatever endpoint back-fills that (check `src/app/(main)/(dashboard)/leads/page.tsx`
   for the server-side query this mirrors client-side, or find the existing team/members API route
   under `api/v1/team*`).
4. **`industry`** — static, already importable: `PROSPECT_INDUSTRIES` constant (used at
   `leads-table.tsx:2023`). No fetch needed.
5. **`tags`** — match `leads-table.tsx:2022` exactly for consistency: `[{ value: "student", label:
   "Student" }]`. (Yes, that's genuinely all `leads-table.tsx` offers today — not a scope
   expansion for this fix.)
6. **`status`** — `blast-composer.tsx` isn't list/pipeline-scoped, so use the same "no active
   pipeline" fallback list `leads-table.tsx:1026-1033` returns: `all / new / partial / contacted /
   enrolled / rejected`. Do not attempt to wire per-pipeline stages into this fix — out of scope,
   the Audience picker targets leads tenant-wide, not one list.

Wire the result into the existing call:

```tsx
<AdvancedFilterBar entity="leads" fields={fields} value={tree} onChange={setTree} allowGroups={false} optionOverrides={audienceOptionOverrides} />
```

## Scope guard

Don't touch `leads-table.tsx`, `advanced-filter-bar.tsx`, `use-filter-options.ts`, or the field
registry (`leads.ts`) — this is additive, blast-composer-only. Don't add a new API route; every
data source above already exists. Don't attempt count-annotated labels ("Form (42 leads)") — plain
`{value, label}` pairs match what the picker needs; count polish is a separate ask if wanted later.

## Verification (no browser extension available — same method as F-8/F-9/F-10)

1. `npx tsc --noEmit` clean.
2. `npm run test` green, no new warnings from `npx eslint --max-warnings 50`.
3. Real session cookie against local dev (`admin@admizz.local` / `edgexdev123`, local Supabase):
   open a blast composer, add each of Form / Source / Assigned to / Collaborators / Status /
   Prospect industry / Tags as a filter, confirm each picker lists real options (not "No results
   found") — check via `get_page_text`-equivalent HTML assertion or a component-level test that
   renders `AdvancedFilterBar` with the real `optionOverrides` object and asserts non-empty
   `getOptions()` output per field key. A committed test (e.g.
   `blast-composer.audience-options.test.tsx`) asserting all six keys resolve to non-empty arrays
   given realistic fixture data is the durable regression guard here — prefer that over a one-off
   manual check, since this bug survived to prod once already.
4. Confirm `npm run build` still clean.

Report back commit + CI status. Do not merge without Opus review, same as F-8/F-9/F-10.
