# BRIEF — Campaigns Winner: expose masked winner name on the PUBLIC API

**For:** Sonnet · **Reviewer:** Opus (Sadin) · **Follow-up to:** the per-match Winner feature (on stage).

## Goal
Add the per-match **winner** to the public, token-based leaderboard API so the website dev can display it. **Masked name only** (e.g. `"Ebish P."`) — exactly like the existing `standings` names. **No other winner data** (no email, phone, picks, study-abroad). The winner reflects the **effective** winner = admin manual override if set, else the system auto-pick.

## Hard rules (privacy is the whole point)
- The public endpoint is **unauthenticated + CORS `*`** — world-readable. Emit **only a masked name** for the winner. Never email/phone/profile/picks.
- Reuse the existing `maskName()` in the public route and the existing `pickMatchWinners()` lib. No new auth, no DB/migration change (`winner_email` column already exists).
- Build on a branch off `stage`. Run build + `eslint . --max-warnings 50` + `tsc --noEmit` (all clean). **STOP at review** — no push/merge. Hand back the diff.

## Change 1 — `src/app/api/public/campaigns/[token]/leaderboard/route.ts` (the API)

1. **Imports:** add `pickMatchWinners` to the existing `scoring` import; add `import { DEFAULT_LEADERBOARD_FIELDS } from "@/industries/education-consultancy/features/campaigns/lib/constants";`.

2. **Select `winner_email`:** in the `campaign_results` query (currently selects `match_id, match_label, home_score, away_score, outcome, status, fetched_at`), add `winner_email`. Add `winner_email: string | null` to the `results` array's inline type.

3. **Score with profile fields (internal only):** change
   `const standings = scoreSubmissions(submissions, resultsMap, campaign.config);`
   to
   `const standings = scoreSubmissions(submissions, resultsMap, campaign.config, DEFAULT_LEADERBOARD_FIELDS);`
   This populates `profile.study_abroad_interest` so the auto-winner can be computed. **Do NOT change `maskedStandings`** — it destructures only `{ rank, name, correct, scored, pct }`, so profile is never emitted. (Verify this stays true.)

4. **Compute winners:** after `standings` is built:
   `const autoWinners = pickMatchWinners(standings, resultsMap);`

5. **Emit masked winner per result:** in the `publicResults` map, add a `winner` field. Final matches only; null otherwise:
   ```ts
   const publicResults = results.map((r) => {
     let winner: string | null = null;
     if (r.status === "final") {
       const effectiveEmail = r.winner_email ?? autoWinners.get(r.match_id) ?? null;
       if (effectiveEmail) {
         const entry = standings.find((e) => e.email === effectiveEmail);
         if (entry) winner = maskName(entry.name);
       }
     }
     return {
       match_label: r.match_label,
       score: r.status === "final" && r.home_score != null ? `${r.home_score}–${r.away_score}` : null,
       outcome: r.outcome,
       status: r.status,
       winner, // masked name or null
     };
   });
   ```
   (If the effective email isn't in `standings` — e.g. an excluded/test entrant — `winner` stays null. That's correct.)

   Keep everything else (rate limit, CORS, cache headers, `pending_matches`, the no-`form_config_id` early return) unchanged. The early-return empty branch can stay as-is (its `results: []` simply has no winners).

## Change 2 — `src/industries/education-consultancy/features/campaigns/lib/agent-prompt.ts` (keep-in-sync handoff)
- Update the `results` line in the documented response shape to include `winner`:
  `"results": [ { "match_label": string, "score": string|null, "outcome": "team_a"|"team_b"|"draw"|null, "status": "final"|"scheduled", "winner": string|null } ],`
- Add one semantics bullet: `- results.winner: masked name of the match's winner (first name + last initial), or null if the match isn't final / has no winner yet. Reflects the official (possibly admin-adjusted) winner. No other winner data is exposed.`

## Change 3 — `EXAMPLE_RESPONSE` in `campaign-detail.tsx` (gear dialog example)
- Add `winner: "Milan K."` to the example results entry:
  `results: [ { match_label: "Mexico vs South Africa", score: "2–1", outcome: "team_a", status: "final", winner: "Milan K." } ],`

## Acceptance
- [ ] Public API returns `winner` (masked name or null) on each result; final matches only; reflects override-then-auto.
- [ ] No PII added anywhere on the public path — `maskedStandings` unchanged; no email/phone/picks/study-abroad emitted; winner is a masked name string only.
- [ ] agent-prompt.ts + EXAMPLE_RESPONSE updated to match (both flagged "keep in sync").
- [ ] No auth/DB/migration change. build + eslint(0 err) + tsc clean.
- [ ] STOP — hand back diff. No push/merge.

## Files touched
- `src/app/api/public/campaigns/[token]/leaderboard/route.ts`
- `src/industries/education-consultancy/features/campaigns/lib/agent-prompt.ts`
- `src/industries/education-consultancy/features/campaigns/ui/campaign-detail.tsx` (EXAMPLE_RESPONSE only)
