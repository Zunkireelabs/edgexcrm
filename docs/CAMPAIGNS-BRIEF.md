# Campaigns Feature Brief — Prediction Leaderboard (Admizz / education_consultancy)

**Status:** ✅ Phase 1 + 1.5 + 1.6 **SHIPPED TO PRODUCTION** 2026-06-15 (edgex). Call sign `CAMPAIGN-KICKOFF`. Migs 049/050 on shared DB. Public URL live: `https://edgex.zunkireelabs.com/api/public/campaigns/<token>/leaderboard`. **Phase 2 still pending** (admin result override UI + integrity flags) — brief stays active for it.
**Author:** Opus (planning) · **Executor:** Sonnet (code) · **Reviewer:** Opus · **Smoke:** Sadin
**Created:** 2026-06-15 · **Updated:** 2026-06-15

---

## Goal

A new **"Campaigns"** dashboard surface in edgeX, industry-scoped to `education_consultancy`. Its first campaign is the **FIFA World Cup 2026 "Predict & Win"** leaderboard built on the existing `worldcup-predict-win` form. Match results are fetched automatically and the leaderboard is scored + ranked on view — **no manual SQL**. Built data-driven so a second campaign is config, not code, and so other industries can opt in later via their manifest.

## Decisions locked (2026-06-15, with Sadin)

1. **Results trust model:** ESPN auto-fill **+ admin lock/override.** A finished match is stored and **locked immutable** once recorded; an admin can manually override any result. No hard dependency on ESPN being correct.
2. **Scope:** **industry-scoped to `education_consultancy`** (= Admizz today; future education tenants inherit; other industries opt in later). NOT per-tenant gated.
3. **Viewer access:** **admins / owners only.** Nav hidden + API 403 for counselors/viewers (leaderboard holds entrant PII + prize decisions).
4. **Ranking rule:** **most correct predictions**, ties broken by accuracy %.
5. **No cron / no new infra** for v1 — compute-on-read + a "Refresh results" action.

---

## Classification & placement (per CLAUDE.md industry rules)

Industry-scoped feature → lives in `src/industries/education-consultancy/features/campaigns/`.

- `FEATURES.CAMPAIGNS = "campaigns"` in `src/industries/_registry.ts`.
- `campaignsMeta` (`{ id: FEATURES.CAMPAIGNS, industries: [INDUSTRIES.EDUCATION_CONSULTANCY] }`) registered in `src/industries/education-consultancy/manifest.ts` `features[]` + a `sidebar[]` entry `{ featureId: FEATURES.CAMPAIGNS, href: "/campaigns", label: "Campaigns", icon: "Megaphone" }` (icon as a **string**; register `Megaphone` in `INDUSTRY_ICONS` in `shell.tsx` if missing).
- Three-place gate via `getFeatureAccess(industryId, FEATURES.CAMPAIGNS)`: sidebar (automatic via manifest), page shells (`notFound()`), API routes (`apiForbidden()`).
- **Admin-only on top of the industry gate:** in API routes, after auth + feature gate, reject non-admin (`auth.role` not in `owner`/`admin`) with `apiForbidden()`. Hide the nav item for non-admins (use existing `canSeeNav`/permissions helper pattern from `src/lib/api/permissions.ts`).

---

## Data model (new migration — next sequential number)

Both tables: `tenant_id` FK + RLS (`get_user_tenant_ids()` for SELECT, `is_tenant_admin(tenant_id)` for mutations) per CLAUDE.md.

### `campaigns`
| col | type | notes |
|---|---|---|
| id | uuid pk | |
| tenant_id | uuid | FK tenants ON DELETE CASCADE |
| name | text | "FIFA World Cup 2026 — Predict & Win" |
| slug | text | unique per tenant; URL-friendly |
| type | text | default `'prediction_leaderboard'` (only type for now) |
| form_config_id | uuid | FK form_configs — the linked form |
| config | jsonb | see shape below |
| status | text | `'active' | 'final' | 'draft'`, default `'active'` |
| created_at / updated_at | timestamptz | |

