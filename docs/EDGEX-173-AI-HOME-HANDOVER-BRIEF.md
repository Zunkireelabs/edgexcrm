# Handover: `feature/EDGEX-173-ai-home` to Hardik (2026-11-19)

From the EDGEX-87 Home lead (Opus). This branch is now the ONE working branch for the education UI v2 + Home/AI work. Read this whole file before you touch it.

## 1. What this branch holds
About 236 commits ahead of `origin/stage`. Everything is local-verified, but **none of it is on stage yet**.

| Area | Tickets | State |
|---|---|---|
| Pulse + Design System v2 (ds- tokens, primitives), global shell, Phosphor icons (lucide removed) | EDGEX-82/85/86/94 | done |
| Design System v2 spec + Pulse v4/v5 mockups + Pulse v5 build brief (`docs/design-system/`) | EDGEX-84 | docs, cherry-picked in |
| Leads toolbar + table v2 | EDGEX-115/146/149 | done |
| Lead detail v1 (the education lead page `lead-detail-edu.tsx`) | EDGEX-89, 159, 163 | done |
| Applications board, phases 1–5 (desktop + phone) | EDGEX-141, 169, 170 | done |
| Education Home (counsellor / branch manager / owner), Orca's read, call prep, message drafts, "Prepare all" batch, impact card | EDGEX-87, 177, 178 | done, see section 4 |
| Stage #668–#676 merged in, behaviour ported into lead detail v1 | EDGEX-173 | done |

The old `feature/EDGEX-173-ui-v2` branch is deleted. It was fully inside this branch. `feature/EDGEX-84-design-system-v2` is now redundant too (its 4 commits are here).

## 2. YOUR JOB BEFORE THIS BRANCH GOES TO STAGE (must all be done)
Sadin's rule: **every feature and fix that lands on stage must also work on this branch before it goes to stage.** Stage keeps moving. Do this right before you open the PR, and again if stage moves while the PR is open.

1. **Bring stage in.** `git fetch origin && git merge origin/stage`. Use a merge, not a rebase; the branch is too long to rebase. At handover the branch is **2 commits behind** stage:
   - #678 "Manish's Nov 18 fixes": collaborator names in Activity, archived leads re-registering go to New, moving into new stages (`revive-archived.ts`, `ensure-list-pipeline.ts`, `activities-panel.tsx`, public submit route, `apply-lead-patch.ts`).
   - #679 Collaborators filter "is none of" (`collaborator-split.ts`, `visibility-query.ts`, `filters/registry/leads.ts`, leads route) + **migration 282**.
2. **MIGRATION NUMBER CLASH, fix it in the same PR.** Stage now owns `282_leads_collaborator_none_of_filter.sql`. This branch has its own `282_education_home_a1.sql` … `292_home_reads_opened.sql` (11 files: 282–292), and `280_education_pulse.sql` (no clash). One number = one file, globally (see `docs/dev-collab/DEV-WORKFLOW-AND-DEPLOYMENT.md`).
   - `git mv` this branch's **282–292 → 283–293** in the same order. Check `ls supabase/migrations | sort` on the merged tree first; if stage took more numbers by then, shift further.
   - None of this branch's migrations are on the stage or prod DB yet, so renumbering is safe. Don't touch stage's 282.
   - Grep for the old file names in tests/docs (`grep -rn "28[2-9]_\|29[0-2]_" src docs scripts`) and update them.
3. **Port, don't just merge.** Stage still edits the OLD lead page components (`src/components/dashboard/lead/*`, `lead-detail-v2.tsx`). Education tenants render the NEW `src/industries/education-consultancy/features/lead-detail/lead-detail-edu.tsx`. When a stage change lands in an old component, rebuild the same behaviour in the v1 component (look and feel of v1: `rounded-[Npx]` only, Phosphor icons). The #668–#676 port in commit `d0ee27dd` and fix `446862bc` are the pattern. Watch #678's Activity collaborator names: the v1 Activity tab must show them too.
4. **Resolve conflicts hunk by hunk.** Never "take ours/theirs" on a whole file. Shared hot files: `shell.tsx`, `leads/route.ts`, `leads/queries.ts`, `filters/registry/leads.ts`, `apply-lead-patch.ts`.
5. **Gates, all green:**
   - `npx tsc --noEmit`;
   - `npx eslint . --max-warnings 50` (49 today; there is ONE warning of headroom, so add none);
   - full vitest without the DB-backed files: build the exclude list with `grep -rlE "requireLocalDbInCi|localRawClient|127\.0\.0\.1:54|localhost:54" src scripts --include='*.test.ts' --include='*.test.tsx'`. A lone 5s timeout under load: re-run that file alone;
   - `npm run build`.
   At handover (commit `d6d4c3db`): tsc 0, eslint 49, vitest 693 files / 7458 tests pass.
6. **Verify on local dev, in the browser**, as owner, branch manager, counsellor and collaborator: the lead page (section 3) and Home (section 4). A screenshot or it didn't happen.
7. **Then** the PR to `stage`. Stage needs 1 other human's approval. Don't merge your own PR, and don't push without Sadin's OK.

