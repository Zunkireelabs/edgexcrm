# BRIEF — Synthetic gate tenant on stage (the vehicle for the agent-value gate)

**Author:** Opus planner (brain folder). **For:** the executor session (Part A PR, Parts C–D UI work) + Sadin (Part B — the writes).
**Date:** 2026-09-13. **Parent:** `BRIEF-AGENT-VALUE-MEASUREMENT.md` (STOPPED — this brief replaces its tenant choice).
**Branch for Part A:** fresh from latest `origin/stage`, e.g. `chore/gate-tenant-scripts`.

---

## Why

The agent-value gate stopped because `zunkireelabs-crm` on stage was receiving **real** leads — job
applicants arriving through the tenant's public form — and Lead Triage was sending them to the AI
provider. The stage scrub is a one-time rewrite; it cannot keep a tenant clean while real data keeps
arriving.

The fix is a tenant that is **synthetic by construction**: nothing real can ever reach it, so there is
nothing to scrub. Every design choice below follows from that.

## How "synthetic by construction" is guaranteed — verified in code 2026-09-13

| Inflow path | Why it is closed for this tenant |
|---|---|
| Public form page `/form/<slug>` | `getFormConfigByTenantSlug()` returns null without a `form_configs` row → 404. **We never create one.** |
| Public submit API `/api/public/submit/<tenant>/<form>` | Requires an integration API key belonging to the tenant **and** an active `form_configs` row. **We create neither.** |
| Integration API (`/api/v1/integrations/crm/leads`) | Requires an integration key. Keys are only minted by an admin in Settings → API keys. **We mint none.** |
| Dashboard / v1 leads route | Only reachable by a member of the tenant. **The only member is a dedicated synthetic login.** |
| Inbound WhatsApp / email | Does not create leads (`src/lib/inbox/process-inbound.ts` only links by phone). |

## Two constraints that shape the setup — verified in code

1. **One login can belong to only one tenant.** `getCurrentUserTenant()` in `src/lib/supabase/queries.ts`
   reads `tenant_users` by `user_id` with `.single()`; `authenticateRequest()` does the same unless a
   tenant id is passed. Adding an existing stage login to a second tenant would break that login's
   dashboard. **The gate tenant gets its own dedicated login. Never reuse an existing one.**
2. **A tenant cannot be created in the app.** There is no signup, route or RPC — tenants exist only via
   SQL (see `scripts/seed-education-local.sh`). And `scripts/set-tenant-ai.sh` flips only `ai_enabled`;
   nothing sanctioned flips `ai_agents_enabled`. Both gaps are closed by one small scripts-only PR
   (Part A), which this repo's no-DB rule requires: the session writes the scripts, a human runs them.

Also verified: a new tenant starts with **zero positions** (no seeding trigger), and hiring is disabled
without one; lead creation fails with *"Tenant has no default pipeline configured"* without a default
pipeline, and new leads land in the `is_intake` list; **bulk** lead operations emit only
update/assign/graduate events — **only single lead creation fires `crm/lead.created`**.

---

## Part A — one scripts-only PR (executor)

**Scope:** `scripts/` only. No `src/`, no migration, no CI change. **Write both scripts; run neither.**

### A1 — `scripts/seed-gate-tenant-stage.sh`

Adapt steps **1–5 only** of `scripts/seed-education-local.sh` (tenant → owner membership → default
pipeline → education default stages → lead lists incl. the intake list with `pipeline_id` set).

Requirements:
- Usage: `STAGE_DB_URL=... scripts/seed-gate-tenant-stage.sh stage <owner-email> [--dry-run]`
- **Stage only.** No `local`/`prod` case. Copy the prod-marker abort from `scripts/scrub-stage-pii.sh`
  verbatim, so a mis-set URL still refuses.
- Fixed identity: name `Orca Gate (Synthetic)`, slug `orca-gate`, industry `education_consultancy`,
  `config '{}'`.
- **Abort** if slug `orca-gate` already exists.
- **Abort** if the owner email has no `auth.users` row, **or already has any `tenant_users` row**
  (the one-tenant-per-login constraint above — say so in the error message).
- Must **not** create: `form_configs`, `integration_keys`, `positions`, `leads`, or any second member.
- One transaction; print before/after counts for every table touched; `--dry-run` rolls back.
- `lead_lists.pipeline_id` must be set (the seed file explains why — a null breaks `update_lead_stage`).

### A2 — extend `scripts/set-tenant-ai.sh`

