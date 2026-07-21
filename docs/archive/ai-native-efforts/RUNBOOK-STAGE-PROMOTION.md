# Runbook — Promote AI Foundation (Phases 1–3) to STAGE

**From:** Opus planner · **Date:** 2026-07-17 · **Status:** WRITTEN, not yet executed.
**Do not run any step without Sadin's explicit go.** Prod is NOT in scope here (privacy gate).

## What ships

Branch `feature/ai-assistant-foundation` (25 commits ahead of origin/stage). **Scope note —
this branch was cut from `feature/real-estate-vertical`, so promoting it brings BOTH:**

- Real-estate vertical (offerings, commitments, funnel; migrations 164–167) — its human visual
  pass is still owed; it lands on stage as a side effect of branch ancestry.
- AI foundation: assistant (1A–1C), knowledge layer (2A–2C), industry packs (3A–3B, RE + education
  packs); migrations 168–170.

Pending migrations for the stage DB (`dymeudcddasqpomfpjvt`), applied automatically by the
staging pipeline's `migrate` job in filename order: **164, 165, 166, 167, 168, 169, 170**
(plus stage's own 156–163, already merged into the branch). All additive, each with rollback
notes in-file, ledger-tracked (`schema_migrations`).

## Phase 0 — pre-flight (code, executor work — brief: `BRIEF-STAGE-PREFLIGHT.md`)

> **2026-07-17 update:** origin/stage independently added migrations numbered 156–163, colliding
> with all seven of ours. Pre-flight RENUMBERED our migrations to **164–170** (done — see the
> brief and the executor report). Every "156–162" below has been updated to "164–170".

1. **Heap bump (real risk, found 2026-07-17):** local builds now OOM on default heap and need
   `--max-old-space-size=6144`. Affected build environments:
   - `Dockerfile` line 18: `NODE_OPTIONS="--max-old-space-size=4096"` → bump to `6144`
     (GHCR build job runs on a 7 GB runner; 6144 fits).
   - `ci.yml` (`npm run build` line ~113, `tsc --noEmit` line ~75) and the `checks` jobs in
     `deploy-staging.yml`/`deploy.yml` (`tsc --noEmit`): add
     `NODE_OPTIONS: --max-old-space-size=6144` env. tsc was the step that OOM'd locally.
2. **Rebase onto latest `origin/stage`** (currently 18 commits behind). Per DEV-WORKFLOW rules:
   conflicts on shared files (`shell.tsx`, leads routes, `package.json`/lockfile) resolved
   hunk-by-hunk, never keep-whole-file. After rebase, re-run the full gate set locally
   (build 6144 / lint / vitest) before opening the PR.
3. **ESLint warning budget check:** pipeline runs `npx eslint --max-warnings 50`; we're at 47
   pre-existing warnings. Confirm the rebased branch stays ≤50 or the deploy checks fail.

## Phase 1 — stage VPS env (Sadin or Opus-with-go; no rebuild needed, all runtime vars)

Append to `/home/zunkireelabs/devprojects/lead-gen-crm-dev/.env.local` (container reads it via
`env_file`; picked up on the deploy's `docker compose up -d`):

```
OPENAI_API_KEY=<same key as local, or a separate stage key if Sadin prefers>
AI_ASSISTANT_ENABLED=true
AI_INGESTION_ENABLED=true            # stage only — data is the sanitized clone; prod stays OFF (privacy gate)
INNGEST_EVENT_KEY=<Sadin's key, in Opus memory 2026-07-17>
INNGEST_SIGNING_KEY=<Sadin's signkey-prod-..., same place>
LANGFUSE_PUBLIC_KEY=pk-lf-7cf0d561-3981-462a-aece-9d082e4f80bf
LANGFUSE_SECRET_KEY=<sk-lf-..., same as local .env.local>
LANGFUSE_BASE_URL=https://cloud.langfuse.com
# AI_DAILY_OUTPUT_TOKEN_BUDGET=200000   # optional, this is the default
```

Do NOT set `INNGEST_DEV` on stage. NEXT_PUBLIC_* vars unchanged (same stage Supabase project).
Note: the Inngest keys are from the account's default (production) Inngest environment — fine to
start; consider a dedicated Inngest env per deploy environment later.

## Phase 2 — PR → stage (the pipeline does the rest)

1. `gh pr create --base stage` from the rebased branch. CI must be green (watch the build/tsc
   steps for OOM — that's what Phase 0.1 prevents).
2. Squash-merge. Push to `stage` triggers `deploy-staging.yml`:
   checks → GHCR image build → **migrate job applies 164–170 to the stage DB** → SSH deploy
   (`docker compose pull && up -d`) → container health + `/login` 200 check.
3. **Watch the migrate job log specifically at 169** — it runs `CREATE EXTENSION IF NOT EXISTS
   vector`. This should succeed as the `postgres` role on hosted Supabase; if it errors, enable
   the extension once via Supabase Studio (stage project → Database → Extensions → vector), then
   re-run the failed job. The script is safe to re-run (ledger + ON_ERROR_STOP; committed files
   stay recorded).

## Phase 3 — post-deploy verification on `dev-lead-crm.zunkireelabs.com`

1. **DB:** `schema_migrations` has 164–170; `\dx` shows vector; `knowledge_chunks` +
   `knowledge_hybrid_search` exist; RLS on.
2. **Assistant streams through Traefik (SSE buffering check):** log in (any stage user,
   password `edgexdev123`), open the sparkle panel, ask anything — the reply must render
   INCREMENTALLY, not appear all at once after a wait. (Traefik doesn't buffer by default;
   this check confirms it. If it buffers: add `flushInterval` middleware — deal with it then.)
3. **Tools + tenancy:** as an Admizz user ask an applications question (education pack live on
   real-ish sanitized data); as a Zunkiree (it_agency) user confirm no education/RE tools fire.
4. **Ingestion end-to-end:** FIRST register the app in the Inngest Cloud dashboard — sync URL
   `https://dev-lead-crm.zunkireelabs.com/api/inngest` — then upload a small docx to a Knowledge
   Base and watch pending → ready + chunk_count; ask the assistant about its content → citation
   chip. If items stick at `pending`, check the Inngest dashboard run log first (signing key
   mismatch is the classic cause).
5. **Langfuse:** trace for the stage chat turn appears in cloud.langfuse.com (~30–60 s lag).
6. **Regression sweep:** leads / pipeline / team / forms pages load for an education tenant and
   an it_agency tenant; no errors in `docker logs leads-crm-dev`.

## Rollback

- Code: revert PR (roll-forward preferred) or `rollback.yml` (CODE ONLY — announce first).
- DB: migrations are additive; each file 164–170 carries its own rollback statements. Assistant
  can be disabled instantly without any deploy: set `AI_ASSISTANT_ENABLED=false` (+
  `AI_INGESTION_ENABLED=false`) in the VPS `.env.local` and `docker compose up -d`.

## Out of scope (later, separate runbook)

Prod promotion: blocked on the privacy gate (zero-retention evidence, OpenAI DPA + sub-processor
disclosure, Admizz consent) and its own approval-gated migrate job in `deploy.yml` (which EXISTS
now — CLAUDE.md's "main has no migration step" is stale; still verify per-file before approving).
Rollout order for prod ingestion: Zunkiree → Mobilise → Admizz last.
