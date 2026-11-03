# BRIEF: `real_estate` Industry Vertical — Phase 1 Skeleton

**For:** Sonnet executor · **From:** Opus (planner) + `/coo-real-estate` + `/crm-expert`
**Branch:** `feature/real-estate-vertical` (already cut from `origin/stage`)
**Date:** 2026-07-15 · **Scope:** Phase-1 skeleton only. **No AI, no external portal, no dashboard polish.**

---

> ## ⛔ TWO GUARDRAILS THAT OVERRIDE EVERYTHING ELSE
>
> **1. DO NOT BREAK ANY OTHER TENANT.** education_consultancy, it_agency, travel_agency and every
> other tenant must behave **byte-identically** after your change. The bar is not "probably fine" —
> it is *proven* fine. Every UI edit is an **additive `industry_id === "real_estate"` branch**; you
> never edit, reorder, or wrap an existing education/it_agency/shared code path. `shell.tsx`,
> `lead-detail-v2.tsx`, and any leads query are **shared files — edit hunk-by-hunk, additive only.**
> You MUST complete §7 and log in as an it_agency AND an education tenant to confirm nothing moved
> (§8 step 5) before you push. If you cannot prove it, do not push.
>
> **2. DATABASE IS LOCAL ONLY.** All migrations run against your **local** Supabase
> (`postgresql://postgres:postgres@127.0.0.1:54322/postgres`) via `scripts/migrate-apply.sh local`.
> **NEVER** run SQL against the stage or prod Supabase. No `supabase db push`, no direct psql to a
> remote URL. Migrations reach stage only through a PR (CI applies them); prod only at promotion with
> Sadin's explicit go. See `docs/dev-collab/LOCAL-DEV-SETUP.md`.

---

## 0. What this is (and isn't)

EdgeX is adding an **investor CRM + capital-raise workspace** for a CRE sponsor firm (prospect: **CRE
Capital Management** — industrial value-add + core-income, Southeast US). First deliverable is a
**pitch demo**. `real_estate` is a wired-but-empty industry stub. This brief builds the **skeleton**:
industry scaffold + naming + the investor/offering/commitment data model + the per-offering raise
funnel + investor-detail customization.

**Explicitly DEFERRED (do NOT build now):** AI touchpoints, external LP portal/auth, full waterfall
math, K-1/tax docs, ACH/banking, KYC/accreditation third-party integration, dashboard widget depth.

**Non-negotiable:** this must **not change behavior for any other tenant** (education_consultancy,
it_agency, travel_agency, …). Every UI change is **additive and industry-gated**; every new table is
**tenant-scoped with RLS**; new routes are **feature-gated**.

---

## 1. Locked architecture decisions (do not relitigate)

1. **Investors ride the `leads` spine.** An investor IS a `lead` (one persistent person-object,
   HubSpot lifecycle-style). No separate table, no Lead→Investor conversion step.
2. **Lifecycle is DERIVED from commitments**, not stored: `Prospect` (no commitment) → `Engaged`
   (has soft_commit/subscribed) → `Investor` (≥1 funded) → `Repeat` (funded on ≥2 offerings).
   Compute it; don't add a column.
3. **Offerings = NEW `offerings` table** (not a `deals` extension).
4. **Raise funnel is PER-OFFERING**, driven by `investor_commitments.status`. NOT global
   `lead_lists`/`list_id`. The same investor can be `funded` on one offering and `prospect` on
   another.
5. **Two surfaces:** **Investors** = the `/leads` route relabeled for real_estate; **Offerings** =
   new route, each offering opens its per-offering raise-funnel board.

---

## 2. Data model

