# BRIEF — Form Submissions surface (per-form)

**Author:** Opus (planner) · **Date:** 2026-08-29 · **Executor:** Sonnet session
**Industry scope:** all form-builder industries (`education_consultancy`, `construction`, `travel_agency`) — the feature is `_shared`, so do NOT add an education-only gate.
**Branch:** `feature/form-submissions` off latest `origin/stage`.

---

## 1. Problem

A form submission has no first-class existence in the UI. New submitter → a lead appears in Leads.
Existing submitter → nothing new appears; it is only visible as an activity buried in that lead's
timeline. So "how many people submitted this form, and who?" is unanswerable today. Lead count is
not submission count, and repeat submitters — often the most engaged people — are invisible.

**Goal:** make the submission itself viewable, listed per form. Leads, dedup, activities, routing,
autoresponder: ALL UNCHANGED. This is a read lens over data we already collect.

## 2. The key fact — the data already exists

`lead_submissions` (migration `033_lead_submissions.sql`) is an append-only log that every ingestion
path already writes via `recordSubmission()` in `src/lib/leads/dedup.ts`:

- `src/app/api/public/submit/[tenantSlug]/[formSlug]/route.ts` (widget / public API)
- `src/app/(main)/api/v1/leads/route.ts` (hosted public form at `/form/...` posts here)
- `src/app/(main)/api/v1/integrations/crm/leads/route.ts`
- `src/lib/leads/merge.ts` (synthesizes a row when a lead is absorbed)

Each row carries: `form_config_id`, `matched_existing` (TRUE = landed on an existing lead — exactly
the invisible case), name/email/phone/city/country, `custom_fields`, `file_urls`, `intake_source` /
`intake_medium` / `intake_campaign`, `raw_payload` (verbatim inbound body), `lead_id`, `created_via`.

Two properties that make this safe:
- Rows are written **only when `is_final === true`**, so multi-step drafts do NOT inflate counts.
  One row = one completed submission.
- Merges **repoint** `lead_submissions.lead_id` to the canonical lead, so history survives merges.

**Therefore: NO new writes, NO change to any ingestion path. Do not touch `dedup.ts`, the public
submit route, or `/api/v1/leads`.** If you find yourself editing an ingestion path, stop and ask.

## 3. Decisions already made by Sadin — do not re-litigate

1. **Visibility = whoever can access the Forms feature.** In practice that is already **owner/admin
   only**: `src/app/(main)/(dashboard)/forms/page.tsx` and `forms/[id]/page.tsx` both hard-check
   `role !== "owner" && role !== "admin"` on top of `canSeeNav(permissions, "/forms")` and
   `getFeatureAccess(..., FEATURES.FORM_BUILDER)`. So: **no new permission model.** The new API
   route uses the existing `requireAdmin` + `getFeatureAccess` pattern — copy
   `src/app/(main)/api/v1/form-configs/[id]/route.ts` verbatim for the guard preamble.
2. **Per-form only.** No global cross-form Submissions page in this pass.
3. **Show everything we have.** Default view = all-time, newest first, paginated. No date-window
   default. (Note: rows only exist from the date migration 033 was applied to each DB — pre-033
   submissions were never logged and cannot be recovered. Surface whatever exists; do not fabricate
   or backfill. See §8.)

## 4. Deliverables

### 4a. Migration `217_form_submission_counts.sql` (additive, transactional, rollback line)

Two things:

1. **Index** — no current index covers a per-form query (existing ones are `(lead_id, created_at)`,
   `(tenant_id, normalized_email)`, `(tenant_id, created_at)`):
   ```sql
   CREATE INDEX IF NOT EXISTS idx_lead_submissions_form_created
     ON lead_submissions (tenant_id, form_config_id, created_at DESC)
     WHERE form_config_id IS NOT NULL;
   ```
