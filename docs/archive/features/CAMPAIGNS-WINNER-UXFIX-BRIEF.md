# BRIEF — Campaigns Winner: fix "Change winner" dropdown not opening

**For:** Sonnet · **Reviewer:** Opus (Sadin testing) · **Follow-up to:** `CAMPAIGNS-WINNER-UX-BRIEF.md`.

## Bug
The "Change winner" control (shadcn `Select`) renders but **does not open on click** — a known Radix `Select` interaction issue when nested inside a `<table>`/clickable-row context. The winner banner, badges, and helper text are correct; only the picker is dead.

## Fix (UI-only, one spot)
In `src/industries/education-consultancy/features/campaigns/ui/campaign-detail.tsx`, inside the winner banner row, **replace the shadcn `<Select>…</Select>` block with a native `<select>`**. Native selects open reliably inside tables and need no portal.

Replace the current `<div onClick={(e) => e.stopPropagation()}> <Select …>…</Select> </div>` with:

```tsx
<select
  value={r.winner?.email ?? "__auto__"}
  onClick={(e) => e.stopPropagation()}
  onChange={(e) =>
    handleSetWinner(r.match_id, e.target.value === "__auto__" ? null : e.target.value)
  }
  className="h-7 rounded-md border bg-background px-2 text-xs"
>
  <option value="__auto__">Use auto pick</option>
  {(matchPredictors.get(r.match_id) ?? []).map((p) => (
    <option key={p.email} value={p.email}>
      {p.name}
    </option>
  ))}
</select>
```

## Rules
- **UI-only**, this one control only. No DB/API/scoring change. `handleSetWinner` is unchanged and already works (the endpoint is verified).
- **Do NOT remove** the `Select`/`SelectTrigger`/`SelectContent`/`SelectItem`/`SelectValue` imports — they are still used by `OverrideDialog` (the result-override pencil). Only this winner picker stops using them.
- Leave the rest of the banner (Trophy, "Winner: <name>", Auto/Manual badge, "No eligible winner yet", helper line, yellow bg) exactly as is.
- Do NOT touch `OverrideDialog` / the result pencil.

## Acceptance
- [ ] Clicking the winner picker opens a working list (Use auto pick + each predictor by name).
- [ ] Selecting a predictor → Manual winner (banner repins, badge "Manual"); "Use auto pick" → resets to Auto. Both via existing `handleSetWinner`.
- [ ] Works on final matches incl. "No eligible winner yet" ones.
- [ ] No unused-import lint; build + `eslint . --max-warnings 50` + `tsc --noEmit` clean.
- [ ] STOP — hand back the diff. No push/merge.

## File touched
- `src/industries/education-consultancy/features/campaigns/ui/campaign-detail.tsx` (only)
