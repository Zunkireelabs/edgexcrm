# Local Dev Setup — isolated database, in ~15 minutes

**Who this is for:** any developer (human or AI session) getting a working EdgeX dev environment on their machine. When you're done, `npm run dev` runs against your **own private Supabase** — schema-identical to stage, but with throwaway synthetic data you can wipe and reseed freely, touching nobody else.

> **Why this matters:** until 2026-07-08, "local dev" pointed at the shared **stage** database — so every experiment mutated data other people were testing against, and "test a migration locally" actually ran it on a shared remote DB. Now local is a real, isolated tier. See [`DEV-WORKFLOW-AND-DEPLOYMENT.md`](./DEV-WORKFLOW-AND-DEPLOYMENT.md) § 2 for where it sits in the pipeline (`local → stage → prod`).

---

## 1. Prerequisites (install once)

| Tool | Why | Install |
|---|---|---|
| **OrbStack** | Docker engine that runs the local Supabase containers | [orbstack.dev](https://orbstack.dev) — launch it once so Docker is running |
| **Homebrew** | package manager | [brew.sh](https://brew.sh) |
| **Node 22+** | the app | `brew install node` (or nvm) |
| **Supabase CLI** | spins up / manages the local stack | `brew install supabase/tap/supabase` |
| **psql** (PostgreSQL client) | apply/inspect migrations locally | `brew install libpq` then add to PATH, or `brew install postgresql@17` |

Verify:
```bash
docker version --format '{{.Server.Version}}'   # OrbStack running?
supabase --version                              # >= 2.x
node --version                                  # >= 22
psql --version
```

---

## 2. First-time setup

From the repo root:

```bash
# 1. Install app deps
npm install

# 2. Boot the local Supabase stack.
#    First run pulls several GB of images through OrbStack — give it a few minutes.
#    This loads the baselined schema + ledger + synthetic seed (NOT the migration history — see §5).
supabase start

# 3. Create the local login user + link it to the seeded tenant (idempotent).
./scripts/local-db-setup.sh
```

`supabase start` prints your local URLs and keys (also available anytime via `supabase status`):

| | |
|---|---|
| API | `http://127.0.0.1:54321` |
| DB | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |
| Studio (DB GUI) | `http://127.0.0.1:54323` |
| Mail catcher | `http://127.0.0.1:54324` |

### 3. Point the app at local — `.env.local`

`.env.local` is gitignored (it holds secrets), so a fresh clone won't have one. Get the full file from a teammate (for `RESEND_API_KEY`, etc.), then make sure the **Supabase block** is the **local** stack. The anon/service keys below are the standard Supabase-CLI **local demo keys** — identical on every machine, safe to commit to this doc:

```bash
# Supabase — LOCAL
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU
```

Keep a copy of the **stage** Supabase block in `.env.stage.local` so you can flip back (see §6).

### 4. Run it

```bash
npm run dev
```

Open `http://localhost:3000` → **log in**:

- **Email:** `admin@edgex.local`
- **Password:** `edgexdev123`
- Lands in tenant **Test Agency** (`it_agency`), owner role.

You're done. 🎉

---

## 3. Daily use

### Starting a new piece of work — resync local (do this every time)

Your local **schema** stays current the same way your **code** does: teammates' schema changes are committed as migration **files**, so `git pull` brings them, and you apply the new ones to your local DB with one command.

```bash
# 1. Latest code + any new migration files teammates merged
git fetch origin && git switch -c feature/<name> origin/stage   # (or rebase your branch onto origin/stage)

# 2. Bring your local DB up to date — applies any migration files not yet in your local ledger.
#    Same script CI uses for stage/prod; idempotent; does nothing if you're already current.
supabase start                     # ensure the stack is up
scripts/migrate-apply.sh local     # add --dry-run first to preview what would apply

# 3. Work
npm run dev
```

That's the loop: **`git pull` → `migrate-apply.sh local` → `npm run dev`.** You are applying the *exact same migration files* that will run on stage and prod — so if it applies clean locally, you've genuinely de-risked it.

> **When to refresh the baseline instead:** `migrate-apply.sh local` covers the normal case (new migration files). Do a full **baseline refresh** (§5) only occasionally — e.g. after a large batch of history landed, if your local drifted, or someone changed the schema on stage *out-of-band* (not via a migration file, which shouldn't happen but does). Baseline refresh = "resnapshot stage's whole schema"; `migrate-apply.sh local` = "apply the new deltas."

### Stop / start

```bash
supabase start        # bring the stack up (fast after the first image pull)
supabase stop         # stop containers, KEEPS your data
```

- **Studio** (`http://127.0.0.1:54323`) is your local DB browser — inspect rows, run SQL, no risk.
- **Emails** the app sends locally are caught by Mailpit at `http://127.0.0.1:54324` (nothing leaves your machine).

### Wipe & reseed (start clean)
```bash
supabase stop --no-backup     # drops the local DB volume
supabase start                # rebuilds schema + ledger + seed from scratch
./scripts/local-db-setup.sh   # recreate the login user
```

---

## 4. Testing a new migration locally

Local **does not replay the migration history** (§5), so you test a new migration by applying **just your new file** on top of the baseline — exactly the delta stage/prod will apply.

```bash
# 1. Author supabase/migrations/NNN_your_change.sql from _TEMPLATE.sql
#    (additive, idempotent, ends with its self-record INSERT — see SOP §5 Authoring).

# 2. Apply it to local — same command as the resync loop; picks up your new file, self-records it:
scripts/migrate-apply.sh local          # --dry-run first to confirm it sees exactly your file as pending

# 3. Verify in the app (npm run dev) as a real logged-in user — RLS only shows up under a real JWT.

# 4. Confirm it recorded:
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  -c "select version from public.schema_migrations order by version desc limit 3;"
```

If it applies clean locally it will apply clean on stage — that's the whole point of the isolated tier.

If it applies clean locally, PR it to `stage` — CI applies it to the stage DB on deploy, and the prod gate applies it at promotion (SOP § 5 & 6). **Never** skip a tier.

---

## 5. Why the schema is *baselined*, not *replayed* {#why-baseline}

`supabase db reset`/`start` would normally replay every file in `supabase/migrations/` from `001`. **That doesn't work on this repo** — and that's a known, deliberate accommodation, not a bug:

- Migrations `009` and the whole Admizz/RKU/Agentics ETL series (`069`–`096`) contain **one-time production data operations** — hardcoded prod tenant UUIDs, FKs to prod-only rows, and prod-specific assertions like `RAISE EXCEPTION 'Expected 83 rows, got %'`. On an **empty** DB those abort immediately.
- So local **baselines the schema from stage** instead: `supabase/baseline/schema.sql` is a schema-only dump of stage (all tables, RLS, functions), `baseline/ledger.sql` marks the historical migrations as already-applied, `baseline/reference.sql` seeds the `industries` lookup, and `supabase/seed.sql` adds the synthetic tenant. `config.toml` sets `[db.migrations] enabled = false` and points `[db.seed]` at these files, in order.
- **Consequence:** don't expect `supabase db reset` to run the migration chain — it loads the baseline + seed. New migrations are tested per §4.

This is why the SOP now forbids putting one-time data ETL in numbered migrations (SOP § 5 Authoring, "One-time data ETL does NOT belong in a numbered migration"). Migrations are schema; data loads go in `scripts/`.

### Refreshing the baseline (when stage schema has moved on)

Your local schema is a snapshot. After a batch of migrations lands on stage, refresh so local doesn't drift:

```bash
# Stage connection string is in CLAUDE.md § Credentials (STAGE_DB_URL).
STAGE="postgresql://postgres:...@db.dymeudcddasqpomfpjvt.supabase.co:5432/postgres"

supabase db dump --db-url "$STAGE" -f supabase/baseline/schema.sql          # refresh schema
psql "$STAGE" -tAc "select 'INSERT INTO public.schema_migrations(version) VALUES '||string_agg('('||quote_literal(version)||')',E',\n       ' order by version)||E'\nON CONFLICT (version) DO NOTHING;' from public.schema_migrations" > /tmp/led && \
  { echo '-- Backfill: migrations already applied on stage.'; cat /tmp/led; } > supabase/baseline/ledger.sql   # refresh ledger

supabase stop --no-backup && supabase start && ./scripts/local-db-setup.sh   # rebuild local
```
Commit the refreshed `supabase/baseline/*.sql` so the whole team gets the current schema. (`schema.sql` is pure DDL — no rows, no PII.)

---

## 6. Flip between local and stage

The app follows whatever `.env.local` points at.

```bash
# Work against LOCAL (default): ensure .env.local has the local Supabase block (§2.3).
# One-time: save your stage block so you can return to it.
cp .env.local .env.stage.local        # if .env.local currently holds stage creds

# Switch the app to the STAGE DB (e.g. to reproduce something with real-ish data):
cp .env.stage.local .env.local        # then restart `npm run dev`
```
Both files are gitignored (`.env*`). **Prefer local** for day-to-day; only point at stage when you specifically need hosted/shared data — and remember stage is shared, so tread lightly.

---

## 7. Troubleshooting

| Symptom | Fix |
|---|---|
| `supabase start` hangs / "cannot connect to Docker" | OrbStack isn't running. Launch it, wait for the whale icon, retry. |
| Port `54321/54322/3000` already in use | Another stack/app is up. `supabase stop` (or `lsof -ti:3000 \| xargs kill`), then retry. |
| `supabase start` errors during "Seeding data…" | A `supabase/baseline/*.sql` or `seed.sql` problem. Read the exact `ERROR:` line; if you just refreshed the baseline, re-check that step. `supabase stop --no-backup` and retry. |
| Login fails / no tenant after login | You skipped `./scripts/local-db-setup.sh`, or reseeded without re-running it. Run it. |
| App loads but data is empty | Expected — the seed is a single synthetic `it_agency` tenant. Add rows via Studio, or extend `supabase/seed.sql`. |
| `psql: command not found` | Install the client (§1) and ensure it's on your PATH. |
| Changes to a migration didn't take | Local doesn't replay history. Apply your file directly (§4); don't rely on `supabase db reset`. |

---

**See also:** [`DEV-WORKFLOW-AND-DEPLOYMENT.md`](./DEV-WORKFLOW-AND-DEPLOYMENT.md) (the full SOP — branch/PR/migration/deploy discipline) · `CLAUDE.md` § Credentials (connection strings) · `supabase/config.toml` (the local config) · `scripts/local-db-setup.sh`.
