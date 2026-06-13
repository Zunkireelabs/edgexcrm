# DEALS / OPPORTUNITIES — Sonnet Build Brief

> **Source of truth:** this brief. Approved plan: `~/.claude/plans/lets-keep-this-sprightly-badger.md`.
> **You are the executor (Sonnet).** Build on a branch, **STOP AT REVIEW** — do NOT merge, do NOT push to stage/main, do NOT apply the migration to the shared Supabase DB. Opus reviews post-hoc and runs all promotions. Read `CLAUDE.md` first.

---

## 0. Hard rules (read before touching anything)

1. **Branch:** `git checkout stage && git pull --rebase origin stage && git checkout -b feature/deals`. All work here.
2. **STOP AT REVIEW.** Commit on the branch, push the **branch** (not stage), and hand back. No PR merge, no stage/main push, no shared-DB migration apply. (This gate has been overstepped before — do not.)
3. **Migration is additive + idempotent** (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`). Apply it ONLY to your **local/throwaway** Postgres for testing. Never to the shared Supabase project.
4. **Two gates before handing back, both green:** `npm run build` clean **AND** `npx eslint --max-warnings 50` with **0 errors**. (Build alone is not enough — CI enforces the lint; a build-clean branch has red-deployed before.)
5. **Verify on local `npm run dev`** as a real it_agency tenant before handing back (see §7). CI is not a substitute.
6. **Commit trailer:** end commit messages with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` (the local commit-msg hook rewrites it).
7. **Tenant isolation:** every tenant query uses `scopedClient(auth)`. **`.update()` / `.delete()` MUST carry a caller filter** (e.g. `.eq("id", dealId)`) beyond the auto-injected `tenant_id` — otherwise you mutate the whole tenant.

---

## 1. What you're building

A **Deals / Opportunities** feature, **scoped to the `it_agency` industry only** (lives beside Accounts / Contacts / Projects). A deal is a revenue opportunity with an amount, a sales stage, and optional links to one Account + one Contact. It moves across a kanban pipeline to Closed Won / Closed Lost.

**User-visible result for an it_agency tenant (e.g. Zunkiree Labs):**
- A **Deals** sidebar item → a page with a **Board (kanban)** view + a **List** view toggle.
- Drag deals across stages; each column shows the **summed amount**. Dropping in a terminal stage marks the deal Won/Lost.
- **Create** a standalone deal, OR create-from-Account / create-from-Contact (association pre-filled).
- A **deal detail page** with inline edit + clickable Account/Contact links.
- A **"Deals" related section + "New Deal" button** on Account detail and Contact detail pages.

**For any non-it_agency tenant:** sidebar item hidden, `/deals*` routes 404, `/api/v1/deals*` returns 403.

### Locked decisions (do not re-litigate)
| Topic | Decision |
|---|---|
| Scope | `it_agency`-scoped. |
| Pipeline | **Dedicated `deal_stages` table** (isolated from the leads `pipeline_stages`). **One implicit pipeline** per tenant (no `deal_pipelines` table in v1). |
| Associations | One `account_id` + one `primary_contact_id`, **both optional** FKs. |
| Fields | Single `amount` + `currency` (default `NPR`). **No line items.** |
| Writes | Admin-only (owner/admin). Members read-only. |
| Notes | `deal_notes` table + Notes section is **OPTIONAL** — build core first; add only if core is solid. |

### OUT of scope (v2 — do not build)
Line items/products; multi-contact or multi-account; configurable multiple deal pipelines + stage add/rename/reorder UI; weighted-forecast/probability reporting; deal-stage automations/emails; deal→project conversion.

---

## 2. Migration — `supabase/migrations/046_deals.sql`

Highest existing migration is `045`. Mirror the RLS template from `029_knowledge_bases.sql` and the `pipeline_stages` shape from `002_phase1_5_foundation.sql`.

```sql
-- Migration 046: Deals / Opportunities (it_agency feature)
-- Additive + idempotent. Dormant until an it_agency tenant uses it.

-- 1. deal_stages (mirrors pipeline_stages, isolated from leads) ------------
CREATE TABLE IF NOT EXISTS deal_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(100) NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  color VARCHAR(7) DEFAULT '#6b7280',
  is_default BOOLEAN DEFAULT false,
  is_terminal BOOLEAN DEFAULT false,
  terminal_type VARCHAR(10) CHECK (terminal_type IN ('won','lost')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_deal_stages_tenant ON deal_stages(tenant_id, position);

ALTER TABLE deal_stages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deal_stages_select" ON deal_stages
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
CREATE POLICY "deal_stages_insert" ON deal_stages
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "deal_stages_update" ON deal_stages
  FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "deal_stages_delete" ON deal_stages
  FOR DELETE USING (is_tenant_admin(tenant_id));

CREATE TRIGGER trigger_deal_stages_updated_at
  BEFORE UPDATE ON deal_stages FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 2. deals -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  primary_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  stage_id UUID NOT NULL REFERENCES deal_stages(id),
  amount NUMERIC(14,2),
  currency TEXT NOT NULL DEFAULT 'NPR',
  close_date DATE,
  owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  deal_type TEXT,
  priority TEXT CHECK (priority IN ('low','medium','high')),
  description TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','won','lost')),
  last_activity_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_deals_tenant_stage ON deals(tenant_id, stage_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_deals_tenant_account ON deals(tenant_id, account_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_deals_tenant_owner ON deals(tenant_id, owner_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_deals_tenant_live ON deals(tenant_id) WHERE deleted_at IS NULL;

ALTER TABLE deals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deals_select" ON deals
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
CREATE POLICY "deals_insert" ON deals
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "deals_update" ON deals
  FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "deals_delete" ON deals
  FOR DELETE USING (is_tenant_admin(tenant_id));

CREATE TRIGGER trigger_deals_updated_at
  BEFORE UPDATE ON deals FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 3. Seed 6 default deal_stages for existing it_agency tenants -------------
INSERT INTO deal_stages (tenant_id, name, slug, position, color, is_default, is_terminal, terminal_type)
SELECT t.id, s.name, s.slug, s.position, s.color, s.is_default, s.is_terminal, s.terminal_type
FROM tenants t
CROSS JOIN (VALUES
  ('Qualification',  'qualification',  0, '#3b82f6', true,  false, NULL),
  ('Needs Analysis', 'needs-analysis', 1, '#8b5cf6', false, false, NULL),
  ('Proposal',       'proposal',       2, '#f59e0b', false, false, NULL),
  ('Negotiation',    'negotiation',    3, '#f97316', false, false, NULL),
  ('Closed Won',     'closed-won',     4, '#22c55e', false, true,  'won'),
  ('Closed Lost',    'closed-lost',    5, '#ef4444', false, true,  'lost')
) AS s(name, slug, position, color, is_default, is_terminal, terminal_type)
WHERE t.industry_id = 'it_agency'
ON CONFLICT (tenant_id, slug) DO NOTHING;

-- 4. (OPTIONAL) deal_notes — only if you build the Notes section -----------
-- CREATE TABLE IF NOT EXISTS deal_notes ( ... mirror lead_notes ... );
```

> **Verify** `update_updated_at()` is the correct trigger fn name in this DB (grep migrations — it's used by `pipelines`). If the project uses a different name, match it.

---

## 3. Lazy-seed helper — `src/lib/deals/stages.ts`

New tenants (created after the migration) won't have deal_stages. Add:

```ts
// ensureDealStages(db, tenantId): if the tenant has zero deal_stages, insert the 6 defaults.
// Call it at the top of GET /api/v1/deal-stages and the deals board/list loaders.
// Use the same 6 rows as the migration seed. Idempotent (check count first, ON CONFLICT DO NOTHING).
```

Export the default-stages array as a const so the migration intent and the helper can't drift (helper is the runtime fallback; SQL seed is the bulk path).

---

## 4. Industry wiring (3-place gate)

1. **`src/industries/_registry.ts`** — add to `FEATURES`: `DEALS: "deals",`.
2. **`src/industries/it-agency/features/deals/meta.ts`**:
   ```ts
   import { FEATURES, INDUSTRIES } from "../../../_registry";
   import type { FeatureMeta } from "../../../_types";
   export const dealsMeta: FeatureMeta = {
     id: FEATURES.DEALS,
     industries: [INDUSTRIES.IT_AGENCY],
   };
   ```
3. **`src/industries/it-agency/manifest.ts`** — import `dealsMeta`, push `{ meta: dealsMeta }` to `features[]`, and add a **top-level (before-pipeline)** sidebar entry after Accounts:
   ```ts
   { featureId: FEATURES.DEALS, href: "/deals", label: "Deals", icon: "Handshake" },
   ```
4. **`src/components/dashboard/shell.tsx`** — register `Handshake` in `INDUSTRY_ICONS` (import from `lucide-react`). **Icon is a STRING in the manifest, the component lives only in this registry** — manifests cross the Server→Client boundary; a component import in the manifest crashes the dashboard.

---

## 5. API routes (`src/app/(main)/api/v1/deals/`)

Pattern for every route: `createRequestLogger()` → `const auth = await authenticateRequest(); if (!auth) return apiUnauthorized();` → `if (!getFeatureAccess(auth.industryId, FEATURES.DEALS)) return apiForbidden();` → (writes) `if (!requireAdmin(auth)) return apiForbidden();` → `const db = await scopedClient(auth);`. All mutations fire `createAuditLog()` + `emitEvent()` (fire-and-forget `Promise.all`, like the accounts route). `AuthContext` gives you `{ userId, tenantId, role, industryId, permissions }`.

### `route.ts` — `GET` / `POST /api/v1/deals`
- **GET (list):** query params `stage_id`, `account_id`, `contact_id`, `owner_id`, `status`, `search` (matches `name`), `page`, `pageSize`. Always filter `deleted_at IS NULL`. Join-select account name + contact name for cards:
  `*, accounts!deals_account_id_fkey(id,name), contacts!deals_primary_contact_id_fkey(id,first_name,last_name)`.
  Order by `last_activity_at desc`. The `account_id`/`contact_id` filters power the related lists on Account/Contact detail. Return `apiPaginated`.
- **POST (create, admin):** validate `name` (`required`, `maxLength(255)`). Optional: `amount` (number ≥ 0), `currency`, `close_date`, `stage_id`, `owner_id`, `account_id`, `primary_contact_id`, `deal_type`, `priority`, `description`. If `stage_id` omitted, default to the tenant's `is_default` deal_stage (after `ensureDealStages`). Validate any supplied `account_id`/`primary_contact_id`/`owner_id` belongs to the tenant (select-and-check via `db`). Set `created_by = auth.userId`, `status='open'`. Return `apiSuccess(created, 201)`.

### `[id]/route.ts` — `GET` / `PATCH` / `DELETE /api/v1/deals/[id]`
- **GET:** single deal with the same joins + owner email if helpful. 404 if not found / soft-deleted.
- **PATCH (admin):** changed-fields-only. Updatable: `name, amount, currency, close_date, owner_id, account_id, primary_contact_id, deal_type, priority, description, stage_id`. **On `stage_id` change:** look up the new stage's `terminal_type` and set `status` accordingly (`won`/`lost`/else `open`), and bump `last_activity_at = now()`. Validate tenant membership for any FK. Audit diff (old vs new) + `emitEvent('deal.updated')`, plus `emitEvent('deal.stage_changed')` when stage moved. **Remember the `.eq("id", id)` filter on the update.**
- **DELETE (admin):** soft delete (`deleted_at = now()`), `.eq("id", id)`. Audit + `deal.deleted`.

### `deal-stages/route.ts` — `GET /api/v1/deal-stages`
- Auth + feature gate. Call `ensureDealStages(db, auth.tenantId)`, then return the tenant's stages ordered by `position`. Used by board columns + the create/edit stage dropdown.

### (OPTIONAL) `[id]/notes/route.ts` — only if building Notes.

---

## 6. UI

> Page shells under `src/app/(main)/(dashboard)/deals/` are **thin**: copy the exact pattern from `src/app/(main)/(dashboard)/accounts/page.tsx` — `getCurrentUserTenant()` → `redirect("/login")` if none → `if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.DEALS)) notFound();` → render the industry-folder component. Same for `/deals/[id]/page.tsx`.

All feature UI lives in **`src/industries/it-agency/features/deals/`**:

### `pages/deals-workspace.tsx` — the `/deals` page
- Header with a **Board / List** segmented toggle (Board default), an **Add Deal** button (admin only), and basic filters (stage, owner, search). Mirror the toolbar style used on `/accounts` / leads list for visual consistency.

### `components/deal-board.tsx` (kanban)
- **Copy the dnd + realtime + optimistic-revert patterns from `src/components/pipeline/PipelineBoard.tsx`** (PointerSensor, `DndContext`, `closestCorners`, `DragOverlay`, `prevColumnsRef` revert). **Do not import/reuse the lead board directly** — it's lead-coupled. Build a parallel, isolated component.
- Columns = `deal_stages` (from `GET /api/v1/deal-stages`). Cards = deals grouped by `stage_id`.
- Drag end → `PATCH /api/v1/deals/{id}` with `{ stage_id }`; optimistic move, revert on failure.
- **Realtime:** Supabase channel on the `deals` table filtered by `tenant_id` (same approach as PipelineBoard's leads channel), repositioning cards on INSERT/UPDATE/DELETE.
- Permissions: only owner/admin can drag (members read-only). Mirror PipelineBoard's guard.

### `components/deal-column.tsx`
- Stage header (color dot + name + count) and a **footer with the summed `amount`** of the column's deals, formatted via `formatMoney` (see Reuse). Matches the Zoho/HubSpot per-stage totals.

### `components/deal-card.tsx`
- Deal `name`, `formatMoney(amount, currency)`, account name, `close_date`, owner avatar/initials. Click → `/deals/[id]`.

### `components/deals-table.tsx` (List view)
- Lightweight table: name, account, contact, stage (colored pill), amount, owner, close date, status. Reuse leads-table conventions but keep it simple — no need for the full column-manager.

### `components/add-deal-sheet.tsx` (create)
- Sheet/modal form. Fields: `name` (required), `amount` + `currency`, `close_date`, `stage` (select from deal-stages, default = is_default), `owner` (team-member select), `deal_type`, `priority`, **Account picker**, **Contact picker**, `description`.
- Account/Contact pickers: searchable selects backed by `GET /api/v1/accounts` and `GET /api/v1/contacts` (both support a `q` search param). When an account is picked, optionally scope the contact picker to `?account_id=`.
- Accept optional props `prefillAccountId` / `prefillContactId` (+ display name) to support create-from-record. Reference `src/components/dashboard/add-lead-sheet.tsx` for form structure (don't over-copy — deals are simpler).
- POST `/api/v1/deals`; on success, toast + refresh board/list (and close).

### `pages/deal-detail.tsx` — the `/deals/[id]` page
- Header (back link, deal name, status pill, delete for admin, **Edit** button).
- **Inline edit/save mirroring `src/components/dashboard/lead/lead-detail-v2.tsx`:** Edit flips fields to inputs together; Save sends ONE `PATCH` of changed fields only, with `res.ok` + toast + immediate display update from `json.data`; Cancel discards.
- Show **Account** and **Contact** as links to `/accounts/[id]` and `/contacts/[id]`. Stage selector (drives status). Amount/currency, close date, owner, type, priority, description.
- (OPTIONAL Notes section if `deal_notes` built.)

### Create-from-Account / Create-from-Contact + related lists
- **`account-detail.tsx`** (`src/industries/it-agency/features/accounts/pages/`): add a **"Deals"** card/section listing `GET /api/v1/deals?account_id={id}` + a **"New Deal"** button (admin) opening `AddDealSheet` with `prefillAccountId`. Place it near the existing Projects/Contacts related sections.
- **`contact-detail.tsx`** (`src/industries/it-agency/features/crm-contacts/pages/`): same, with `?contact_id={id}` and `prefillContactId`.
- Keep these additive — don't disturb existing sections.

---

## 7. Reuse (exact paths — don't re-implement)

| Need | Use |
|---|---|
| Money formatting | `import { formatMoney } from "@/lib/travel/currency";` — `formatMoney(amount, currency)`, already defaults NPR. (It's generic despite the path.) |
| Kanban dnd/realtime/revert | Patterns in `src/components/pipeline/PipelineBoard.tsx`, `PipelineColumn.tsx`, `LeadCard.tsx`. |
| Inline edit/save | `src/components/dashboard/lead/lead-detail-v2.tsx`. |
| Page-shell gate | `src/app/(main)/(dashboard)/accounts/page.tsx`. |
| API helpers | `@/lib/api/response` (`apiSuccess/apiPaginated/apiError/apiUnauthorized/apiForbidden/apiValidationError`), `@/lib/api/validation` (`validate/required/maxLength`), `@/lib/api/auth` (`authenticateRequest/requireAdmin`), `@/lib/supabase/scoped` (`scopedClient`), `@/lib/api/audit` (`createAuditLog/emitEvent`), `@/lib/logger` (`createRequestLogger`). |
| Feature gate | `@/industries/_loader` (`getFeatureAccess`), `@/industries/_registry` (`FEATURES`). |
| Account/Contact pickers | `GET /api/v1/accounts?q=`, `GET /api/v1/contacts?q=&account_id=`. |
| Types | Add `Deal`, `DealStage` (+ optional `DealNote`) to `src/types/database.ts`. |

---

## 8. Verification (do all before handing back)

1. `npm run build` → clean. `npx eslint --max-warnings 50` → **0 errors**.
2. Apply `046` to your **local** DB only. Run `npm run dev`. Log in as an **it_agency** tenant admin (e.g. Zunkiree `admin@zunkireelabs.com`, or a local it_agency tenant).
3. **Functional:**
   - Deals nav appears; `/deals` board renders the 6 stages.
   - Create a standalone deal → lands in Qualification.
   - From an Account detail → New Deal → account pre-filled → deal shows in that account's Deals list.
   - From a Contact detail → same with contact pre-filled.
   - Drag a deal to **Closed Won** → `status='won'`; to **Closed Lost** → `status='lost'` (check the row in DB). Column amount totals update.
   - Deal detail → Edit amount/owner/close → Save persists; Account/Contact links navigate.
4. **Isolation:** as an **education** tenant — Deals nav hidden, `/deals` 404, `GET /api/v1/deals` → 403.
5. **RLS:** as a `viewer`/`counselor` member of the it_agency tenant — deals visible read-only; no drag; POST/PATCH/DELETE → 403.
6. **No regression:** the existing **leads** kanban + pipeline **settings** behave exactly as before (deal tables are isolated — confirm nothing leaked).

---

## 9. Handoff back to Opus

Push the **`feature/deals` branch** (only). In your handoff note state: commits, both gate results (paste the eslint summary line), the §8 checklist results, anything you deferred or were unsure about, and confirm you did **not** apply the migration to shared Supabase, **not** merge, **not** push stage/main. Opus reviews, re-runs both gates, and handles stage→prod on Sadin's GO.
```
