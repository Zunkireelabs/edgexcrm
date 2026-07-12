# IT-Agency Delivery — Tier 2b: Milestone-Triggered Invoicing Spine (BUILD BRIEF)

**For:** Sonnet executor session · **Branch:** `feature/it-agency-delivery-tier0` (stack on it — do NOT branch off stage) · **Industry:** `it_agency` (scoped) · **Migration:** `133_invoicing_spine.sql` (next free number; 132 is current max) · **Stop at review** — build uncommitted, Opus verifies + commits. Migrations apply to **LOCAL DB only** (`scripts/migrate-apply.sh local`); do NOT touch stage/prod.

**Reviewed + scoped by Opus with Sadin.** Scope = **SPINE ONLY**. Explicitly OUT for v1: tax entry, PDF/print/export, client-facing share links, manual free-text line items, payment integrations. Those stack later.

---

## 0. Why this exists (one paragraph)

The agency value chain is sales → delivery → utilization → **billing → margin → retention**. Tier 2a shipped margin; Tier 1 shipped billing contact + amounts at handoff. But **billing itself is absent**: there is no `invoices` table anywhere in the repo (confirmed — the only "invoice" string is the "Coming soon" tooltip on the disabled account Billing tab). Meanwhile milestone acceptance (`POST /api/v1/milestones/[id]/accept`) already fires a `milestone_accepted` project-event carrying `{ milestone_id, amount }` — **the natural billing trigger, firing into a void.** This brief builds the spine that catches it: accepted milestones → generate a draft invoice → status lifecycle → the account Billing tab goes from stub to real.

---

## 1. Decisions already made (do NOT re-litigate)

| # | Decision | Ruling |
|---|---|---|
| 1 | Project currency is NULL (only set on proposal/deal conversion) | **Fallback to `'NPR'`** at generation. Never block billing. |
| 2 | Accepted milestone with NULL `amount` | **Require amount** — exclude from the "available to bill" list; UI hints to set an amount first. No $0 lines. |
| 3 | Line-item editing on a draft | **Milestone-generated + delete only.** No manual/free-text lines in v1. |
| 4 | Invoice detail surface | **Drawer/slide-over in the cockpit + Billing tab.** No dedicated `/invoices/[id]` route in v1. |
| 5 | Invoice numbering | Per-tenant `INV-####`, **mirror the exact `set_proposal_number()` mechanism** in `103_proposals.sql:43-57`. |
| 6 | Void behavior | Void **releases** its milestones (`invoiced_at → NULL`) so they can be re-billed. |
| 7 | Access | Invoices are **admin/owner only** (financial). Every route: `getFeatureAccess(auth.industryId, FEATURES.PROJECT_BOARD)` + `requireAdmin`. All invoice UI gated on `isAdmin`. |

---

## 2. Migration `133_invoicing_spine.sql`

Additive only. Wrap in `BEGIN/COMMIT`. Follow `_TEMPLATE.sql`. **Include the self-record line** (Migration Guard fails the PR without it) and a rollback block. Mirror the RLS shape of `project_milestones` (`128_delivery_workflow.sql:127-141`) and the numbering trigger of `proposals` (`103:43-57`) exactly.

### 2a. `invoices`
```sql
CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,   -- denormalized from project.account_id (projects.account_id is NOT NULL) so the account Billing tab can list without a join through projects
  invoice_number TEXT NOT NULL,                                          -- INV-#### trigger-assigned per tenant
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','sent','paid','void')),
  currency TEXT NOT NULL DEFAULT 'NPR',
  subtotal   NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0,                           -- always 0 in v1; column present so tax slots in later with no rename
  total      NUMERIC(14,2) NOT NULL DEFAULT 0,                           -- = subtotal + tax_amount
  issue_date DATE,                                                       -- set when marked sent (defaults to today)
  due_date   DATE,
  notes TEXT,
  sent_at   TIMESTAMPTZ,
  paid_at   TIMESTAMPTZ,
  voided_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invoices_project_id ON invoices(project_id);
CREATE INDEX IF NOT EXISTS idx_invoices_account_id ON invoices(account_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_tenant_number ON invoices(tenant_id, invoice_number);
```

### 2b. `invoice_line_items`
```sql
CREATE TABLE IF NOT EXISTS invoice_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  milestone_id UUID REFERENCES project_milestones(id) ON DELETE SET NULL,  -- provenance; nullable so a released/deleted milestone doesn't orphan the line
  description TEXT NOT NULL,
  quantity   NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  line_total NUMERIC(14,2) NOT NULL DEFAULT 0,   -- = quantity * unit_price (compute in app, mirror proposal_line_items)
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invoice_line_items_invoice_id ON invoice_line_items(invoice_id);
```