`config` jsonb shape:
```json
{
  "provider": "espn",
  "league": "fifa.world",
  "fields": { "match_id": "match_id", "match_label": "match_label", "prediction": "prediction" },
  "outcomes": { "team_a": "team_a", "team_b": "team_b", "draw": "draw" },
  "ranking_rule": "most_correct",
  "exclude_domains": ["zunkireelabs.com"],
  "exclude_emails": ["test@gmail.com","test@gmai.com","dsasad@gmail.com","anish@gmail.com","canada@gmail.com"]
}
```

### `campaign_results`
| col | type | notes |
|---|---|---|
| id | uuid pk | |
| campaign_id | uuid | FK campaigns ON DELETE CASCADE |
| tenant_id | uuid | denormalized for RLS |
| match_id | text | e.g. `'espn-760415'` |
| match_label | text | `'Mexico vs South Africa'` |
| home_team / away_team | text | from provider |
| home_score / away_score | int | null until played |
| outcome | text | `'team_a' | 'team_b' | 'draw'`, null until final |
| status | text | `'scheduled' | 'final'` |
| source | text | `'espn' | 'manual'` |
| locked | bool | default false; true once final/confirmed → never auto-overwritten |
| fetched_at | timestamptz | |
| **unique(campaign_id, match_id)** | | upsert key |

### Seed (idempotent, in the migration)
Insert ONE campaign row for Admizz's World Cup form, resolving ids by slug so it works on the shared dev/prod DB:
```sql
insert into campaigns (tenant_id, name, slug, type, form_config_id, config, status)
select t.id, 'FIFA World Cup 2026 — Predict & Win', 'worldcup-2026', 'prediction_leaderboard',
       f.id, '<config json above>'::jsonb, 'active'
from tenants t join form_configs f on f.tenant_id=t.id
where t.slug='admizz' and f.slug='worldcup-predict-win'
on conflict do nothing;
```

---

## Engine

### Scoring (`features/campaigns/lib/scoring.ts`) — pure, unit-testable
Input: raw `lead_submissions` rows for the campaign's `form_config_id` + a results map (`match_id → outcome`). Steps:
1. Keep only submissions whose `custom_fields.match_id` matches the provider prefix (`espn-…`) and whose `prediction ∈ {team_a,team_b,draw}` — **drops junk** (`'dasdasdas'`, empty match_id).
2. **Dedup**: per `(normalized_email, match_id)` keep the **latest** by `created_at` (a person who re-answered a match counts once).
3. **Exclude** test/internal per `config.exclude_domains` + `exclude_emails`; also drop name ILIKE `test%`.
4. Score: a pick is correct iff `outcome[match_id] == prediction`. Only matches with a **final** result count toward `scored`; pending matches are listed but not scored.
5. Rank by `correct` desc, then accuracy (`correct/scored`) desc, then name. Return `[{rank, name, email, phone, correct, scored, pct, picks:[{match_label, prediction, outcome, status}]}]`.

**Verified facts to bake in** (proven against live data 2026-06-15):
- `team_a` = first team in `match_label` = ESPN **home**; `team_b` = ESPN **away**. (Held for all 12 completed matches.)
- Current data: 441 deduped predictions, 147 people, 14 valid matches.

### ESPN fetch (`features/campaigns/lib/results-espn.ts`)
- For each distinct campaign `match_id`, strip the `espn-` prefix → numeric event id; call
  `GET https://site.api.espn.com/apis/site/v2/sports/soccer/{league}/summary?event={id}`.
- Parse `header.competitions[0]`: `status.type.description`/`...completed`, and `competitors[]` (`homeAway`, `team.displayName`, `score`).
- `completed === true` → status `'final'`, compute `outcome` from scores (home>away→team_a, away>home→team_b, equal→draw). Else `'scheduled'`.
- **Upsert into `campaign_results`** on `(campaign_id, match_id)` — but **never overwrite a row where `locked=true`**. On reaching `final`, set `locked=true` automatically.
- Resilient: timeout, try/catch per match; a failed fetch leaves the existing stored row untouched and is logged, not fatal.

