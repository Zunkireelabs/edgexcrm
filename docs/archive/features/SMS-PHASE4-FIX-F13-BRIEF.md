# SMS Fix F-13 — Live match preview while a filter is still being edited (Phase 2)

## Status: NOT STARTED — Phase 2 of the audience-UX plan (Opus + Sadin scoped 2026-08-20). F-12 (Phase 1) is done, verified, sitting on PR #415 awaiting merge — do not touch that branch/PR.

## Context

F-12 (Phase 1) made the Audience match count always-visible and live once a filter is *applied*.
This brief closes the remaining gap: while a filter condition is still open in its popover —
before "Apply" is clicked — there's no feedback at all (Sadin's original screenshot: typed "is
anish" into Search, no idea if it would match anyone until committing). Phase 2 makes the
persistent count chip (built in F-12) update live from the **in-progress draft**, not just the
committed tree.

## Scope warning — this genuinely requires touching shared filter components

Unlike F-11/F-12 (`blast-composer.tsx`-only), this fix cannot be done without touching:
- `src/components/filters/advanced-filter-bar.tsx`
- `src/components/filters/add-filter-button.tsx`
- `src/components/filters/filter-chip.tsx`
- `src/components/filters/filter-chip-row.tsx`

Reason: the in-progress draft condition (the value being typed before Apply) is local
`useState` inside `AddFilterButton`/`FilterChip` today and never surfaces to their parent. There
is no way to preview it from `blast-composer.tsx` without that state being exposed upward.

**This is safe because it's additive and opt-in**: every change below is a new **optional** prop
that defaults to `undefined`. `leads-table.tsx` and every other `AdvancedFilterBar` consumer pass
nothing and get byte-identical behavior — Opus verified this by reading all 4 files end to end
before writing this brief. Still: do not change any existing prop's type, default, or behavior.
Do not touch `filter-condition-editor.tsx`, `filter-field-picker.tsx`, `filter-operator-picker.tsx`,
`filter-value-editor.tsx`, `use-filter-options.ts`, or the field registry — none of them need to
change for this.

## The fix

### 1. Thread an optional `onDraftConditionChange` callback through the chain

Add to `FilterHostConfig` (`src/components/filters/types.ts`):
```ts
onDraftConditionChange?: (condition: FilterCondition | null) => void;
```

**`advanced-filter-bar.tsx`**: destructure it from props, pass to both `AddFilterButton` and
`FilterChipRow` unchanged (no logic in this file needs to change beyond passing the prop down).

**`add-filter-button.tsx`**: add `onDraftConditionChange?: (condition: FilterCondition | null) => void`
to `AddFilterButtonProps`. Add:
```ts
useEffect(() => {
  onDraftConditionChange?.(picked?.condition ?? null);
}, [picked, onDraftConditionChange]);
```
This fires the current draft while a field is picked and the editor is open, and fires `null`
when the popover closes without applying (`handleOpenChange` already sets `picked` to `null` on
close — the effect picks that up for free) or right before `handleApply` clears `picked` (also
already handled — no new logic needed there).

**`filter-chip-row.tsx`**: add `onDraftConditionChange?: (condition: FilterCondition | null) => void`
to `FilterChipRowProps`, forward it verbatim to each `<FilterChip>`.

**`filter-chip.tsx`**: add the same optional prop to `FilterChipProps`. Add:
```ts
useEffect(() => {
  onDraftConditionChange?.(open ? draft : null);
}, [draft, open, onDraftConditionChange]);
```
`open` here is the chip's own popover-open state (already exists, line ~24) — fires `null` the
moment the popover closes, whether by Apply or by clicking away (matches the existing "closing
discards" comment already in this file for `AddFilterButton`... actually for `FilterChip`,
closing WITHOUT apply currently just silently drops the draft too since `draft` is re-seeded from
`condition` on next open — don't change that behavior, just mirror it in the callback: closed =
`null`).

### 2. `blast-composer.tsx` — merge the draft into the preview