## 3. Lead page rules (QC'd 2026-11-19, keep them true)

| Who | Status | Send to next / Move to / Archive | Collaborators | Email & phone in Edit profile |
|---|---|---|---|---|
| Owner / admin | yes | yes | add + remove anyone | editable |
| Branch manager (team scope) | yes | yes | add + remove (server checks own branch) | editable |
| Assignee | yes | yes | can't change | editable |
| Collaborator (not assignee) | **yes** | **no** (server 403 "A collaborator cannot edit this field") | remove **themselves** only | **locked** |

Gate code: `lead-detail/lib/work-gates.ts` (`canWork` vs `canStatus`), `lead-detail/lib/details-model.ts` (`collaboratorControls`, `canRemoveCollaborator`).

## 4. Home / AI state
- **Message drafts:**
  - 25 live eval sets: first-try 82–96%, final 100%, 0 empty cards, skip decisions 25/25.
  - On real Admizz leads (thin notes) all drafts come back.
  - Checks are split into SAFETY (number, time word, pronoun in the text, skip quote/reason → card blocked) and STYLE (stock phrases, length, sentences, name repeat → retry once, then shown and logged `shown_with_style_flags`).
  - Live eval: `export $(grep -E "^(OPENAI_API_KEY|AI_PROVIDER)=" .env.local | xargs)` then `RUN_LIVE_DRAFT_EVAL=1 npx vitest run src/industries/education-consultancy/features/home/ai/draft.live-eval.test.ts` (costs OpenAI credit; never print the key).
- **Orca's read** drops filler words in code and drops any point that only repeats what Home already shows (rows + the "Your last 7 days" card). On the 10-day-old local copy every number is already on screen, so the reads for owner, BM and Gautam came back with **0 points (the card hides)**. That's correct for the data, but **a useful point has not been seen live**. `needs-verification`: check reads on fresh stage data after the merge; if real reads are always empty, loosen `repeatsRows` in `home/lib/orca-read.ts` (EDGEX-178).
- Thin-note drafts all share one shape ("You're interested in studying X in Y: have you…?"). That's acceptable; variety would be a prompt change.
- `draft.live-eval.test.ts` is skipped unless `RUN_LIVE_DRAFT_EVAL=1`. Keeping it is fine.

## 5. Open tickets (Plane, project EDGEX)
- **EDGEX-179**: lead page right rail cuts off Consent & fee text ("Not recorde", "5 fields m") at 1440. A UI v2 leftover, not from the merge.
- **EDGEX-178** (Orca's read rework, high): fixed in code, needs the live check on stage data (section 4).
- **EDGEX-177** (duplicate React key): fixed.
- **EDGEX-171** (high): a brief Supabase connection failure signs users out (`src/lib/supabase/middleware.ts` treats a `getUser()` error as "no user"). Locally you get signed out every few minutes under load.
- EDGEX-172 (leads API 503 past the last page), EDGEX-164 (dev-only radix hydration warning, harmless), EDGEX-165 (needs DB), EDGEX-167 (application PATCH 200 on empty body), EDGEX-168 (`next build --webpack` fails on ai/chat route; Turbopack passes).
- EDGEX-169 / 170 / 177 / 178 → move to In Review when the PR opens.

## 6. Running it locally
- Local Supabase (OrbStack) for project `edgexcrm` on :54321 / :54322. Other projects' stacks (e.g. "zone") use the same ports, so stop theirs first (`docker stop $(docker ps --format '{{.Names}}' | grep _zone$)`). If `supabase_db_edgexcrm` fails to start because of a port clash, it can lose its network: `docker network connect --alias db --alias supabase_db_edgexcrm supabase_network_edgexcrm supabase_db_edgexcrm`, then restart auth/rest/storage/realtime/kong.
- Dev server: `RESEND_API_KEY=re_fake_local_only npm run dev -- -p 3001`. **RESEND must be fake**: assignment emails from the local copy have reached real Admizz staff before.
- Local copy = Admizz (tenant `febeb37c-521c-4f29-adbb-0195b2eede88`). Password `edgexdev123` for every user:
  - owner `manish.sah@admizz.com`;
  - branch manager `bijay.dahal@admizz.org`;
  - counsellors `kamana.admizz@gmail.com`, `gautam.ray@admizz.org`.
  - Collaborator test: Kamana on lead Sneha Sah `a058291c-1338-4234-aac7-462e612806c2`.
- Seed tenant logins for the test DB are in `scripts/seed-education-local.sh`.

## 7. Hard rules
- **No database access** of any kind from a session (no SQL, no migrations by hand, no Supabase MCP writes). Migrations reach stage/prod only through the deploy pipelines.
- No push and no PR without Sadin's word; never merge to `main`; `stage` first.
- `rounded-[Npx]` only (the theme inflates `rounded-md/lg/xl`). Phosphor icons only.
- The approved mockup wins (`docs/design-system/mockups/`, the lead-detail and applications mockups).
- New work found mid-task becomes a Plane ticket, not scope creep.
- Never commit the logo/favicon edits sitting uncommitted in Sadin's main checkout.