2. **Counts RPC** for the Forms list — one round trip instead of N count queries:
   ```sql
   CREATE OR REPLACE FUNCTION form_submission_counts(p_tenant_id UUID)
   RETURNS TABLE (form_config_id UUID, total BIGINT, last_30d BIGINT)
   LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
     SELECT form_config_id,
            COUNT(*),
            COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')
     FROM lead_submissions
     WHERE tenant_id = p_tenant_id AND form_config_id IS NOT NULL
     GROUP BY form_config_id;
   $$;
   REVOKE ALL ON FUNCTION form_submission_counts(UUID) FROM PUBLIC, anon, authenticated;
   GRANT EXECUTE ON FUNCTION form_submission_counts(UUID) TO service_role;
   ```
   The REVOKE matters: the function takes a tenant id as a parameter, so it must be callable ONLY
   by the service client (which always supplies `auth.tenantId`). This mirrors the posture of
   migration `195_role_scoping_phase_b_revoke.sql`. Do not grant it to `authenticated`.

Include before/after counts in the migration comment per `_TEMPLATE.sql`. `217` is the next free
number — re-check `ls supabase/migrations | sort | tail` before writing, and never reuse a number.

### 4b. API — `GET /api/v1/form-configs/[id]/submissions`

New file `src/app/(main)/api/v1/form-configs/[id]/submissions/route.ts`.

Guards, in this order (copy from the sibling `[id]/route.ts`):
`createRequestLogger` → `authenticateRequest` → `apiUnauthorized` → `getFeatureAccess(auth.industryId,
FEATURES.FORM_BUILDER)` → `apiForbidden` → `requireAdmin(auth)` → `apiForbidden`.

Then verify the form belongs to the tenant (`form_configs` where `id` + `tenant_id`) → `apiNotFound`
if not. Use `scopedClient(auth)` for the submission query (new route → safe wrapper, per CLAUDE.md).

Query params:
- `page` (default 1), `limit` (default 50, max 200)
- `q` — case-insensitive match across first/last name, email, phone
- `matched` — `new` | `existing` | omitted (maps to `matched_existing = false / true / no filter`)
- `from`, `to` — ISO dates on `created_at`, both optional
- `format=csv` — returns the FULL filtered set as `text/csv` (page through internally at 1000/page,
  the same way `src/industries/education-consultancy/features/campaigns/lib/fetch-submissions.ts`
  does; read its header comment — a bare `.select()` silently truncates at 1000 rows).

Select `id, created_at, first_name, last_name, email, phone, city, country, matched_existing,
created_via, intake_source, intake_medium, intake_campaign, custom_fields, file_urls, raw_payload,
lead_id`, `.eq("form_config_id", id)`, `.order("created_at", { ascending: false })`,
`.order("id", { ascending: false })` as a deterministic tiebreaker (offset pagination without one
can skip or duplicate a row at a page boundary), `.range(...)`, with `{ count: "exact" }`.

Then a second query resolving the referenced leads: `leads` → `id, display_id, deleted_at,
merged_into` for the page's `lead_id` set, chunked in batches of 200 for the `.in()` (long id lists
have blown the undici header limit here before — see `project_counselor_empty_leads_undici_overflow`).
Attach `lead: { display_id, isDeleted, isMerged }` to each row.

Return `apiPaginated(rows, { page, limit, total, totalPages })` — match the meta shape the other
paginated routes already emit.

**Do not** add role-based row filtering (counselor/branch). §3.1 settles it: the surface is
admin-only, so every row in the tenant's form is in scope.

### 4c. UI — `Submissions` tab on the form detail page

`src/industries/_shared/features/form-builder/components/form-builder-page.tsx` already has a
`Tabs` with `steps | branding | attribution | routing | autoresponder` (lines ~312-370). Add a sixth
`TabsTrigger value="submissions"` labelled **Submissions**, placed LAST (after Confirmation Email) —
this is where Sadin's screenshot points. Show the total count next to the label the same way the
`steps` trigger shows its count.