> ESPN is undocumented — treat it as a convenience auto-fill only. The stored+locked row is the source of truth; the admin override (Phase 2) is the escape hatch.

---

## Routes & API

- **Pages** (thin shells, `getFeatureAccess → notFound`, admin check):
  - `src/app/(main)/(dashboard)/campaigns/page.tsx` → lists campaigns (delegates to `features/campaigns/ui/campaigns-list.tsx`).
  - `src/app/(main)/(dashboard)/campaigns/[id]/page.tsx` → one campaign (delegates to `features/campaigns/ui/campaign-detail.tsx`).
- **API** (`authenticateRequest` → `getFeatureAccess(CAMPAIGNS) → apiForbidden` → admin-only → `scopedClient(auth)`):
  - `GET /api/v1/campaigns` — list tenant campaigns.
  - `GET /api/v1/campaigns/[id]/leaderboard` — load campaign, refresh results from ESPN (upsert non-locked), load `lead_submissions` for `form_config_id`, run scoring, return `{ campaign, standings, results, pending_matches }`.
  - `POST /api/v1/campaigns/[id]/refresh` — force a results refresh (the "Refresh results" button).
  - **(Phase 2)** `PATCH /api/v1/campaigns/[id]/results/[matchId]` — admin manual override (set outcome/score, `source='manual'`, `locked=true`).

`scopedClient` reads `lead_submissions`/`form_configs` (tenant-owned) safely. Reuse the dedup/normalized-email helpers in `src/lib/leads/dedup.ts` rather than re-deriving.

---

## UI (`features/campaigns/ui/`)

- **`/campaigns`**: card/list of campaigns (just World Cup now) — name, type, status, entrant count, last-refreshed.
- **`/campaigns/[id]`**:
  - Header: campaign name, status, "Refresh results" button, last-refreshed timestamp.
  - **Pending banner**: matches still `scheduled` (e.g. "2 matches pending — standings not final").
  - **Results table**: each match → score + outcome + source badge (ESPN/manual) + locked indicator. (Phase 2: inline admin override.)
  - **Leaderboard table**: rank, name, score (`correct/scored`), accuracy %, contact. Top 3 highlighted. Optional: expand a row to see that person's per-match picks.
- Match existing dashboard table styling (see leads table). No new chrome greys (STATUS-BOARD checklist).

---

## Phasing (review gate between phases)

- **Phase 1 — foundation + auto leaderboard:** migration (both tables + RLS + seed), registry/manifest/sidebar, page shells + gates, scoring lib, ESPN fetch+store+auto-lock, `GET leaderboard` + `POST refresh` APIs, list + detail UI. **Outcome:** nav appears for Admizz admins; World Cup leaderboard renders, auto-scored, results auto-fetched & stored; pending matches flagged. **STOP for Opus review.**
- **Phase 2 — admin controls + integrity:** manual result override UI (`PATCH .../results/[matchId]`), integrity flags (same-phone / same-name / sequential-signup clusters surfaced, not auto-removed), per-entrant pick drill-down, polish. **STOP for Opus review.**

---

## Phase 1.5 — Public leaderboard API (for the external campaign landing page)

**Bundled into `feature/campaigns-phase1` before the stage merge.** Lets another dev render the leaderboard on the public campaign landing site (no CRM login). Decisions locked (2026-06-15): **token-URL access (no Bearer)**, **names masked to first-name + last-initial**, **email/phone never exposed**.

### Migration 050 (additive — 049 already applied to shared DB, so a NEW file)
```sql
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS public_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS public_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_campaigns_public_token ON campaigns(public_token) WHERE public_token IS NOT NULL;
```
Do NOT apply to shared DB — Opus applies after review (same as 049).

