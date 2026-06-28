# LEAD LISTS — Build Brief (Phase 3: provisioning) · for Sonnet, STOP-AT-REVIEW

**Branch:** create `feature/lead-lists-phase-3` off the **latest `origin/stage`** (Phases 1, 2, and the column fixes are all merged there). Work only on that branch.
**Scope:** `education_consultancy` only. it_agency / other industries must stay byte-for-byte unaffected.
**Context:** Lead Lists Phases 1+2 are live on stage/dev (lifecycle lists, move-to-list, qualify flow, list manager). The counsellor data cleanup is already done. This brief closes the two **provisioning gaps**. Plan/rationale: `~/.claude/plans/now-what-we-need-enchanted-parrot.md`; earlier briefs: `docs/LEAD-LISTS-BRIEF.md`, `docs/LEAD-LISTS-PHASE-2-BRIEF.md`.

---

## 🛑 HARD GUARDRAILS — read first
1. **STOP AT REVIEW.** Build, commit to the branch, then **STOP and report**. Do **NOT** `git push`, open a PR, or merge. Do NOT create the branch on top of an unmerged branch — base it on `origin/stage`.
2. **CODE-ONLY. NO MIGRATION, NO DB WRITES.** No SQL, no Supabase MCP, no psql. The `lead_lists` table + `leads.list_id` already exist on the shared DB.
3. Commit **Part 1 and Part 2 as separate commits** so each is reviewable.
4. Before reporting, run and paste output of `npm run build` **and** `npx eslint --max-warnings 50`. Both clean (0 errors, ≤50 warnings).
5. Sadin verifies on **local dev** before any merge — your job ends at "committed + reported."

---

## Part 1 — New leads must land in the intake (Pre-qualified) list  ← PRIORITY
**Why:** migration 059 backfilled *existing* leads, but the lead-create paths never set `list_id`, so newly created leads get `list_id = NULL` — they show in the master "All Leads" but **not** in Pre-qualified where tele-callers work. This silently breaks the intake flow.

For **education_consultancy** tenants, set a newly-created lead's `list_id` to the tenant's `is_intake` list:

1. **`src/app/(main)/api/v1/leads/route.ts`** → `handlePost`: before the insert, if `auth.industryId === "education_consultancy"` and the caller didn't pass a `list_id`, resolve the intake list (`SELECT id FROM lead_lists WHERE tenant_id = auth.tenantId AND is_intake = true LIMIT 1`) and set `list_id` on the insert payload.

2. **`src/app/api/public/submit/[tenantSlug]/[formSlug]/route.ts`** (public form intake — the main lead source): same — for an education tenant, resolve that tenant's `is_intake` list and set `list_id` on **newly created** leads.
   - **CRITICAL:** do **NOT** change `list_id` on the dedup / idempotency path (when an existing lead is matched and updated). Existing leads keep their current list. Only brand-new inserts get the intake list.

3. Non-education tenants: leave `list_id` NULL (unchanged behavior). Do **not** mirror `lead_type` here — a freshly created lead is a normal "lead" sitting in Pre-qualified.

Keep it cheap: one small lookup per create is fine. If the intake list can't be resolved (older/edge tenant with no lists), fall back to NULL silently — don't error the lead creation.

## Part 2 — Seed the 4 lists when a new education tenant is created
**Why:** the only programmatic tenant-creation path is `scripts/onboard-tenant.ts`, and it seeds a pipeline + `pipeline_stages` but **not** `lead_lists`. A new education tenant created today would get zero lists.

1. **`scripts/onboard-tenant.ts`** — after the existing pipeline / `pipeline_stages` seeding block (~lines 221–244), if the chosen industry is `education_consultancy`, insert the 4 system lists for the new `tenant.id`, **mirroring `supabase/migrations/059_lead_lists.sql` exactly**:
   | name | slug | sort_order | flags |
   |---|---|---|---|
   | Pre-qualified | `pre-qualified` | 1 | `is_intake: true` |
   | Qualified | `qualified` | 2 | — |
   | Prospects | `prospects` | 3 | — |
   | Archived | `archived` | 4 | `is_archive: true` |
   All `is_system: true`, `access: {"mode":"all"}`.
2. Respect the script's existing **dry-run / `--apply`** flow — do not write in dry-run; print what would be created.
3. Update the script's header comment ("A complete tenant is:") to include `lead_lists`.

## Out of scope (note, don't build)
The same new-tenant gap exists for `application_stages` and `positions` (called out in `057_application_tracking.sql`). **Do not fix those here.** Just add a one-line code comment near the onboard-tenant `lead_lists` block noting they remain unprovisioned, so it stays visible.

---

## Reuse (don't reinvent)
- The migration seed values + flags: `supabase/migrations/059_lead_lists.sql` (Part 2 mirrors these).
- Existing create payload + dedup logic: `handlePost` in `leads/route.ts`; the public submit handler.
- onboard-tenant pipeline/stage seeding block as the structural model for the lead_lists insert.

## Self-check before reporting (paste results)
- [ ] New dashboard lead (education) → lands in Pre-qualified; new public-form lead (education) → lands in Pre-qualified; **dedup/idempotency update does NOT move an existing lead's list**; non-education leads still get NULL `list_id`.
- [ ] `onboard-tenant.ts` dry-run lists the 4 lead_lists; `--apply` would create them; non-education tenants get none; header comment updated.
- [ ] `npm run build` clean · `npx eslint --max-warnings 50` clean.
- [ ] No migration / no DB writes. No push / PR / merge. Two commits (Part 1, Part 2) on `feature/lead-lists-phase-3`.
- [ ] Report: files touched, decisions, the two gate outputs. Then STOP.

## Hand back to Opus
Commit (commit-msg hook rewrites co-author), stop. Opus re-runs both gates, reviews, then Sadin verifies on local dev before merge.