### 2.1 New table — `offerings`
```
offerings
  id             UUID PK default gen_random_uuid()
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
  name           TEXT NOT NULL                      -- "Industrial Value-Add Fund II"
  slug           TEXT                               -- optional, for URLs
  asset_class    TEXT                               -- industrial | flex | multifamily | ...
  structure      TEXT   CHECK (structure IN ('single_asset','fund','fund_of_funds','debt'))
  exemption      TEXT   CHECK (exemption IN ('506b','506c'))
  target_raise   NUMERIC(16,2)
  min_investment NUMERIC(14,2)
  pref_return    NUMERIC(5,2)                       -- e.g. 8.00 (%)
  currency       TEXT NOT NULL DEFAULT 'USD'
  status         TEXT NOT NULL DEFAULT 'raising'
                   CHECK (status IN ('draft','raising','closed','funded','paused'))
  close_date     DATE
  description     TEXT
  created_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL
  created_at     TIMESTAMPTZ DEFAULT NOW()
  updated_at     TIMESTAMPTZ DEFAULT NOW()
  deleted_at     TIMESTAMPTZ                        -- soft delete; all queries filter IS NULL
```
RLS: SELECT `tenant_id IN get_user_tenant_ids()`; INSERT/UPDATE/DELETE `is_tenant_admin(tenant_id)`.
Index: `(tenant_id) WHERE deleted_at IS NULL`.

### 2.2 New table — `investor_commitments` (the connective tissue)
```
investor_commitments
  id            UUID PK default gen_random_uuid()
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
  lead_id       UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE      -- the investor
  offering_id   UUID NOT NULL REFERENCES offerings(id) ON DELETE CASCADE
  amount        NUMERIC(14,2)                                             -- committed $ (nullable at prospect)
  status        TEXT NOT NULL DEFAULT 'prospect'
                  CHECK (status IN ('prospect','soft_commit','subscribed','funded','declined'))
  committed_at  TIMESTAMPTZ
  funded_at     TIMESTAMPTZ
  notes         TEXT
  created_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL
  created_at    TIMESTAMPTZ DEFAULT NOW()
  updated_at    TIMESTAMPTZ DEFAULT NOW()
  deleted_at    TIMESTAMPTZ
  UNIQUE (lead_id, offering_id) WHERE deleted_at IS NULL                  -- one commitment per investor per offering
```
RLS: same helper pattern as `offerings`. Index `(tenant_id, offering_id)` and `(tenant_id, lead_id)`.

- **Per-offering funnel** = `investor_commitments` for one `offering_id` grouped by `status` into 4
  columns (prospect / soft_commit / subscribed / funded); `declined` is off-board.
- **Equity raised** = `SUM(amount) WHERE status IN ('subscribed','funded')` for the offering.
- **Derived lifecycle** (per investor across all offerings): funded≥2 → Repeat; funded≥1 → Investor;
  any soft_commit/subscribed → Engaged; else Prospect.

### 2.3 Investor fields on `leads.custom_fields` (no schema change)
`investor_type` (individual|entity|joint|sdira|trust) · `accreditation_status`
(self_certified|verified|pending|not_accredited) · `kyc_status` (not_started|pending|cleared) ·
`entity_name` · `target_check_size` (numeric — expected check, distinct from actual commitment) ·
`preferred_asset_class` (default `industrial`).

---

## 3. Migrations (LOCAL-FIRST — see `docs/dev-collab/LOCAL-DEV-SETUP.md`)

Workflow per file: author from `supabase/migrations/_TEMPLATE.sql` → `scripts/migrate-apply.sh local
--dry-run` then apply → verify in `npm run dev` → PR to stage. **Never touch stage/prod DB directly.**
Each file is additive, idempotent, wrapped `BEGIN/COMMIT`, and **self-records** as its last
statement: `INSERT INTO public.schema_migrations (version) VALUES ('<file>') ON CONFLICT DO NOTHING;`

Next free number off `origin/stage` = **156** (re-verify with `ls supabase/migrations | sort | tail`
right before authoring — stage moves).

| File | Purpose |
|---|---|
| `156_real_estate_industry.sql` | Revise the `industries` row for `real_estate`: entity labels `'Property Types'/'Property Type'` → **`'Asset Classes'/'Asset Class'`**. `UPDATE ... WHERE id='real_estate'`. (The brokerage default pipeline is irrelevant now — funnel is per-offering — leave or ignore.) |
| `157_real_estate_offerings.sql` | Create `offerings` + RLS + indexes (§2.1). |
| `158_real_estate_investor_commitments.sql` | Create `investor_commitments` + RLS + indexes (§2.2). |

