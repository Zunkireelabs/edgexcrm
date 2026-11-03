# SMS Fix F-11 — Blast Audience filter picker had no option lists

## Status: PR #410 open, CI green, NOT YET MERGED — ADDENDUM BELOW, fix before merging

## Original bug (already fixed correctly in PR #410 — no changes needed to this part)

`blast-composer.tsx` rendered `<AdvancedFilterBar ... />` with no `optionOverrides`. Every
enumerable Audience field with no static `field.options` on the shared `leadFields()` registry
silently showed "No results found." Fixed via `buildAudienceOptionOverrides()` covering
`form`, `source`, `assignees`, `collaborators`, `status`, `industry`, `tags`.

## ADDENDUM (found 2026-08-20, Sadin screenshotted it live in local dev after pulling stage)

A **7th field has the identical bug and is NOT covered by PR #410**: `stage` (the "Stage"
filter, `key: "stage"`, `source.column: "list_id"` — `src/lib/filters/registry/leads.ts:132-142`).
It has no static `options` array either, so it hits the same `optionOverrides?.[key] ?? []`
fallback in `use-filter-options.ts`.

**Why F-11's original brief missed it**: this field was added by PR #405 ("Stage filter
(list_id)"), which merged to `stage` in the same window as the F-11 brief was written — the
brief predates it. Not an oversight in the fix itself, a timing gap. Sadin caught it by
screenshotting the actual blast composer in local dev after pulling latest stage — same
"open the UI" discipline that caught F-8/F-9/F-10 on prod.

### Fix

Add a `stage` key to `buildAudienceOptionOverrides()`, fetched the same way as `form` — one
more `smsGet()` call in the existing `useEffect`, mirrored into `input`/return of the pure
function so the existing test pattern extends cleanly.

**Reference implementation — `leads-table.tsx:2213` + `2275-2276`:**
```ts
stage: leadLists
  .filter((l) => isAdmin || (!l.is_staging && !l.is_archive) || selectedStages.has(l.id))
  .map((l) => ({ value: l.id, label: l.name })),
```
`leads-table.tsx` hides staging/archive lists from non-admins (with an escape hatch for an
already-selected stage). The blast composer has no `isAdmin`/`selectedStages` context loaded —
**do not build that whole apparatus**. Simpler, correct-enough default for this surface: fetch
`GET /api/v1/lead-lists` (same endpoint, returns full `LeadList[]` rows — `id`, `name`,
`is_staging`, `is_archive`, gated by `FEATURES.LEAD_LISTS`) and filter out `is_staging` and
`is_archive` unconditionally, no admin/selected-value escape hatch. Blasting an audience by a
staging/archive list is not a real workflow on this surface — if that turns out wrong, it's a
one-line follow-up, not a design mistake.

```ts
smsGet<{ id: string; name: string; is_staging: boolean; is_archive: boolean }[]>("/api/v1/lead-lists")
  .then(({ data }) => { if (!cancelled) setLeadLists(data); })
  .catch(() => void 0);
```

Then in `buildAudienceOptionOverrides`:
```ts
stage: input.leadLists
  .filter((l) => !l.is_staging && !l.is_archive)
  .map((l) => ({ value: l.id, label: l.name })),
```

`GET /api/v1/lead-lists` is gated by `getFeatureAccess(auth.industryId, FEATURES.LEAD_LISTS)` —
same graceful-degrade pattern as `form-configs`/`FEATURES.FORM_BUILDER` already in this file
(`.catch(() => void 0)`, empty array on a 403 for industries without the feature — not a crash).

### Regression test

Extend `blast-composer.audience-options.test.ts` — add `"stage"` to
`REPORTED_BROKEN_FIELDS` is wrong (it wasn't in Sadin's original report), so add a **separate**
`it` block:
```ts
it("resolves a non-empty option list for stage, excluding staging/archive lists", () => {
  const overrides = buildAudienceOptionOverrides({
    ...FIXTURE,
    leadLists: [
      { id: "list-1", name: "Qualified", is_staging: false, is_archive: false },
      { id: "list-2", name: "Migration QC", is_staging: true, is_archive: false },
    ],
  });
  expect(overrides.stage).toEqual([{ value: "list-1", label: "Qualified" }]);
});
```
Plus extend the existing "none of the reported-broken fields have a static registry `options`"
test to also assert `registry.stage?.options` is empty (it is — confirms this is the same root
cause class, not a new one).

### Scope guard (unchanged from original brief)

Same branch (`fix/sms-blast-audience-options-stage`, PR #410) — don't open a new PR. Don't touch
`leads-table.tsx`, `advanced-filter-bar.tsx`, `use-filter-options.ts`, or the field registry.
Additive, blast-composer-only.

### Before re-requesting review

- `npx tsc --noEmit` clean
- `npm run test` green, new `stage` test present and asserting the exact filtered array (not
  just non-empty)
- Manually reload the blast composer in local dev (`npm run dev`, Admizz-local admin,
  `/sms` → New Blast → Audience → Add filter → Stage) and confirm real list names appear —
  don't stop at green tests, Sadin is going to click it again
- Push to the same branch, CI must be green again before flagging back to Opus