New component `.../form-builder/components/submissions-tab.tsx` (client). Fetches the endpoint above
on first activation of the tab (not on page mount — don't slow the editor).

Table columns: **Date** · **Name** · **Email** · **Phone** · **Source / Campaign** · **Status badge**.
- Status badge: `matched_existing === false` → `New lead` (default variant);
  `true` → `Existing lead` (secondary variant). This is the whole point of the feature — make it
  visually obvious at a glance.
- If the row's lead is soft-deleted or merged, show a muted `Lead deleted` / `Merged` chip and do
  not link out. Otherwise the name links to `/leads/{lead_id}`.

Controls above the table: search input (debounced, → `q`), a filter for All / New / Existing, a date
range, and an **Export CSV** button hitting `format=csv`. Pagination controls below.

Row click → `Sheet` (`src/components/ui/sheet.tsx`) side drawer showing every submitted value:
the typed columns, then each `custom_fields` key/value, then `file_urls` as links, then a collapsible
raw payload. This is the "see the data of the form submitted" half of the ask — `raw_payload` holds
fields the lead record itself never stored.

Empty state: "No submissions yet." — and if the form has zero rows but was created before this
feature, that is expected (§8), do not add a scary message.

### 4d. UI — submission counts on the Forms list

`src/app/(main)/(dashboard)/forms/page.tsx` already fetches form configs with the service client.
Add a parallel `supabase.rpc("form_submission_counts", { p_tenant_id: tenantData.tenant.id })` to
the existing `Promise.all`, and pass a `counts` map into `FormList`.

In `form-list.tsx`, render per form: total submissions, and `N in last 30d` as muted secondary text.
Today the list shows no volume signal at all — this is the at-a-glance "which forms actually work"
answer. Keep it typographic; do not restyle the list.

## 5. Explicitly out of scope

- Any global / cross-form submissions page.
- Any change to leads, activities, dedup, routing, pipelines, or the autoresponder.
- Backfilling pre-033 history (impossible — the rows were never written).
- Charts / time-series analytics. Counts + list only in this pass.

## 6. Verification required before opening a PR

Batch everything above on ONE branch and verify the whole thing together — do not merge it to stage
in incremental slices (this is a standing instruction from Sadin, 2026-08-20).

- `npm run build` clean, `npm run test` green, `npx eslint --max-warnings 50` clean.
- Migration 217 applied to the LOCAL dev DB and verified (`\d+ lead_submissions`, and the RPC
  returns rows for a seeded tenant). **Do not touch stage or prod DBs** — CLAUDE.md hard rule; the
  deploy pipeline applies migrations.
- Hands-on local run (`npm run dev`) as an owner of a form-builder tenant:
  - submit the local public form twice with the SAME email → Leads shows one lead; the form's
    Submissions tab shows TWO rows, the second badged `Existing lead`. **This is the acceptance
    test.** Screenshot it.
  - Search / New-vs-Existing filter / date range each narrow the list correctly.
  - Row click opens the drawer with custom fields + raw payload.
  - Export CSV downloads and the row count matches the displayed total.
  - Forms list shows the counts.
- Negative check: log in as a `counselor` or `viewer` → `/forms` still bounces exactly as it does
  today; the new API returns 403.
- Screenshots are mandatory for the UI (standing rule: green tests are not "tested").

## 7. Report back

Stop at review. Report: files changed, migration number, the acceptance-test screenshot, gate
outputs, and anything you had to decide that this brief did not cover. Do NOT self-merge and do NOT
apply the migration to stage or prod.

## 8. One thing to verify and report, not to fix

Submission rows only exist from the date migration 033 landed on each database. Admizz's migrated
legacy leads (~16k) and anything submitted before then have NO `lead_submissions` rows, so older
forms will legitimately show low or zero counts. Report the earliest `created_at` you observe so
Sadin can set expectations with Admizz — this is a data-history fact, not a bug to patch.
