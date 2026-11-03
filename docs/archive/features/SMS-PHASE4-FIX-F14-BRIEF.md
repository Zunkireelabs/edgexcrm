# Fix F-14 — "Search" filter field defaults to exact match, not substring

## Status: NOT STARTED. Found live during F-13 manual verification (Opus, 2026-08-20), reproduced
## and root-caused directly against the running endpoint before writing this brief.

## Same branch, same batch

Continue on `fix/sms-f12-audience-count` (F-11 + F-12 + F-13 are already there). Same "no push
yet" instruction as F-13 — Sadin wants everything in this batch finished and verified together
before anything goes to stage. Do not open a PR.

## The bug

Sadin typed "gaurav" into the SMS blast composer's Audience → Add filter → **Search (name,
email, phone, ID)** field and got "No leads match this filter." — even though "Gaurav Dahal" is
a real lead, confirmed present via `/leads`.

Root cause, confirmed directly (not guessed) by hitting the live `/audience-count` endpoint with
both operators:
```
{op: "is", field: "search", value: "gaurav"}       -> matched: 0   (what actually ran)
{op: "contains", field: "search", value: "gaurav"} -> matched: 1   (what the user meant)
```

`defaultOperatorForField()` (`src/components/filters/condition-defaults.ts:17-26`) picks
`operators[0]` as the default operator whenever a field is freshly added. For `type: "text"`
fields the operator order is `["is", "is_not", "is_empty", "is_not_empty", "contains",
"not_contains", "starts_with", "ends_with"]` (`src/lib/filters/operators.ts:9`) — so a brand-new
Search condition silently defaults to **exact match** against the compiled multi-column search
(first_name/last_name/email/phone/display_id — see `src/lib/filters/registry/leads.ts`'s
`search` field def), not substring. Nobody types the literal full stored string when using a
free-text search box — this is a near-100%-of-the-time wrong default.

This is a **pre-existing bug in the shared filter system**, not something F-11/F-12/F-13
introduced — it would hit `leads-table.tsx` identically if a user picked "Search" via its own
"+ Add filter" instead of that page's separate dedicated quick-search input (which is why nobody
noticed until the SMS composer's new live-count feedback from F-12 made the silent failure
visible for the first time).

## The fix

Mirror the existing date-field special-case in the same function — same pattern, same file:

```ts
export function defaultOperatorForField(field: FieldDef): FilterOperator {
  const operators = operatorsForField(field);
  // OPERATORS_BY_TYPE.date lists "is_empty"/"is_not_empty" first ... (existing comment, unchanged)
  if (field.type === "date" && operators.includes("on")) return "on";
  // A free-text multi-column search field is never meaningfully "is"-matched —
  // nobody types the literal stored string. Default to substring (F-14:
  // SMS-PHASE4-FIX-F14-BRIEF.md), same reasoning as the date case above.
  if (field.key === "search" && operators.includes("contains")) return "contains";
  return operators[0];
}
```

**Scope this to `field.key === "search"` specifically, not `field.type === "text"` generally.**
Other text-type fields (city, country, etc.) reasonably keep exact-match as their default —
only the dedicated free-text "Search (name, email, phone, ID)" field has this problem. Do not
change the default for any other field. Do not touch `operators.ts`'s operator ordering itself
(that ordering is presumably relied on elsewhere, e.g. which operator shows first in the
dropdown) — only which one is pre-selected when a field is freshly added.

## Scope guard

One function, one file (`condition-defaults.ts`). Nothing else changes. This is a strict subset
of the surface already touched by F-13 — no new files.

## Regression test

Add a test (new or extend an existing `condition-defaults.test.ts` if one exists — check first)
asserting `defaultOperatorForField({ key: "search", type: "text", ... })` returns `"contains"`,
and that a representative *other* text field (e.g. `city`) still returns `"is"` — proving the
fix is scoped to `search` only, not all text fields.

## Before reporting back

- `npx tsc --noEmit` clean
- `npm run test` green, new test present
- Manually reload the blast composer in local dev: Add filter → Search → type "gaurav" **without
  touching the operator dropdown** → confirm it now shows a live match (not "No leads match this
  filter.") for a lead whose name contains but doesn't equal "gaurav"
- Also spot-check `/leads` → Add filter → Search (not the quick-search box) → same field →
  confirm it now defaults to substring there too, and that picking City/Country still defaults
  to "is" as before (unaffected)