Add an optional 4th argument selecting the column: `<env> <slug> on|off [assistant|agents]`
(default `assistant` = today's behaviour, unchanged).
- `agents` flips `tenants.ai_agents_enabled`.
- Refuse `agents on` if that tenant's `ai_enabled` is false (the runtime requires both — `isAgentsEnabledForTenant()`).
- Keep one-tenant-per-invocation, the slug-exists check, and the before/after print.
- Fix the stale header comment claiming stage is a sanitized clone — it is not reliably clean.

**Acceptance (Part A):** both scripts pass `bash -n`; `seed-gate-tenant-stage.sh local` is **not** a
valid invocation; CI green including **Destructive Script Guard** (do not bypass it — if it flags the
new script, report what it flagged); PR to `stage`; brain folder reviews before merge.

---

## Part B — the writes (Sadin, stage only, per-action)

1. **Create the dedicated login** in the **stage** Supabase dashboard → Authentication → Add user:
   `orca-gate-owner@zunkiree.invalid`, auto-confirm on, strong password stored in the password manager.
   Nobody else gets this login.
2. `scripts/seed-gate-tenant-stage.sh stage orca-gate-owner@zunkiree.invalid --dry-run` → read the
   counts → run again without `--dry-run`.
3. `scripts/set-tenant-ai.sh stage orca-gate on` → `scripts/set-tenant-ai.sh stage orca-gate on agents`.

Report the before/after output of each step.

---

## Part C — configure and smoke-test through the product (executor, UI)

Log in at `https://dev-lead-crm.zunkireelabs.com` **only** as `orca-gate-owner@zunkiree.invalid`.

- **C1 Isolation checks.** `/form/orca-gate` returns 404. Settings → API keys: **0** keys. Team: **1**
  member. Leads: **0**.
- **C2 Agent position.** Settings → Positions → create `AI Agent — Lead Triage`, tier `member`,
  permissions matching `POSITION_PERMISSIONS` in `scripts/seed-agent-local.ts`: nav/pipelines/lists
  all; `leadScope: all`; every `can*` grant false; dashboard widgets all.
- **C3 Hire.** `/orca/agents` → hire **Lead Triage only**, against that position. No amber
  *"not yet active"* banner afterwards. Do **not** hire Daily Digest, Follow-up Drafter (it appears
  because the tenant is `education_consultancy`), or External MCP Client. Automation: `create_task`
  at `agent_human`; everything else stays default-deny.
- **C4 One-lead smoke.** Create **one** lead via the dashboard *Add lead* form (single create — bulk
  paths don't trigger the agent), using the synthetic data rules below. Within a few minutes a Lead
  Triage proposal should appear in `/orca/review`. Open it; confirm it references only the synthetic
  values.

**Stop and report after C4.** Part D waits for Sadin's go.

---

## Part D — the synthetic batch (after Sadin's go)

### Data rules (non-negotiable)
- Every email ends `@synthetic.invalid`. Every phone is `+977-980000xxxx`. Names are invented.
- **Never put the intended category anywhere in the lead** (no tag, note, field or source label).
  Lead Triage reads the lead via `get_lead`; a category label would hand it the answer. Keep the
  answer key **outside the app** — a sheet mapping display ID → category → expected score band.

### The mix — at least 60 leads, created one at a time via *Add lead*

| Category | Count | Expected band | What it tests |
|---|---|---|---|
| Complete, clear-fit student enquiry (email + phone + study intent) | 12 | 81–100 | the happy path |
| One contact method only | 8 | 51–80 | the rubric's middle band |
| Neither email nor phone | 6 | 21–50 | the contact cap |
| Duplicate of an earlier gate lead (same name + email or phone) | 8 | 0–20 | duplicate detection — create the original first |
| **Job applicant** (CV-style message, "careers" intent) | 8 | should be low / flagged | **the real failure found on 2026-09-13** |
| **Vendor or sales pitch** to the business | 8 | should be low / flagged | off-target recognition |
| **Spam / gibberish** | 6 | should be low / flagged | noise rejection |
| Near-duplicate that is a *different* person (same surname, different contact) | 4 | not 0–20 | false-positive duplicates |

The current prompt has **no definition of a good-fit lead** — its rubric only checks duplicates and
contact completeness — so the off-target rows are *expected* to score badly today. That is the point:
it measures the gap honestly. **Do not change the prompt during the measurement window.** If it needs
fixing, stop the window, fix it through a normal PR, and restart with a fresh baseline.

### Then

Continue with `BRIEF-AGENT-VALUE-MEASUREMENT.md` steps 5–6 on `orca-gate`: review each proposal
**within 48h** (task approvals expire after 48h), honestly, and measure by baseline delta on the Lead
Triage drawer's Acceptance figure.

---

## Hard rules for the executor

- No interactive DB access, no SQL, no running any script against stage or prod (Part B is Sadin's).
- Work only inside `orca-gate`; never switch into or touch another tenant.
- Never mint an API key, create a form, or invite a member for `orca-gate`.
- Never type real personal data into `orca-gate` — not even your own.
- No deploys, no env changes, no `src/` changes.

## Report shape (after C4)

```
A PR:        #[n]  CI=[pass/fail per job]  Destructive Script Guard=[pass/flagged: ..]
B Writes:    login=[created]  seed=[before/after counts]  ai_enabled=[f→t]  ai_agents_enabled=[f→t]
C1 Isolation: /form/orca-gate=[404?]  api_keys=[0?]  members=[1?]  leads=[0?]
C2 Position: [created, tier, permissions summary]
C3 Hire:     lead-triage=[hired, active]  banner=[absent?]  create_task=[agent_human]  others hired=[none?]
C4 Smoke:    lead=[display id]  proposal appeared=[yes/no, minutes]  score=[n]  synthetic-only=[yes/no]
Anything unexpected: [..]
```

## Afterwards

The tenant is disposable. When the gate is decided, record whether `orca-gate` is kept for future agent
evals (recommended — it becomes the standing synthetic test bed for every agent) or paused.