### 2c. Double-billing guard on milestones
```sql
ALTER TABLE project_milestones ADD COLUMN IF NOT EXISTS invoiced_at TIMESTAMPTZ;
```
"Available to bill" = `status = 'accepted' AND invoiced_at IS NULL AND amount IS NOT NULL`.

### 2d. RLS (both new tables) — mirror `project_milestones`
- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;`
- **SELECT**: `USING (tenant_id IN (SELECT get_user_tenant_ids()))`
- **INSERT / UPDATE / DELETE**: `USING / WITH CHECK (is_tenant_admin(tenant_id))`
- Copy the exact policy phrasing from `128_delivery_workflow.sql:127-141` (SECURITY DEFINER helpers already exist).

### 2e. `updated_at` trigger on `invoices`
```sql
CREATE TRIGGER trigger_invoices_updated_at BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

### 2f. Numbering trigger — mirror `set_proposal_number()` exactly
```sql
CREATE OR REPLACE FUNCTION set_invoice_number() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_base bigint;
BEGIN
  IF NEW.invoice_number IS NULL OR NEW.invoice_number = '' THEN
    SELECT coalesce(max((regexp_replace(invoice_number,'[^0-9]','','g'))::bigint),0)
      INTO v_base FROM invoices
      WHERE tenant_id = NEW.tenant_id AND invoice_number ~ '^INV-[0-9]+$';
    NEW.invoice_number := 'INV-' || lpad((v_base+1)::text, greatest(4, length((v_base+1)::text)), '0');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trigger_invoices_set_number BEFORE INSERT ON invoices
  FOR EACH ROW EXECUTE FUNCTION set_invoice_number();
```
> Concurrency note: `max()+1` can collide under two simultaneous inserts; the `uq_invoices_tenant_number` unique index makes the loser fail — acceptable, it's the same posture proposals ship with. Do NOT over-engineer a sequence table.

### 2g. Self-record + rollback (REQUIRED)
```sql
INSERT INTO public.schema_migrations (version) VALUES ('133_invoicing_spine.sql')
  ON CONFLICT (version) DO NOTHING;
-- Rollback:
--   DROP TABLE IF EXISTS invoice_line_items;
--   DROP TABLE IF EXISTS invoices;
--   DROP FUNCTION IF EXISTS set_invoice_number();
--   ALTER TABLE project_milestones DROP COLUMN IF EXISTS invoiced_at;
-- Expected counts: invoices 0, invoice_line_items 0, project_milestones column-add only (0 rows touched).
```

Also add the two new tables to `src/types/database.ts` (mirror how `project_milestones` / `proposals` rows are typed there).

---

## 3. API routes (all: `authenticateRequest` → `getFeatureAccess(..., FEATURES.PROJECT_BOARD)` → `requireAdmin` → `scopedClient(auth)`)

Use `scopedClient` for every query — it auto-injects `tenant_id` on select AND on insert (this is how existing `project_events` inserts get their NOT-NULL `tenant_id`; confirmed working via `recordProjectEvent`). Never `createServiceClient()`.

### 3a. `POST /api/v1/projects/[id]/invoices` — **generate** (the core action)
Body: `{ milestone_ids: string[] }`.
1. Load project scoped (`.eq("id", id)`); 404 if missing. Read `account_id`, `currency`.
2. `resolvedCurrency = project.currency ?? 'NPR'`.
3. Load milestones: `.eq("project_id", id).in("id", milestone_ids).eq("status","accepted").is("invoiced_at", null).not("amount","is",null)`. If the returned set ≠ requested (some already billed / not accepted / null amount), **fail with `apiConflict`** naming the count dropped — do not silently partial-bill.
4. Insert `invoices` row: `project_id`, `account_id`, `currency=resolvedCurrency`, `status='draft'`, `subtotal = Σ amount`, `tax_amount = 0`, `total = subtotal`, `created_by = auth.userId`. (`invoice_number` left null → trigger fills it.)
5. Insert `invoice_line_items`: one per milestone — `description = milestone.title`, `quantity = 1`, `unit_price = milestone.amount`, `line_total = milestone.amount`, `milestone_id`, `sort_order = index`.
6. **Guarded stamp** (prevents a double-billing race): `UPDATE project_milestones SET invoiced_at = now() WHERE id IN (...) AND invoiced_at IS NULL` — if affected rows < expected, someone billed concurrently: best-effort, log a warning (the read-time filter already makes this rare).
7. `recordProjectEvent(db, { projectId: id, eventType: "invoice_generated", actorId: auth.userId, summary: \`Invoice ${invoice_number} generated — ${resolvedCurrency} ${total}\`, payload: { invoice_id, invoice_number, milestone_ids, total, currency: resolvedCurrency }, subjectType: "invoice", subjectId: invoice.id })`.
8. `createAuditLog(...)` action `invoice.generated`.
9. Return the invoice (+ its line items) `201`.