### Public endpoint — `src/app/api/public/campaigns/[token]/leaderboard/route.ts`
- **GET, no auth.** CORS enabled (`Access-Control-Allow-Origin: *`, GET/OPTIONS) + an `OPTIONS` handler (mirror `/api/public/submit`).
- **Rate-limit** by IP (reuse `checkRateLimit`; add a `PUBLIC_READ_LIMIT`, e.g. 60/min).
- Look up campaign via `createServiceClient` WHERE `public_token = token AND public_enabled = true`. Not found/disabled → **404** (don't leak existence). No auth context → this is the one justified service-client read; it only ever touches the single token-matched campaign + its own form data.
- **Read STORED results only — do NOT call ESPN here** (freshness comes from admin refresh; keeps the public path fast + abuse-proof). Load `campaign_results` + `lead_submissions` (by `form_config_id`), run the SAME `scoreSubmissions` lib.
- **Mask before returning** — map each standing to `{ rank, name, correct, scored, pct }`:
  - `name` = first token + last token's initial (`"Milan Kunwar"` → `"Milan K."`; single-word → as-is).
  - **PII guard:** if the entry's name is empty OR contains `@` (scoring falls back to email when no name) → render `"Participant"`. NEVER emit email/phone/picks.
- Response: `{ campaign:{name,status}, updated_at:max(fetched_at), standings:[…masked], results:[{match_label, score, outcome, status}], pending_matches:[…] }`. Support `?limit=` (default all, hard cap 500).
- `Cache-Control: public, s-maxage=60, stale-while-revalidate=300`.

### Admin config — `PATCH /api/v1/campaigns/[id]` (same gate stack as the other routes)
- Body `{ public_enabled?: boolean, regenerate_token?: boolean }`.
- Enabling with no token, or `regenerate_token` → generate a fresh URL-safe random token (`crypto.randomUUID()`).
- `scopedClient` update **with caller filter** `.eq("id", id)` (guardrail). Return `{ public_enabled, public_token }`.

### Gear popup (admin-only) in `campaign-detail.tsx`
- Gear icon button next to "Refresh results" → shadcn `Dialog`:
  - Toggle **"Public leaderboard"** (PATCH `public_enabled`).
  - When on: show the URL `${window.location.origin}/api/public/campaigns/${token}/leaderboard` + copy button (origin auto-resolves dev vs edgex).
  - **"Regenerate token"** (with confirm — breaks the old URL).
  - Collapsible example response (static sample JSON) so the dev sees the shape.

### Known limitation (note in code + catalog)
Public page freshness is tied to admin "Refresh results" (no cron in v1) — fine for the World Cup (admin refreshes once the last 2 matches finish). A cron is a later option.

### Verify (add to smoke matrix)
- Enable public in the gear popup → hit the public URL unauthenticated (curl + from a different origin) → 200, masked names ("Milan K."), **no email/phone/picks** in the payload, CORS header present.
- Toggle off → public URL 404s. Regenerate token → old URL 404s, new one works.
- Entry with no name → shows "Participant", not an email.

---

## Phase 1.6 — "Agent prompt" in the gear dialog (LLM-ready integration handoff)

**Small, client-side-only addition.** Lets an admin copy a **task-loaded prompt** (not just the URL) to hand the website dev's AI coding agent, so it understands the API shape + semantics and builds the integration correctly first time. On-brand for the AI-native product.

### Shared helper — `features/campaigns/lib/agent-prompt.ts`
Export `buildAgentPrompt({ url, campaignName }: { url: string; campaignName: string }): string` returning the template below with `{url}` and `{campaignName}` injected. **Co-locate a sync note**: add a comment at the top of both `agent-prompt.ts` and `src/app/api/public/campaigns/[token]/leaderboard/route.ts` — "⚠️ If you change the public response shape, update the other file" — so the prompt can't silently drift from the API.

Template (task-loaded — keep the en-dash in the score example, match the real field set exactly):
```
You are integrating a public, read-only prediction leaderboard into a website.

API (no auth, CORS-enabled, browser-safe):
GET {url}
Optional: ?limit=N (max 500). Responses cached ~60s — poll at most once/min.

Response JSON:
{ "data": {
  "campaign": { "name": string, "status": "active"|"final" },
  "updated_at": string|null,   // ISO; when results were last refreshed (may lag live matches)
  "standings": [ { "rank": number, "name": string, "correct": number, "scored": number, "pct": number } ],
  "results":   [ { "match_label": string, "score": string|null, "outcome": "team_a"|"team_b"|"draw"|null, "status": "final"|"scheduled" } ],
  "pending_matches": [ { "match_id": string, "match_label": string } ]
}}

Semantics:
- standings are pre-sorted best->worst by `correct`, tie-broken by accuracy. `name` is already
  privacy-masked (first name + last initial) - there is NO email/phone. `scored` = finished
  matches counted; `pct` = accuracy %.
- results: `outcome` team_a/team_b = first/second team in `match_label`; `score` like "2-0" or null.
- pending_matches non-empty => standings NOT final yet.

Task: build a responsive "{campaignName}" leaderboard - standings table (rank, name,
correct/scored, %), top-3 emphasized; a results list; a "pending matches" banner; a "last
updated" stamp from updated_at. Handle loading/empty/error states. Re-fetch every 60s. Don't
assume fields beyond the above.
```

### UI — in the gear `Dialog` (`campaign-detail.tsx`)
- Add a collapsible **"Agent prompt"** section (below "Example API response shape"), shown only when public is enabled + a token exists.
- Render the generated prompt in a monospace block + a **Copy** button (reuse the existing copy pattern).
- Build the prompt from the **same canonical base** the URL field uses: `const base = process.env.NEXT_PUBLIC_APP_URL || window.location.origin;` → `buildAgentPrompt({ url: \`${base}/api/public/campaigns/${campaign.public_token}/leaderboard\`, campaignName: campaign.name })`.

### Verify
- Enable public → open "Agent prompt" → Copy → confirm it contains the **edgex** URL (not localhost in prod), the campaign name, and the full response schema. No secrets beyond the (already-public) token.

---

## Guardrails (READ — non-negotiable)

- **Branch off `stage`.** Do NOT merge to stage or main. Do NOT apply the migration to any shared DB. **STOP at the review gate** and hand back to Opus — implementation only. (History: Sonnet has self-merged + applied migrations against explicit stop-at-review briefs; do not.)
- New tables: `tenant_id` FK + RLS using the SECURITY DEFINER helpers. New routes: `authenticateRequest` + `getFeatureAccess` + admin check + `scopedClient`.
- Sidebar icon is a **string**, registered in `INDUSTRY_ICONS`. Manifest entries are serializable (no component imports).
- `scopedClient.update/delete` always need a caller filter beyond tenant_id.
- Verify before handing back: `npm run build` clean; `npx eslint --max-warnings 50` clean; manual `npm run dev` against a **local/throwaway DB** (NOT the shared Supabase) with the migration applied there.
- Update `docs/FEATURE-CATALOG.md` with the Campaigns row.

## Verification matrix (for Sadin's smoke after Opus review)
1. As **Admizz admin**: "Campaigns" nav visible → `/campaigns` lists World Cup → open it → leaderboard renders, Milan Kunwar top (8/12 as of 12 final matches), 2 pending matches flagged.
2. "Refresh results" after the 2 pending matches go final → standings update, pending banner clears.
3. As **Admizz counselor/viewer**: no Campaigns nav; `/campaigns` 404s; API 403.
4. As **non-education tenant** (Zunkireelabs admin): no nav; `/campaigns` 404; API 403.
5. Results table shows ESPN source + locked badge; a locked result isn't overwritten by a refresh.
6. (Phase 2) Admin override changes a result + re-ranks; integrity flags show the Prajapati cluster.