Add:
```ts
const [draftCondition, setDraftCondition] = useState<FilterCondition | null>(null);
```
Pass `onDraftConditionChange={setDraftCondition}` to the existing `<AdvancedFilterBar ...>` call.

Only preview a draft once it would actually be Apply-able — reuse the exact same validity check
`FilterConditionEditor` already uses to enable its own Apply button
(`conditionSchema.safeParse(condition).success`, from `@/lib/filters/schema`). An invalid/
incomplete draft (e.g. no value typed yet) should NOT trigger a preview call — keep showing the
committed-tree count until the draft is valid.

Build the preview tree by replacing-or-appending the draft into the committed tree's conditions
by `id` (works for both cases: `AddFilterButton` drafts have a fresh id not in `tree.conditions`
→ appended; `FilterChip` drafts carry the id of the condition being edited → replaces it in
place):
```ts
function withDraft(tree: FilterTree, draft: FilterCondition | null): FilterTree {
  if (!draft) return tree;
  const exists = tree.conditions.some((c) => c.id === draft.id);
  return {
    ...tree,
    conditions: exists
      ? tree.conditions.map((c) => (c.id === draft.id ? draft : c))
      : [...tree.conditions, draft],
  };
}
```

Modify F-12's existing `audience-count` `useEffect` (currently keyed `[tree, blast.id]`) to also
depend on `draftCondition`, and to POST `withDraft(tree, isDraftValid ? draftCondition : null)`
instead of `tree` directly. Everything else about that effect (debounce, loading state, the
persistent chip's three render states) stays exactly as F-12 built it — do not duplicate the
endpoint call or add a second count state. One `audienceCount` state, one effect, it just now
reacts to two inputs instead of one.

### Scope guard

- Only the 4 shared filter files (additive optional props) + `blast-composer.tsx`. No other
  consumer of `AdvancedFilterBar` should show any behavior change — verify this explicitly (see
  below).
- Don't build Phase 3 (recipients preview table) — separate future brief.
- Don't change `/api/v1/sms/blasts/[id]/audience-count` or `/preview` — F-12's endpoint already
  accepts an arbitrary `audience_filter` tree override, which is exactly what this needs.

### Regression tests

- Unit test `withDraft()` (or wherever it ends up, pure function) — append case (new id) and
  replace case (existing id) — same style as `buildAudienceOptionOverrides`'s tests in
  `blast-composer.audience-options.test.ts`.
- A test proving `AddFilterButton`/`FilterChip` behave identically to before when
  `onDraftConditionChange` is not passed (i.e. existing tests for these components, if any,
  should need zero changes — that itself is the regression proof; if there are no existing tests
  for these components, note that in the report rather than inventing new component-render tests
  for files outside this fix's core change).

### Before reporting back

- `npx tsc --noEmit` clean
- `npm run test` green
- Manually reload the blast composer in local dev: open Audience → Add filter → Search → type a
  value **without clicking Apply** — confirm the persistent count chip updates live while typing,
  reverts to the committed-tree count if you close the popover without applying, and settles once
  you do Apply. Then open `leads-table.tsx`'s own filter bar (the `/leads` page) and confirm it
  behaves identically to before this change — no live-preview UI should appear there (it doesn't
  pass the new prop).
- **Branch**: continue on the existing `fix/sms-f12-audience-count` branch (do NOT start fresh
  from `origin/main`) — this fix directly modifies F-12's `audience-count` `useEffect`, which
  only exists on that branch (PR #415 is still open/unmerged per Sadin's "batch it all, push
  once" instruction). Starting from `main` would mean rebuilding F-12's effect from scratch and
  risking drift from what's already been verified. Just add commits to the same branch/PR.

## Sequencing (per Sadin, 2026-08-20)

Do NOT open a PR or push anywhere yet after this. Sadin wants F-12 + F-13 (this) + Phase 3
finished end-to-end locally first, verified together in one pass, then pushed to stage as one
batch — not merged incrementally like F-11/F-12 were. Report back to Opus with the branch name
and confirmation of local verification; Opus will hold it until Phase 3 is also ready.
