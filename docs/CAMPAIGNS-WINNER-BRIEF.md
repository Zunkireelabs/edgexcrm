# BRIEF — Campaigns: per-match "Winner" (auto-pick + admin override)

**For:** Sonnet (executor) · **Reviewer:** Opus (Sadin reviews before any merge/migration)
**Feature:** education_consultancy → campaigns (FIFA "Predict & Win", Admizz)
**Status:** approved to build on a feature branch. **DO NOT** merge, push to stage/main, or apply the migration to the shared Supabase DB. Stop at review.

---

## 0. Hard rules (read first)

- **Review gate is real.** Build on a branch, run the verification in §7, then STOP and hand the diff back. Do **not** `git push`, do **not** merge to `stage`/`main`, do **not** apply migration 055 to the shared DB. Sadin + Opus apply migrations and promote. (You have overstepped this before — don't.)
- **Industry-scoped.** Everything lives under `src/industries/education-consultancy/features/campaigns/` + its API routes. Do not touch universal files.
- **Shared DB.** dev + prod share ONE Supabase DB. The migration file is *written only*; it is not yours to run.
- **Scope discipline.** This is an additive enhancement to the existing per-match predictor drill-down. Do not refactor unrelated campaign code, do not touch the public leaderboard route, do not change the scoring/ranking rules.

---

## 1. What we're building

In the per-match expanded predictor list (the inner table inside each "Match Results" row: Name · Pick · ✓ · Study Abroad Interest · Contact), add a **single "Winner" for that match**, pinned and highlighted at the **top** of the inner list.

- **System auto-picks** the winner. **Manual override** by an admin is allowed, persists, and can be reset back to auto.
- The winner is identified by the predictor's **normalized email** — the existing person key in this feature. This feature scores `lead_submissions`; there is **no `leads.id` linkage**, and you must not add one.
- **Admin-only.** The public leaderboard route (`src/app/api/public/campaigns/[token]/leaderboard/route.ts`) is **untouched**.

---

## 2. Selection rules (locked by Sadin)

**Auto-pick (per match):**
1. Only **final** matches have a winner. Scheduled/pending matches show **no** winner.
2. A predictor is **eligible** only if BOTH are true:
   - their prediction for that match was **correct** (`pick.prediction === result.outcome`, result final with non-null outcome), AND
   - their `profile["study_abroad_interest"] === "yes"`.
3. If multiple eligible predictors tie, the winner is the **earliest correct submission for that game** (smallest pick `created_at`), with **name A→Z** as the final stable fallback.
4. If **no** predictor is eligible (no one correct, or no correct predictor is abroad-interested) → auto winner is `null` (UI shows "no eligible winner yet").

**Manual override (admin):**
- Admin may set the winner to **any predictor of that match** (not restricted to the correct+abroad rule — admin judgment overrides auto). It MUST still be validated as a real predictor of that match.
- Admin may **reset to auto** (clears the override; auto-pick takes over again).
- Manual override only offered on **final** matches.

---

## 3. Persistence model (mirror the existing ESPN override pattern)

Same shape as result-override (`source: 'espn'|'manual'`): **auto is computed live and never written; only the manual override is persisted.**

- `campaign_results.winner_email TEXT NULL`
  - `NULL` → use the live auto-pick.
  - non-null → admin manual override (this email is the winner).

That single column is the entire schema change. No separate `winner_source` column — source is derived: `winner_email IS NOT NULL` ⇒ `'manual'`, else `'auto'`.

---

## 4. Migration — `supabase/migrations/055_campaign_winner.sql`

Additive, idempotent, no RLS change (existing `campaign_results` policies already cover it). Write the file only; do not apply.

```sql
-- Migration 055: Add winner_email to campaign_results (per-match winner override)
-- Additive, idempotent. NULL = use system auto-pick; non-null = admin manual override.
-- Write only — Sadin applies (shared prod DB).

ALTER TABLE campaign_results ADD COLUMN IF NOT EXISTS winner_email TEXT;
```

---

## 5. Scoring lib — `src/industries/education-consultancy/features/campaigns/lib/scoring.ts`

Keep `scoreSubmissions` behavior identical; add the winner logic as a **pure, separate function** so it's the single source of truth (no client re-implementation).

1. **Add `created_at` to `LeaderboardPick`** (it's already tracked internally as `RawPick.createdAt` — surface it):
   ```ts
   export interface LeaderboardPick {
     match_id: string;
     match_label: string;
     prediction: string;
     outcome: "team_a" | "team_b" | "draw" | null;
     status: "scheduled" | "final";
     created_at: string;   // NEW — submission time of this (deduped, latest) pick
   }
   ```
   Populate it in the `picks.push({...})` in step 4 of `scoreSubmissions` from `pick.createdAt`.

2. **New exported pure function:**
   ```ts
   /**
    * Per-match auto-winner. Final matches only. Eligible = predicted correctly AND
    * study_abroad_interest === "yes". Tie → earliest submission, then name A→Z.
    * Returns Map<match_id, winnerEmail>. Matches with no eligible predictor are absent.
    */
   export function pickMatchWinners(
     entries: LeaderboardEntry[],
     results: Record<string, MatchResult>
   ): Map<string, string>
   ```
   - Iterate entries; for each entry's pick where `results[match_id].status === "final"` and `outcome != null` and `pick.prediction === outcome` and `entry.profile["study_abroad_interest"] === "yes"`, treat the entry as a candidate for that `match_id`.
   - For each match_id, reduce candidates to one: smallest `pick.created_at` wins; tie → `name.localeCompare`. Store `email`.
   - Pure, no I/O. (No test runner is configured in this repo — do **not** add one; just keep the function pure and obviously correct.)

---

## 6. API

### 6a. `GET .../campaigns/[id]/leaderboard/route.ts`
After computing `standings`, compute auto winners and merge persisted overrides, then return one effective winner per match.

- `pickMatchWinners(standings, resultsMap)` → `autoWinners: Map<match_id, email>`.
- The `espnResults` rows must now also select `winner_email`. **Check `refreshEspnResults` returns `winner_email`** — if its upsert/select doesn't include the column, add `winner_email` to the returned/selected fields (do not let the upsert overwrite it — it must only touch result fields, never `winner_email`). Confirm by reading `lib/results-espn.ts` before editing.
- Build effective winner per match:
  - `manual = row.winner_email` (string|null).
  - `effectiveEmail = manual ?? autoWinners.get(match_id) ?? null`.
  - Resolve the email → predictor name from `standings` (the entry with that email). If the manual email no longer matches any predictor (e.g. submissions changed), fall back to auto.
  - `source = manual ? 'manual' : 'auto'`.
- Add to each returned `results[i]` a field:
  ```ts
  winner: effectiveEmail ? { email, name, source } : null
  ```
  (Attach to the result row so the UI has it per match. Don't invent a separate top-level map unless cleaner — per-row is simplest for the UI.)

### 6b. `PATCH .../campaigns/[id]/results/[matchId]/route.ts`
Extend the existing route with a **new, separate branch** (do not entangle with the outcome-override or revert branches).

- Accept body `{ set_winner: string | null }` (presence of the `set_winner` key selects this branch).
  - `set_winner: null` → `patch = { winner_email: null }` (reset to auto).
  - `set_winner: "<email>"` →
    - Normalize the email the same way scoring does (`normalizeEmail` from `@/lib/leads/dedup`).
    - **Validate** it's a real predictor of this match: load submissions for the campaign's `form_config_id`, run the same valid-pick filter, confirm `(email, match_id)` exists. If not → `apiValidationError({ set_winner: ["Not a predictor of this match"] })`. (Reuse the leaderboard route's submission-loading approach; keep it minimal.)
    - `patch = { winner_email: <normalizedEmail> }`.
  - Only `winner_email` is updated in this branch — do NOT touch outcome/score/source/locked.
- Same guards as the existing route: `authenticateRequest` → `getFeatureAccess(auth.industryId, FEATURES.CAMPAIGNS)` → `requireAdmin`. Same `scopedClient`, same `.eq("campaign_id", id).eq("match_id", matchId)`.
- Return the updated row (or the effective winner) so the UI can refresh; simplest is to `onSaved()`-reload on the client (matches existing OverrideDialog flow), so returning the row is fine.

---

## 7. UI — `src/industries/education-consultancy/features/campaigns/ui/campaign-detail.tsx`

1. **Types:** add `winner` to `EspnResult` interface:
   ```ts
   winner?: { email: string; name: string; source: "auto" | "manual" } | null;
   ```
2. **Winner row (pinned, top of inner table):** inside the expanded predictors block (currently `campaign-detail.tsx:675–738`), when `r.status === "final"`:
   - If `r.winner` is set: render a **highlighted** first row with a 🏆 / `Trophy` icon + a **"Winner"** badge and a small **"Auto"** or **"Manual"** tag (from `r.winner.source`). Show the winner's name + their pick/✓/abroad/contact (look them up from `matchPredictors.get(r.match_id)` by email so the columns stay consistent). Visually distinct (e.g. `bg-yellow-50 dark:bg-yellow-950`, matching the existing `TOP3_COLORS[0]` treatment).
   - If `r.winner` is null on a final match: a subtle "No eligible winner" line (don't fabricate one).
   - The same person also still appears in the normal list below (or de-dupe them out of the list — your call; pinned-and-also-in-list is acceptable and simpler. Pick one and be consistent).
3. **Set as winner / Reset to auto (admin actions):**
   - Each predictor row (final matches only) gets a small ghost action (e.g. a star/`Trophy`-outline icon, `title="Set as winner"`) that calls `PATCH /results/[r.match_id]` with `{ set_winner: predictor.email }` then `loadLeaderboard()`.
   - The winner row, when `source === "manual"`, gets a "Reset to auto" ghost action calling `{ set_winner: null }`.
   - **Reuse the `stopPropagation` pattern** (`onClick={(e) => { e.stopPropagation(); ... }}`) so clicks don't collapse the expanded match — same as the existing Pencil override button at `campaign-detail.tsx:669`.
4. Non-final matches: no winner row, no set-winner action (correctness unknown).
5. Match the existing inner-table styling (text-xs, `border-b last:border-0`, etc.). Don't restyle the table.

---

## 8. Out of scope (do not do)

- Public leaderboard route / public winner display.
- Any `leads` table linkage or new columns beyond `campaign_results.winner_email`.
- Changing ranking/scoring rules, integrity flags, or the existing result-override flow.
- Auto-writing winners to the DB (auto is computed live only).
- A test runner / test files (none configured).

---

## 9. Acceptance criteria

- [ ] `055_campaign_winner.sql` written (additive, idempotent), **not applied**.
- [ ] `LeaderboardPick.created_at` added + populated; `pickMatchWinners` pure function added.
- [ ] Leaderboard GET returns `winner` per final match: manual override wins over auto; auto = correct ∧ abroad, tie→earliest→name; `null` when none eligible.
- [ ] `refreshEspnResults` confirmed to preserve `winner_email` (never overwritten by the ESPN upsert) and to return it.
- [ ] PATCH `set_winner` branch: validates predictor membership, normalizes email, `null` resets, only touches `winner_email`, admin+feature-gated.
- [ ] UI: pinned highlighted winner row atop the inner list on final matches, Auto/Manual tag, "Set as winner" + "Reset to auto" actions with `stopPropagation`, graceful "no eligible winner".
- [ ] Public leaderboard route unchanged.
- [ ] `npm run build` clean.
- [ ] `npx eslint . --max-warnings 50` clean (0 new warnings).
- [ ] `npx tsc --noEmit` clean.
- [ ] Manual local check on `npm run dev` (do NOT use the shared prod DB for writes; see note below).
- [ ] STOP — hand back the diff. No push, no merge, no migration apply.

> **Local verification note:** the migration isn't applied to shared DB by you. To exercise the UI locally you can apply `055` to a local/throwaway DB only. If that's not feasible, at minimum verify build/lint/tsc and that the GET gracefully handles the column being absent is NOT required — the column is part of this change, so document clearly in your handoff that runtime testing needs migration 055 applied first.

---

## 10. Files touched (expected)

- `supabase/migrations/055_campaign_winner.sql` (new)
- `src/industries/education-consultancy/features/campaigns/lib/scoring.ts`
- `src/industries/education-consultancy/features/campaigns/lib/results-espn.ts` (only if `winner_email` needs preserving/returning)
- `src/app/(main)/api/v1/campaigns/[id]/leaderboard/route.ts`
- `src/app/(main)/api/v1/campaigns/[id]/results/[matchId]/route.ts`
- `src/industries/education-consultancy/features/campaigns/ui/campaign-detail.tsx`