> No multi-table transaction — matches the repo's junction-insert pattern (`convert-to-project` does the same). The invoice row exists after step 4; a failure in 5-7 is logged, not fatal (the invoice isn't lost). Log loudly.

### 3b. `GET /api/v1/projects/[id]/invoices` — list this project's invoices (with line items + a computed "available to bill" milestone list for the generate UI). Consider returning `{ invoices, billableMilestones }` so the drawer needs one fetch.

### 3c. `GET /api/v1/accounts/[id]/invoices` — list invoices for the account (`.eq("account_id", id)`), for the Billing tab. Include `project_id` + project name (embed `projects(name)`), number, status, total, currency, issue/due dates.

### 3d. `GET | PATCH | DELETE /api/v1/invoices/[id]`
- **GET**: invoice + line items.
- **PATCH** — status transitions + editable fields. Enforce the state machine; reject invalid transitions with `apiConflict`:
  - `draft → sent`: set `status='sent'`, `sent_at=now()`, `issue_date = issue_date ?? today`.
  - `sent → paid`: set `status='paid'`, `paid_at=now()`.
  - `draft|sent → void`: set `status='void'`, `voided_at=now()`, **release milestones**: `UPDATE project_milestones SET invoiced_at = NULL WHERE id IN (SELECT milestone_id FROM invoice_line_items WHERE invoice_id = :id AND milestone_id IS NOT NULL)`.
  - Editable only while `draft`: `due_date`, `notes`. (No amount edits in v1 — amounts come from milestones.)
  - Reject anything else (`paid → *`, `void → *`).
  - `recordProjectEvent` for each transition (`invoice_sent` / `invoice_paid` / `invoice_voided`) + audit log.
- **DELETE**: allowed **only when `status='draft'`** → hard delete, and release its milestones (same UPDATE as void). `sent`/`paid`/`void` cannot be deleted (return `apiConflict` "void it instead"). Financial records don't vanish.

