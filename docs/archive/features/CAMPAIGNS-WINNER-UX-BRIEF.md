# BRIEF — Campaigns Winner: clearer edit UX (dropdown, not star)

**For:** Sonnet (executor) · **Reviewer:** Opus (Sadin reviews) · **Follow-up to:** `CAMPAIGNS-WINNER-BRIEF.md` (already built, on `stage`, NOT yet in prod).

## Why
The per-match Winner edit currently uses a subtle ☆ star on each predictor row. Users miss it and instead click the **match-result pencil** ("Override Result" — changes team score/outcome, a public fact they must NOT touch). Replace the star with an obvious, clearly-labeled **dropdown on a single winner banner row** that can't be confused with the result pencil.

## Hard rules
- **UI-only.** Touch ONLY `src/industries/education-consultancy/features/campaigns/ui/campaign-detail.tsx`. No DB, no migration, no API, no scoring change. The `PATCH .../results/[matchId]` `set_winner` endpoint already exists and works (`set_winner: email` sets, `set_winner: null` resets to auto) — reuse the existing `handleSetWinner(matchId, email|null)`.
- **Do NOT touch** the match-result override pencil / `OverrideDialog` — leave it exactly as is.
- Build on a branch off `stage`. Run build + `eslint . --max-warnings 50` + `tsc --noEmit`. **STOP at review** — no push, no merge. Hand back the diff.

## What to change (inside the expanded predictor block, ~`campaign-detail.tsx:694–810`)

1. **Remove the per-predictor star control entirely:**
   - Delete the 6th `<th>` (the empty `w-16` Actions header) added for the star.
   - Delete the per-predictor `<td>` with the `Star` "Set as winner" button.
   - Revert the inner predictor table to **5 columns** (Name · Pick · ✓ · Study Abroad Interest · Contact). Fix the empty-state `colSpan` back to `5`.
   - Remove now-unused lucide imports `Star` and `RotateCcw` (avoid unused-var lint).

2. **Replace the current winner row with a single "Winner banner" first row** (final matches only, `r.status === "final"`), spanning all 5 columns (`colSpan={5}`), containing, left-to-right:
   - `Trophy` icon (keep import) + bold **"Winner:"**.
   - If `r.winner` is set: the winner's **name** + a small badge showing **`r.winner.source`** ("Auto"/"Manual", capitalize). Highlight the row (`bg-yellow-50 dark:bg-yellow-950`).
   - If `r.winner` is null: muted **"No eligible winner yet"** (no highlight needed).
   - A **shadcn `Select`** (already imported in this file) acting as the editor — label/trigger reads **"Change winner"**:
     - `value` = the effective winner email when set, else a sentinel `"__auto__"`.
     - Options: first item **"Use auto pick"** (value `"__auto__"`), then one item per predictor of this match from `matchPredictors.get(r.match_id) ?? []`, each `value={predictor.email}` label `{predictor.name}` (show study-abroad "Yes"/correctness inline if trivial, else just name).
     - `onValueChange`: if value === `"__auto__"` → `handleSetWinner(r.match_id, null)`; else → `handleSetWinner(r.match_id, value)`.
   - A muted helper line: **"Internal only — does not change the match result or the public leaderboard."**
   - The winner's full detail (pick / ✓ / abroad / contact) no longer needs its own columns in the banner — the person still appears in the normal predictor list below, so the banner can be compact. (Do not try to recreate the 5 data columns inside the banner.)

3. Wrap the `Select` interactions so they don't bubble to any row toggle: add `onClick={(e) => e.stopPropagation()}` on the Select trigger wrapper (defensive — the predictors row has no onClick today, but the result row above does).

4. Non-final matches: **no winner banner at all** (unchanged from now).

## Acceptance criteria
- [ ] Inner predictor table is back to 5 columns; no ☆ stars anywhere.
- [ ] Every **final** match shows ONE winner banner row with the "Change winner" Select — including matches with no eligible auto winner (so admin can still pick).
- [ ] Selecting a predictor sets them as Manual winner (repins, badge → "Manual"); "Use auto pick" resets to auto; both via the existing `handleSetWinner`.
- [ ] Helper text present; match-result pencil untouched; public route untouched.
- [ ] No unused imports. build + eslint(0 err) + tsc clean.
- [ ] STOP — hand back diff. No push/merge.

## File touched
- `src/industries/education-consultancy/features/campaigns/ui/campaign-detail.tsx` (only)