**Demo tenant assignment is NOT a migration.** Per SOP, tenant-specific data ops live in `scripts/`.
Locally the only seed tenant is `it_agency` ("Test Agency") — **do NOT flip it** (that would alter an
existing tenant and muddy the "nothing else changed" check). Provide `scripts/seed-real-estate-demo.sh`
that **creates a FRESH `real_estate` demo tenant** ("CRE Capital Management", slug `cre-capital`,
`industry_id='real_estate'`) + an owner login, then seeds 1 flagship offering + a handful of investors
(leads) + commitments across the 4 statuses so the board/funnel look alive. Idempotent
(`ON CONFLICT DO NOTHING`). Mirror `scripts/local-db-setup.sh` for the user-creation pattern.

> `lead_lists` seeding is **optional** for Phase 1 (funnel is per-offering now). If you want the
> Investors DB segmented, add a `159_seed_real_estate_lead_lists.sql` later — not required for the
> skeleton.

---

## 4. Industry scaffolding (exact files)

Follow `CLAUDE.md` "Migrating an existing flat-pattern feature" + `docs/reference/01-ARCHITECTURE-INDUSTRY-MODULES.md`.

1. **`src/industries/_registry.ts`** — add feature IDs: `OFFERINGS: "offerings"`. (Investors reuse
   the universal leads route — no new ID. Add `CAPITAL_RAISE_DASHBOARD` later.)
2. **`src/industries/real-estate/ai/agent.ts`** — `export const aiConfig: AiConfig = {}` (stub).
3. **`src/industries/real-estate/features/offerings/meta.ts`** —
   `{ id: FEATURES.OFFERINGS, industries: [INDUSTRIES.REAL_ESTATE] }`. Plus `pages/` + `components/`.
4. **`src/industries/real-estate/manifest.ts`** — fill `features: [{ meta: offeringsMeta }]`;
   `sidebar` (string icons, manifest-driven — non-education renders generically):
   - `{ featureId: <leads>, href: "/leads", label: "Investors", icon: "UsersRound", position: "before-pipeline" }`
     (Investors = relabeled leads; if the leads nav is universal, instead override its label for
     real_estate — see §6 note.)
   - `{ featureId: FEATURES.OFFERINGS, href: "/offerings", label: "Offerings", icon: "Building2" }`
   - Dashboard entry optional for Phase 1.
   `ai: aiConfig`.
5. **`src/components/dashboard/shell.tsx`** — ensure every icon string used above is in
   `INDUSTRY_ICONS` (`UsersRound`, `Building2` already present — confirm). No per-href edits needed
   (education-only gotcha does not apply to real_estate).
6. **`docs/FEATURE-CATALOG.md`** — add the `offerings` (+ real_estate) row.

---

## 5. Offerings surface + per-offering raise funnel

- **Route shell** `src/app/(main)/(dashboard)/offerings/page.tsx` — thin: read
  `tenantData.tenant.industry_id`, `if (!getFeatureAccess(industry, FEATURES.OFFERINGS)) notFound()`,
  then render the offerings list UI from `@/industries/real-estate/features/offerings/pages/...`.
- **Offering detail** `offerings/[id]/page.tsx` (same gate) → shows offering terms + the
  **raise-funnel board**.
- **Raise-funnel board** (new component, real_estate) — visually mirror
  `src/components/pipeline/ListFunnelBoard.tsx` (4 columns) but fed by `investor_commitments` for the
  offering grouped by `status`; each card = investor name + committed amount, links to `/leads/[id]`.
  "Add investor to raise" = create a `prospect` commitment. Moving a card between columns updates
  `investor_commitments.status` (this board CAN be interactive, unlike the read-only ListFunnelBoard).
- **API** `src/app/(main)/api/v1/offerings/route.ts` (+ `[id]`), `.../commitments/route.ts` — all
  `authenticateRequest()` → `getFeatureAccess(auth.industryId, FEATURES.OFFERINGS)` → `apiForbidden()`
  → `scopedClient(auth)` (auto tenant filter). `.update()/.delete()` MUST include an explicit
  `.eq("id", ...)` beyond the auto tenant filter.