### 3e. Line-item delete (draft only): `DELETE /api/v1/invoices/[id]/line-items/[lineId]`
- Only if parent invoice `status='draft'`. Delete the line, **release that milestone** (`invoiced_at → NULL`), then **recompute** invoice `subtotal`/`total` from remaining lines. If it was the last line, leave a $0 draft (don't auto-delete the invoice — let the admin delete it explicitly).

---

## 4. UI (all gated on `isAdmin = role === "owner" || role === "admin"` — the cockpit already derives this: `project-cockpit.tsx:29`)

### 4a. Cockpit "Invoices" panel — new component
`src/industries/it-agency/features/project-board/components/cockpit/invoices-panel.tsx`, rendered in `pages/project-cockpit.tsx` near `BillableSummary`/`MilestonesPanel`, **only when `isAdmin && project.is_billable`**. Mirror the structure/styling of `milestones-panel.tsx` (status config map, list rows, a create affordance). Shows:
- List of this project's invoices: `INV-####`, status badge (draft=grey, sent=blue, paid=green, void=strikethrough/muted), `total` via `formatMoney`, due date. Row click → detail drawer (4c).
- **"Generate invoice"** button → opens a picker of "available to bill" milestones (accepted, not invoiced, amount set) with checkboxes + a running total → confirm → `POST .../invoices`. If none available, show an empty hint ("Accept a milestone with an amount to bill it").
- New hook `hooks/use-project-invoices.ts` (mirror `use-project-milestones.ts`).

### 4b. Account **Billing tab** — stub → real
`src/industries/it-agency/features/accounts/components/account-detail/account-tabs.tsx:78-88`:
- Remove `disabled` from the Billing `TabsTrigger`, drop the "Coming soon" tooltip.
- Add `<TabsContent value="billing">` rendering an invoices list for the account (fetch 3c): number, **project name** (links to `/projects/[id]`), status badge, total (`formatMoney`), issue/due dates. Read-only list; the generate action lives in the project cockpit (invoices are milestone/project-driven). Gate content on `isAdmin`; non-admins see a "restricted" note or the tab stays hidden — match how other admin-only account UI behaves.

### 4c. Invoice detail — **drawer/slide-over** (NOT a page)
A shared drawer component opened from 4a and 4b. Shows header (number, status, currency, dates), the line-item table (description / qty / unit price / line total), the invoice total, notes. Actions by status: draft → [Mark sent] [Delete] [remove a line]; sent → [Mark paid] [Void]; paid → read-only; void → read-only. Use `formatMoney` everywhere.

### 4d. Money formatting — one helper
Use **`formatMoney(amount, currency)`** from `src/lib/travel/currency.ts` (currency-aware, NPR-default) for ALL invoice UI. Do **NOT** use `formatCurrency` from `src/lib/format-billable-delta.ts` (hardcoded USD — wrong for NPR tenants). Do not refactor/move the helper in this PR; just import it. (Its `lib/travel/` location is a naming artifact — fine to reuse cross-industry.)

---

## 5. Adjacent fix to fold in (small, same PR — we're in the money surfaces)

**`GET /api/v1/time-entries` leaks `cost_rate_snapshot` to non-admins via `select("*")`** (`src/app/(main)/api/v1/time-entries/route.ts:38`). The cockpit hides Cost/Margin from non-admins client-side only; the field still rides in the JSON. Non-admins are already row-scoped to their own entries (line 40), so it's self-exposure only — but harden it server-side:
- After the fetch, if `!isAdmin`, map the rows and set `cost_rate_snapshot: null` before `apiSuccess`. (Same spirit as the `team` route's `isAdmin ? m.cost_rate : null` at `team/route.ts`.) Do the same in the POST response select at line 116 if it returns the field.

---

## 6. Verification (Sonnet does this locally before handing back; Opus re-runs independently)

1. `scripts/migrate-apply.sh local` → migration 133 applies clean; `\d invoices`, `\d invoice_line_items`, `project_milestones.invoiced_at` present; RLS enabled on both.
2. `npm run build` clean. `npx eslint --max-warnings 0` clean on every new/changed file.
3. **Local dogfood as an it_agency admin** (`admin@edgex.local` / `edgexdev123`, or `admin@zunkireelabs.com`):
   - Create a project (or use one) → add a milestone with an `amount` → accept it → it appears in "available to bill".
   - Generate an invoice → draft appears with `INV-0001`, correct total/currency, one line per milestone; the milestone drops out of "available to bill" (invoiced_at stamped).
   - Mark sent → paid; verify timestamps + status badges; verify project cockpit + account Billing tab both show it.
   - Void a sent invoice → milestone returns to "available to bill".
   - Delete a draft → milestone released.
   - Confirm `project_events` gained `invoice_generated` / `invoice_sent` / `invoice_paid` / `invoice_voided` rows.
4. **Negative checks:**
   - As a **non-admin** it_agency user: no Invoices panel in cockpit, Billing tab hidden/restricted, `POST .../invoices` → 403, and `GET /api/v1/time-entries` response has `cost_rate_snapshot: null` (verify in the network tab — the §5 fix).
   - As a **non-it_agency** tenant (education): all invoice routes → 403, no UI.
   - Milestone with NULL amount is NOT offered for billing.
   - Generating with an already-billed milestone id → `apiConflict`, no partial invoice.
5. Tenant isolation: attempt `GET /api/v1/invoices/[id]` for another tenant's invoice → 404 (scoped client blocks it).

---

## 7. Definition of done / hand-back

- Migration 133 + 2 tables + RLS + numbering trigger + `invoiced_at`, all additive & self-recorded; local-only.
- Generate-from-accepted-milestone → draft; lifecycle draft→sent→paid + void/delete with milestone release; project-events + audit on each.
- Cockpit Invoices panel + account Billing tab (stub→real) + detail drawer; all admin-gated; `formatMoney` throughout.
- §5 cost_rate_snapshot server-side redaction landed.
- Build + lint clean; the §6 dogfood + negative checks pass.
- **STOP. Do not commit, do not open/modify a PR, do not touch stage/prod.** Produce a short report (files changed, migration summary, dogfood results, anything you deviated on). Opus reviews the diff, re-runs the gates, and commits on this branch.

---

## 8. Open threads deferred to Tier 2b+ (do NOT build now — note only)
Tax lines, PDF/export, client-facing invoice share (reuse the mig-131 public-token pattern), manual/free-text line items, partial payments + `amount_paid`, retainer/recurring billing, T&M "bill from approved time entries" (vs milestone), portfolio-level AR roll-up, a single canonical `lib/currency.ts`. These are the natural next cuts once the spine lands.

> **Numbering prerequisite for client-facing sharing (known limitation, deferred fix):** invoice numbers currently reuse after a draft hard-delete — `set_invoice_number()` is `max()+1` over surviving rows, mirroring proposals. Harmless in v1 because only never-issued drafts can be deleted (sent/paid/void 409 and retain their numbers) and invoices are never shared with clients. **Before shipping client-visible invoice share, switch to a monotonic per-tenant never-reuse counter** (counter table or sequence) so a shared draft number can never later point at a different invoice. Code note lives at the DELETE handler in `invoices/[id]/route.ts`.
