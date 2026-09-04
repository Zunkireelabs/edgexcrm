# BRIEF — Multi-Branch Lead Sharing (call sign: BRANCH-SHARE)

**For:** Sonnet (executor) · **Reviewer:** Opus (Sadin approves prod) · **Approved plan:** `~/.claude/plans/now-uunderstand-this-senario-quirky-catmull.md`

This is a **multi-phase** feature. **Build ONLY Phase 0 (P0) right now.** P1–P4 are outlined at the bottom for context but are **out of scope** until they get their own briefs after each review gate. Do not start them.

---

## Feature in one paragraph
Admizz (education_consultancy, Enterprise) runs multiple branches. Today a lead belongs to ONE branch (`leads.branch_id`). The client wants leads **shared into multiple branches at once** — a Birgunj lead can be *sent* to KTM/Janakpur and still **stay** in Birgunj; any branch → any branch; **each branch assigns its own counselor**; every share/revoke/assignment is logged to the lead's Activity trail. This requires a lead↔branch membership table and (later phases) a rewrite of the lead-scoping path. The whole feature is **gated on `entitlements.maxBranches > 1`** and must be **byte-identical for single-branch tenants**.

---

## Hard rules (every phase)
- **Industry/plan reality:** this is Enterprise multi-branch (Admizz). It MUST be inert for single-branch tenants.
- **Shared DB:** dev + prod share ONE Supabase DB. **Write the migration file only — DO NOT apply it.** Sadin/Opus apply after review.
- **STOP at review:** build P0 on a branch off `stage`, run gates, hand back the diff. No push, no merge, no migration apply. (You have overstepped review gates before — don't.)
- **Tenant isolation:** any future query touching `lead_branches` must always carry `tenant_id`. (Relevant in P1; keep it in mind.)

---

## P0 — Inert infrastructure (THE ONLY PHASE TO BUILD NOW)

Goal: ship the data foundation. **Zero behavior change** — no code reads `lead_branches` yet. After this, every existing branched lead has exactly one `is_origin` membership row; single-branch tenants are untouched.

### 1. Migration — `supabase/migrations/056_lead_branches.sql` (write only, additive, idempotent)

Follow the exact style of `052_branches.sql` / `049_campaigns.sql` (DO $$ IF NOT EXISTS guards for policies). Contents:

```sql
-- Migration 056: lead_branches (multi-branch lead sharing membership)
-- Additive + idempotent. Inert for single-branch tenants. Write only — Sadin applies (shared prod DB).

CREATE TABLE IF NOT EXISTS lead_branches (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  lead_id      UUID NOT NULL REFERENCES leads(id)    ON DELETE CASCADE,
  branch_id    UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  assigned_to  UUID REFERENCES auth.users(id)        ON DELETE SET NULL,  -- per-branch counselor
  is_origin    BOOLEAN NOT NULL DEFAULT false,
  shared_by    UUID REFERENCES auth.users(id)        ON DELETE SET NULL,
  shared_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (lead_id, branch_id)
);

CREATE INDEX IF NOT EXISTS idx_lead_branches_branch   ON lead_branches(tenant_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_lead_branches_lead     ON lead_branches(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_branches_assignee ON lead_branches(assigned_to) WHERE assigned_to IS NOT NULL;
-- exactly one origin per lead
CREATE UNIQUE INDEX IF NOT EXISTS uniq_lead_branches_origin ON lead_branches(lead_id) WHERE is_origin;

ALTER TABLE lead_branches ENABLE ROW LEVEL SECURITY;

-- RLS mirrors branches (mig 052): select = tenant members; writes = tenant admins (defense-in-depth)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='lead_branches' AND policyname='lead_branches_select') THEN
    CREATE POLICY "lead_branches_select" ON lead_branches FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='lead_branches' AND policyname='lead_branches_insert') THEN
    CREATE POLICY "lead_branches_insert" ON lead_branches FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='lead_branches' AND policyname='lead_branches_update') THEN
    CREATE POLICY "lead_branches_update" ON lead_branches FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='lead_branches' AND policyname='lead_branches_delete') THEN
    CREATE POLICY "lead_branches_delete" ON lead_branches FOR DELETE USING (is_tenant_admin(tenant_id));
  END IF;
END $$;

-- Backfill: one origin row per already-branched lead. Idempotent via UNIQUE(lead_id,branch_id).
-- Leads with branch_id IS NULL get NO row (matches today's behavior). Skip soft-deleted leads.
INSERT INTO lead_branches (tenant_id, lead_id, branch_id, assigned_to, is_origin, shared_by)
SELECT l.tenant_id, l.id, l.branch_id, l.assigned_to, true, NULL
FROM leads l
WHERE l.branch_id IS NOT NULL
  AND l.deleted_at IS NULL
ON CONFLICT (lead_id, branch_id) DO NOTHING;
```

Verify against the real schema before finalizing: confirm `branches`, `get_user_tenant_ids()`, `is_tenant_admin()` exist (they do — mig 052), and that `leads.deleted_at` is the soft-delete column. If any helper/column name differs, match the real one.

### 2. TS type — `src/types/database.ts`
Add a `LeadBranch` interface next to `Branch` / `Lead`:
```ts
export interface LeadBranch {
  id: string;
  tenant_id: string;
  lead_id: string;
  branch_id: string;
  assigned_to: string | null;
  is_origin: boolean;
  shared_by: string | null;
  shared_at: string;
  created_at: string;
}
```
Do **not** add unused query helpers/components yet (would trip unused-var lint and isn't inert) — those land in the phase that consumes them.

### P0 acceptance
- [ ] `056_lead_branches.sql` written (additive, idempotent), **not applied**.
- [ ] `LeadBranch` type added.
- [ ] No other code changed — nothing reads `lead_branches`. App behavior unchanged.
- [ ] `npm run build` + `npx eslint . --max-warnings 50` (0 errors) + `npx tsc --noEmit` all clean.
- [ ] STOP — hand back the diff + a note confirming nothing reads the table yet. No push/merge/apply.

---

## Later phases (DO NOT BUILD — separate briefs after each review)
- **P1 — Read parity (security-critical):** rewrite `leadQueryScope` (`src/lib/api/permissions.ts`), `requireLeadAccess`/`requireLeadBranchAccess` (`src/lib/api/auth.ts`), the leads list route, single `GET [id]`, and SSR `queries.ts` to read membership but return *identical* results to today (every lead has one origin row). Add SECURITY DEFINER RPC(s) here (shape designed against the consumer). Preserve the §4.1 null-branch invariant verbatim. Update all ~10 `requireLeadAccess` sub-route callers. Fix the `getLead` detail-SSR branch-scope gap.
- **P2 — Writes:** `POST /leads/[id]/branches` (share, idempotent), `DELETE /leads/[id]/branches/[branchId]` (revoke, 422 on origin, admin-only), `PATCH /leads/[id]/branches/[branchId]` (per-branch assignee), `POST /leads/bulk/share`. Guards: admin = any; branch manager = leads their branch holds → any target branch, own-branch assign only. Audit + notifications + origin-column sync (`leads.assigned_to`/`branch_id` mirror the origin row).
- **P3 — UI:** lead-detail "Branches" section (per-branch assignee + revoke + Send-to-branch), bulk "Share to branch", activity-trail labels (`lead.branch_shared` / `lead.branch_revoked` / `lead.branch_assigned`, branch name stored in `changes`).
- **P4 — Cleanup:** repoint/deprecate the old overwrite "Assign to branch".

## Open item (resolve before P2, not P0)
Conversion of a shared lead sets `leads.converted_at` → removes it from *all* branches' active lists (whole-lead op). Confirm with Sadin this is desired before building P2's interaction with convert.
```
