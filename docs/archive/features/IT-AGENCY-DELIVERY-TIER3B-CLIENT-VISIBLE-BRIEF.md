# it_agency Delivery — Tier 3b: Client-visible status reports

**For:** Sonnet executor · **Reviewed by:** Opus (stop-at-review) · **Size:** S–M
**Branch:** continue on **`feature/it-agency-delivery-tier0`** (uncommitted, no push; do NOT branch off stage).
**Migration:** yes — **131** (additive; confirm 130 is highest → 131 next-free).

---

## Why

A published, structured status report (Tier 3a) should be shareable with the client as a clean read-only link — the retention artifact that keeps silent clients from churning. **Reuse the existing proposal public-share pattern verbatim** (it's proven and consistent). This is where Tier 3a pays off: the client sees the real structured sections.

**Model everything on these exact files:**
- token columns → `supabase/migrations/104_proposals_public_share.sql`
- public page → `src/app/(widget)/proposals/share/[token]/page.tsx`
- mint API → `src/app/(main)/api/v1/proposals/[id]/route.ts` (lines ~115-123 mint; ~170-172 audit redaction)
- share dialog UI → `src/industries/it-agency/features/proposals/pages/proposal-detail.tsx` (lines ~73-169)

---

## Migration 131 (additive, transactional, self-recording)

`project_status_reports` already has a **dead** `is_client_visible BOOLEAN NOT NULL DEFAULT false` (mig 128, confirmed unused) — **repurpose it as the enable gate** (no second `public_enabled` needed). Add only the token:

```sql
BEGIN;
ALTER TABLE project_status_reports ADD COLUMN IF NOT EXISTS public_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_status_reports_public_token
  ON project_status_reports(public_token) WHERE public_token IS NOT NULL;

INSERT INTO public.schema_migrations (version) VALUES ('131_status_report_public_share.sql')
  ON CONFLICT (version) DO NOTHING;
COMMIT;
-- Rollback: DROP INDEX IF EXISTS uq_project_status_reports_public_token; ALTER TABLE project_status_reports DROP COLUMN IF EXISTS public_token;
```
Also append `public_token: string | null` to the `ProjectStatusReport` type. Apply LOCAL only (`scripts/migrate-apply.sh local`, `--dry-run` first).

---

## Code changes

### 1. Mint/toggle API — new `PATCH /api/v1/status-reports/[id]/route.ts`
There's only a `publish` route today; add a sibling `route.ts` with `PATCH`. Auth: `authenticateRequest` + `PROJECT_BOARD` + `requireAdmin`; `scopedClient(auth)`. Accepts `{ is_client_visible?: boolean, regenerate_token?: boolean }`:
- **Guard: only a *published* report can be shared** — load the report; if `published_at` is null and the caller is enabling, return 409/400. (A draft must never be public.)
- On enabling with no existing token (or `regenerate_token: true`) → `public_token = crypto.randomUUID()` (mint in code, like proposals). Set `is_client_visible` from the body.
- Redact `public_token` in any audit log (mirror proposals lines ~170-172).

### 2. Public read-only page — new `src/app/(widget)/reports/share/[token]/page.tsx`
Model on `proposals/share/[token]/page.tsx` exactly:
- `export const dynamic = "force-dynamic"`; `metadata = { robots: { index: false, follow: false } }`.
- `createServiceClient()` (RLS-bypass is safe because the **query filter** is the gate).
- Rate-limit: `checkRateLimit(\`public_status_report:${ip}\`, PUBLIC_READ_LIMIT)` (IP from `x-forwarded-for`).
- Query: `.eq("public_token", token).eq("is_client_visible", true).not("published_at", "is", null).maybeSingle()` — token + client-visible + **published** (belt-and-suspenders). `if (!data) notFound()` — generic 404, never distinguish wrong/disabled/unpublished.
- Fetch tenant branding by `row.tenant_id` (`tenants.name, logo_url, primary_color`), same as the proposal page.
- Render a new read-only component (below).

### 3. Read-only report document — new component (there is no existing one)
`src/industries/it-agency/features/project-board/components/public-status-report.tsx` (or similar). Client-facing, branded, shows:
- Tenant name/logo + project name + `report_date`.
- **Health** (label + color: On track / At risk / Off track) and **% complete**.
- The **structured sections** (Accomplishments / In progress / Risks / Asks / Recommended client message) — render only non-empty ones; fall back to `summary` if a legacy report.
- **Omit internal cost detail** — do NOT show `hours_actual/estimate_snapshot` (those are internal margin inputs, not for the client). Health + % complete + narrative sections only.

### 4. Share dialog on the panel — `status-reports-panel.tsx`
On each **published** report row, add a **"Share"** button (admin-only) opening a dialog modeled on `proposal-detail.tsx` (lines ~73-169): a toggle bound to `is_client_visible` (calls the new PATCH), the public URL `${NEXT_PUBLIC_APP_URL ?? window.location.origin}/reports/share/${public_token}` with a copy button, and a "Regenerate link" (confirm) → PATCH `regenerate_token: true`. When `is_client_visible` is off, show the enable toggle; when on, show the link. **Keep this separate from the `previewEnabled` AI block** — it's a real feature, ungated by the AI flag.

---

## Acceptance checklist (Opus reviews)

- [ ] Migration 131 applied local; additive; unique partial index; self-record present.
- [ ] Enable sharing on a **published** report → gets a `public_token`; opening `/reports/share/<token>` in an incognito/no-session context renders the branded read-only report with the structured sections, health, % complete — and **no** internal hours.
- [ ] Disable (`is_client_visible = false`) → the public URL now 404s. Regenerate → old token 404s, new token works.
- [ ] Trying to enable sharing on a **draft** (unpublished) report is rejected.
- [ ] Wrong/random token → generic 404 (no info leak). Rate-limiting present.
- [ ] Token redacted in audit logs. Public page is `noindex`, `force-dynamic`.
- [ ] Legacy summary-only report shares correctly via the fallback.
- [ ] `build` / `tsc` / `eslint src` clean; mint route via `scopedClient`, public page via `createServiceClient` (token-gated); stop at review — no push/PR/merge.

## Non-goals
No client login/portal (just the token link). No client-side comments/interaction. No email-sending of the link (copy-paste for now). No AI. Don't expose internal hours/cost/ledger. Don't touch the `previewEnabled` AI block or the publish route's snapshot logic.
