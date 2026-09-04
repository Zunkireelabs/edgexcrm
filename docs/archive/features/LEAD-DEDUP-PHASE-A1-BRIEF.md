# Brief — Lead Dedup Phase A1: schema foundation

> **Executor:** Sonnet. **Reviewer/merger:** Opus (Sadin pastes this to Sonnet).
> **Parent design:** `~/.claude/plans/what-i-want-to-floofy-shore.md` (approved).
> **Scope of THIS brief:** migration `033` + `src/types/database.ts` ONLY. No API/UI/service
> code — that's Phases A2–A5. This phase is purely additive (new table + new columns +
> indexes); it changes no existing behavior.

## Why

The CRM mints a new `leads` row on every form submission → duplicates (same person,
same email, multiple leads). Phase A introduces lossless identity resolution. A1 lays the
**append-only `lead_submissions`** table (the no-data-loss backbone — every submission is
preserved verbatim so the canonical lead can be safely updated) plus the columns/indexes
that later phases need: a normalized-email column + a partial unique index (race backstop),
and the merge-support tables.

## HARD RULE — local DB only

**Do NOT apply this migration to the shared Supabase project (`pirhnklvtjjpuvbvibxf`).**
Apply it only to a LOCAL / throwaway Postgres for testing. Do NOT push the branch anywhere.
Stop at "migration written + types updated + builds clean + applies cleanly on a local DB."
Opus reviews the diff and runs the local verification before anything moves.

## Deliverable 1 — `supabase/migrations/033_lead_submissions.sql`