---

## 6. Investors surface (relabel `/leads`) + investor detail

All changes are **additive `tenant.industry_id === "real_estate"` branches** beside the existing
education/it_agency branches in the SAME files — never edit shared/other-industry code paths.

- **Nav label:** "Leads" → **"Investors"** for real_estate only. **RESOLVED (preflight):** the
  universal leads nav is hardcoded in `src/components/dashboard/shell.tsx` — the item
  `{ href: "/leads", label: "All Leads", icon: Users }` (~line 83) and the `<NavSectionHeader
  label="Leads" />`. Gate the labels with a ternary, e.g. `label={isRealEstate ? "Investors" :
  "All Leads"}` and the section header `isRealEstate ? "Investors" : "Leads"`, where
  `isRealEstate = tenant.industry_id === "real_estate"`. Additive hunk; **do not touch the label for
  any other industry.** No new sidebar item needed. (Icons `UsersRound`/`Building2`/`LayoutDashboard`
  are already in `INDUSTRY_ICONS` — no shell icon additions.)
- **`lead-detail-v2.tsx`** — add real_estate blocks: header "Lead"→"Investor"; render
  `<InvestorProfileCard>` (reads/writes the §2.3 `custom_fields`) and `<CommitmentsPanel>` (this
  investor's `investor_commitments` across offerings + "Add Commitment" dialog + totals + derived
  lifecycle badge). Reuse `consent-card.tsx` relabeled "Subscription Agreement".
- **`key-info-section.tsx`** — add a real_estate branch: lifecycle badge + total committed +
  accreditation badge.
- New components live under `src/industries/real-estate/features/...` and are imported into the
  shared detail file behind the industry gate (mirror how education/it_agency components are used).

---

## 7. Tenant-isolation checklist (verify before PR)

- [ ] Every new/changed UI block is wrapped in `industry_id === "real_estate"`; education/it_agency/
      travel render **byte-identical** to before (diff the other-tenant screens).
- [ ] `offerings` + `investor_commitments` have `tenant_id` FK + RLS (SELECT `get_user_tenant_ids()`,
      mutate `is_tenant_admin()`).
- [ ] All new API routes: `authenticateRequest()` → `getFeatureAccess()` → `scopedClient(auth)`;
      updates/deletes carry an explicit id filter.
- [ ] New routes 404 (page) / 403 (API) for a non-real_estate tenant.
- [ ] No edits to shared leads queries/routes that change behavior for other industries.
- [ ] Counselor role scoping still applies on the leads/investor surface.

---

## 8. Local verification (as a real logged-in user)

1. `scripts/migrate-apply.sh local --dry-run` → confirm it sees exactly 156/157/158 pending; apply;
   check `schema_migrations`.
2. `scripts/seed-real-estate-demo.sh` → real_estate demo tenant + 1 offering + investors + commitments.
3. `npm run build` clean; `npm run dev`.
4. Log in as the **real_estate demo tenant**: sidebar shows Investors + Offerings; open the offering →
   raise funnel shows investors in the 4 status columns; move a card → status updates + equity-raised
   recalculates; open an investor → InvestorProfileCard + CommitmentsPanel + lifecycle badge; send a
   Subscription Agreement (consent) link and sign it.
5. Log in as **`admin@edgex.local`** (it_agency "Test Agency") and an **education** tenant → confirm
   NOTHING changed: no Investors/Offerings nav, `/offerings` 404s, lead detail unchanged.

---

## 9. Suggested build order

1. Migrations 156–158 + local apply. 2. `offerings` + `investor_commitments` API (gated, scoped).
3. Registry/manifest/ai-stub scaffold + sidebar. 4. Offerings list + detail + raise-funnel board.
5. Investor-detail real_estate blocks (profile card, commitments panel, relabel). 6. Demo seed script.
7. Tenant-isolation checklist + local verification. 8. `npm run build`, then push branch for Opus review.

**Do not merge. Do not touch stage/prod DB. Push the branch and report back for Opus review.**
