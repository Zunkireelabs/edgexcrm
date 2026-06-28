# BRIEF — Leads Organise PHASE 2.1 (RPC security fix + reconciliation tooltips) — for Sonnet

> **Role:** Executor. Two small changes on the EXISTING branch `feature/leads-organise` (Phase 2 is
> committed as `0ca6606`). Build, run gates, commit, then **STOP and report**. Do NOT push, PR, merge,
> or touch prod. Migrations → **STAGE DB only** (`dymeudcddasqpomfpjvt`). **Sadin will do the UI
> verification himself** — do not block on logging in; build + lint are your gates.

Context: the reconciliation panel (`src/components/dashboard/leads-organise/reconciliation-panel.tsx`)
works and the numbers are correct, but (a) the `reconcile_import_sources` RPC is over-exposed, and
(b) the panel shows *what* but not *why*, confusing the client on rows like Model School (1025→937)
and UK Expo (133→36). Both fixes below.

---

## 1. Security fix — restrict the reconciliation RPC (REQUIRED before any push)

`reconcile_import_sources(UUID, UUID)` is `SECURITY DEFINER` (bypasses RLS), takes `p_tenant` as a
parameter, and has **no `REVOKE`/`GRANT`** — so it is PUBLIC-executable. A logged-in user of tenant A
could call it from the browser with tenant B's UUIDs and read B's per-source counts. The server helper
`getImportSourceReconciliation` already calls it via `createServiceClient()` (service_role), so locking
execution to service_role does NOT break anything.

Add migration **`070_restrict_reconcile_rpc.sql`** (068 is already applied to stage; do NOT edit 068):
```sql
-- 070_restrict_reconcile_rpc.sql
-- Lock reconcile_import_sources EXECUTE to service_role (server-only). It's SECURITY DEFINER and
-- was PUBLIC-executable, allowing cross-tenant reads via a forged p_tenant. Helper uses the service
-- client, so this is non-breaking.
-- Rollback: GRANT EXECUTE ON FUNCTION reconcile_import_sources(UUID, UUID) TO PUBLIC;
BEGIN;
REVOKE EXECUTE ON FUNCTION reconcile_import_sources(UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION reconcile_import_sources(UUID, UUID) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION reconcile_import_sources(UUID, UUID) TO service_role;
COMMIT;
```
Apply to STAGE. Then verify the panel still loads (the service-client call must still work) and that a
direct authenticated `rpc()` call is now rejected — Sadin will confirm in dev; you just confirm the
GRANT state on stage:
`SELECT has_function_privilege('authenticated','reconcile_import_sources(uuid,uuid)','EXECUTE');` → should be `f`.

(Defense-in-depth alternative, NOT required: add a `p_tenant IN (SELECT get_user_tenant_ids())` guard
inside the function. Skip it — the REVOKE is sufficient since the helper is server-only.)

## 2. Explanatory tooltips on the reconciliation panel

All data needed is ALREADY on each `ImportSourceReconciliationRow` (`raw_rows`, `dropped_rows`,
`no_contact_rows`, `with_contact_rows`, `in_crm`, `routed_out`, `still_in_staging`). Add a tooltip
(reuse the existing shadcn tooltip at `@/components/ui/tooltip`; if absent, use a clean accessible
title/popover — match the codebase) to the **In CRM**, **Routed**, and **Still here** cells. Add a small
ⓘ affordance so users know to hover.

- **In CRM** tooltip — compute and show a breakdown (only render lines where the value > 0):
  ```
  You gave: {raw_rows}
  − {dropped_rows} empty rows dropped (no name or contact)
  − {merged} merged into existing / duplicate records
  = {in_crm} in CRM
       ({no_contact_rows} name-only, no phone/email)
  ```
  where `merged = Math.max(0, with_contact_rows + no_contact_rows - in_crm)`.
  This explains both the clean rows (Model Mgmt: −88 dropped → 937) and the merge-heavy row
  (UK Expo: −97 merged → 36, which otherwise reads as an alarming 27%).
- **Routed** tooltip: `"Moved out of staging into the live pipeline."`
- **Still here** tooltip: `"Still in this staging list, awaiting routing. In CRM = Routed + Still here."`

Keep the existing per-row caption. Do not change the numbers or the RPC output — this is presentation only.

---

## Gates / report
- `npm run build` clean · `npx eslint --max-warnings 50` clean.
- Confirm on stage: `has_function_privilege('authenticated', 'reconcile_import_sources(uuid,uuid)', 'EXECUTE')` = `f`.
- **Do NOT block on UI login** — Sadin verifies the tooltips/panel himself in dev.
- Commit on `feature/leads-organise` with a clear message. Then STOP and report (commit hash, migration
  070 SQL, gate outputs, the privilege-check result, any deviation). Do NOT push/PR/merge/prod — Opus
  reviews, then drives the combined push to stage.