Follow existing conventions (see `002_phase1_5_foundation.sql`): `CREATE TABLE IF NOT
EXISTS`, `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, RLS via
`get_user_tenant_ids()` / `is_tenant_admin()`, service-role-only writes (no INSERT/UPDATE
policy). Write the SQL in this order:

### 1. `lead_submissions` (append-only — NO updated_at, NO update trigger)

```sql
CREATE TABLE IF NOT EXISTS lead_submissions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id           UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  form_config_id    UUID REFERENCES form_configs(id) ON DELETE SET NULL,
  session_id        VARCHAR(100),
  created_via       TEXT NOT NULL
                    CHECK (created_via IN ('public_form','public_api','integration','manual','backfill')),
  idempotency_key   VARCHAR(100),
  first_name        TEXT,
  last_name         TEXT,
  email             TEXT,
  phone             TEXT,
  city              TEXT,
  country           TEXT,
  normalized_email  TEXT,           -- trim+lowercase snapshot used for matching
  normalized_phone  TEXT,           -- digits+'+' snapshot (suggestions only)
  custom_fields     JSONB NOT NULL DEFAULT '{}'::jsonb,
  file_urls         JSONB NOT NULL DEFAULT '{}'::jsonb,
  intake_source     TEXT,
  intake_medium     TEXT,
  intake_campaign   TEXT,
  entity_id         UUID,           -- loose, NO FK (entity may be deleted)
  raw_payload       JSONB NOT NULL DEFAULT '{}'::jsonb,  -- verbatim inbound body = true no-loss
  matched_existing  BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_submissions_lead
  ON lead_submissions (lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_submissions_tenant_email
  ON lead_submissions (tenant_id, normalized_email) WHERE normalized_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lead_submissions_tenant_created
  ON lead_submissions (tenant_id, created_at DESC);

ALTER TABLE lead_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant members can view lead submissions" ON lead_submissions
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
-- No INSERT/UPDATE/DELETE policy — service role only writes (mirrors audit_logs).
```

### 2. `leads.normalized_email` generated column + race-backstop unique index

```sql
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS normalized_email TEXT
  GENERATED ALWAYS AS (lower(btrim(email))) STORED;

-- Auto-dedup correctness backstop: two concurrent NEW-email inserts → 2nd gets 23505.
-- Scoped to live, final leads only, so multi-step drafts (is_final=false) never collide.
CREATE UNIQUE INDEX IF NOT EXISTS uq_leads_tenant_norm_email
  ON leads (tenant_id, normalized_email)
  WHERE normalized_email IS NOT NULL AND deleted_at IS NULL AND is_final = true;
```

> ⚠️ **Pre-flight (note in the migration as a comment):** this partial unique index will
> FAIL to create if the table already contains duplicate (tenant_id, normalized_email)
> live+final rows — which is exactly our current state (the 4 sadins). On the LOCAL test
> DB that's fine if empty/clean. The real shared DB has dupes, so **this index cannot be
> created on shared data until Phase B backfill has collapsed existing dupes.** Therefore:
> keep the index statement in `033` for local/fresh installs, BUT it is understood the
> shared-DB application of `033` is deferred/split — Opus will decide the shared-DB
> sequencing (likely: apply the table + generated column now, create the unique index only
> after backfill). Do not attempt to resolve this yourself; just leave the clear comment.

### 3. Merge-support tables (used in Phase B; create now so the schema is complete)

```sql
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS merged_into UUID REFERENCES leads(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS lead_merges (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  canonical_id    UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  absorbed_id     UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  merged_by       UUID,                -- auth.users id, NULL for backfill
  source          TEXT NOT NULL CHECK (source IN ('manual','backfill')),
  repointed_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  field_patch     JSONB NOT NULL DEFAULT '{}'::jsonb,  -- exact patch applied → reversibility
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lead_merges_tenant ON lead_merges (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_merges_absorbed ON lead_merges (absorbed_id);

ALTER TABLE lead_merges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant members can view lead merges" ON lead_merges
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE TABLE IF NOT EXISTS lead_duplicate_suggestions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id           UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  suggested_lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  reason            TEXT NOT NULL CHECK (reason IN ('phone','name')),
  status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','dismissed','merged')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, lead_id, suggested_lead_id)
);
CREATE INDEX IF NOT EXISTS idx_lead_dup_suggestions_open
  ON lead_duplicate_suggestions (tenant_id, status) WHERE status = 'open';

ALTER TABLE lead_duplicate_suggestions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant members can view dup suggestions" ON lead_duplicate_suggestions
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
CREATE POLICY "Tenant admins can update dup suggestions" ON lead_duplicate_suggestions
  FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
```

## Deliverable 2 — `src/types/database.ts`

Add TypeScript types matching the above: `LeadSubmission`, `LeadMerge`,
`LeadDuplicateSuggestion`, and extend the existing `Lead` type with `normalized_email`
(string | null) and `merged_into` (string | null). Match the file's existing type style
(check how `KnowledgeBaseItem` / other recent tables are typed). Do not invent a new
pattern.

## Acceptance criteria (Sonnet self-check, all LOCAL)

- [ ] `033_lead_submissions.sql` written with the exact statements above (+ the deferred-index comment).
- [ ] Applies cleanly on a fresh LOCAL Postgres (empty leads → unique index creates fine).
- [ ] `npm run build` clean.
- [ ] `npx eslint --max-warnings 50` → 0 errors.
- [ ] `src/types/database.ts` compiles; new types exported.
- [ ] **Did NOT** touch the shared Supabase project; **did NOT** push the branch.
- [ ] No API/UI/service files changed (A1 is schema + types only).

## Sonnet handoff prompt

> Implement **Phase A1** of the lead-dedup design (`docs/LEAD-DEDUP-PHASE-A1-BRIEF.md`).
> Scope is migration `033` + `src/types/database.ts` ONLY — no API/UI/service code.
> Create `supabase/migrations/033_lead_submissions.sql` exactly per the brief (the
> `lead_submissions` append-only table with RLS mirroring `audit_logs`; the
> `leads.normalized_email` generated column + partial unique index with the deferred-index
> comment; and the `lead_merges` + `lead_duplicate_suggestions` tables + `leads.merged_into`).
> Add matching types to `src/types/database.ts`. Follow existing migration conventions
> (`IF NOT EXISTS`, the RLS helper functions). **Apply the migration to a LOCAL/throwaway
> Postgres only — NOT the shared Supabase project — and do NOT push the branch.** Stop after:
> migration applies cleanly on a clean local DB, `npm run build` is clean, and
> `npx eslint --max-warnings 50` reports 0 errors. Report what you changed and the local
> apply result; wait for review.
