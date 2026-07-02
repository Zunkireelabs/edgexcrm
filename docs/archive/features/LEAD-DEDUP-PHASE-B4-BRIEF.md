# Lead Dedup — Phase B4 Brief: submission-timeline completeness (merge entries + form names)

> **Executor:** Sonnet. **Reviewer:** Opus (Sadin pastes the handoff prompt).
> **Branch:** `feat/lead-dedup-phase-b` (continue). **Not** stage. **No new migration.**
> **Prereq:** B1–B3 on the branch. This closes the gap between the lossless data we already
> store and what the lead's **Activity timeline** actually shows.

## Why

The A4 timeline (`SystemActivityItem` in `src/components/dashboard/lead/activities/activities-panel.tsx`)
already renders a `lead.submission` audit row as a **collapsible "Filled {form_name}"** entry that
expands to the submitted form fields/files. The data layer reads `audit_logs` via `getLeadActivity`
(`src/lib/supabase/queries.ts:363`). The problem is the **producers** are inconsistent, so the timeline
is mostly empty:

1. **Merge** (`mergeLeads`, `src/lib/leads/merge.ts`) emits `lead.merged` but **no `lead.submission`** —
   so an absorbed lead's preserved submission never appears as "Filled {form}".
2. **New-lead first submission** (`/api/v1/leads` create path ~line 754, + public-submit + integrations)
   emits a `lead.submission` **event only — no audit log** — so the first "Lead created · Filled {form}"
   never renders (and `lead.created` is already suppressed).
3. **No path sets `form_name`** in the audit `changes`, so `getSystemActivityDescription` (reads
   `changes.form_name?.new`) falls back to **"Filled form"** instead of "Filled Test Prep".

Goal: **every** submission — first, resubmission-fold, and merge — produces a `lead.submission`
audit log carrying `form_name`, so the timeline shows a complete, expandable history:
*"Lead created · Filled Registration Form" → "Filled Spin & Win" → "Filled Test Prep"*, each
clickable to its exact form data.

## HARD RULES

1. **Synthetic verification only, Zunkiree Labs tenant** (`a0000000-0000-0000-0000-000000000001`).
   **Never touch Admizz (`febeb37c-…`) data.** Clean up test rows and **re-query to confirm deletes
   succeeded** (the B1 test left orphans by not checking).
2. **No deploy, no backfill, no shared-DB schema change.** Commit on the branch, run both CI gates,
   stop at review.

## Change 1 — centralize submission-audit emission (with form_name)

Add a helper (put it in `src/lib/leads/dedup.ts` next to `recordSubmission`):

```ts
// Resolves a form's display name (null-safe) for timeline labels.
export async function resolveFormName(
  supabase: SupabaseServiceClient,
  formConfigId: string | null | undefined
): Promise<string | null> {
  if (!formConfigId) return null;
  const { data } = await supabase.from("form_configs").select("name").eq("id", formConfigId).maybeSingle();
  return (data as { name: string } | null)?.name ?? null;
}

// Emits the lead.submission AUDIT (what the timeline reads) + event, consistently.
// formName must already be resolved by the caller (so we don't double-query).
export async function emitSubmissionAudit(
  supabase: SupabaseServiceClient,
  params: {
    tenantId: string; leadId: string; submissionId: string | null;
    isFirst: boolean; matchedExisting: boolean; formName: string | null;
    requestId?: string; ipAddress?: string | null; userAgent?: string | null;
  }
): Promise<void> {
  await Promise.all([
    createAuditLog({
      tenantId: params.tenantId, action: "lead.submission", entityType: "lead", entityId: params.leadId,
      changes: {
        submission_id: { old: null, new: params.submissionId },
        is_first: { old: null, new: params.isFirst },
        matched_existing: { old: null, new: params.matchedExisting },
        form_name: { old: null, new: params.formName },
      },
      ipAddress: params.ipAddress ?? undefined, userAgent: params.userAgent ?? undefined, requestId: params.requestId,
    }),
    emitEvent({
      tenantId: params.tenantId, type: "lead.submission", entityType: "lead", entityId: params.leadId,
      payload: { submission_id: params.submissionId, is_first: params.isFirst, matched_existing: params.matchedExisting, form_name: params.formName },
      requestId: params.requestId,
    }),
  ]);
}
```

## Change 2 — use it at every submission site (replace the inline audit/event blocks)

Resolve `formName` from the relevant `form_config_id` and call `emitSubmissionAudit` in each place
a `lead_submissions` row is written:

- **`/api/v1/leads` create-new path** (~line 722-785): the new-lead first submission currently emits
  only an *event*. Replace with `emitSubmissionAudit(... isFirst:true, matchedExisting:false, formName)`.
  Keep `lead.created` suppressed when a submission exists (the "Lead created · Filled {form}" label
  comes from `is_first:true`).
- **`/api/v1/leads` update-fold path** (~line 420-444) and **create-fold path** (~line 584-643): already
  create a `lead.submission` audit — switch to `emitSubmissionAudit(... isFirst:false, matchedExisting:true, formName)`
  so `form_name` is included. (Resolve formName from the **draft/incoming** `form_config_id`.)
- **`/api/v1/leads` email-unique-race fold** (~line 684-700): currently records a submission but emits
  **no** audit — add `emitSubmissionAudit(... isFirst:false, matchedExisting:true, formName)`.
- **`/api/public/submit/[tenantSlug]/[formSlug]`** and **`/api/v1/integrations/crm/leads`**: same — every
  fold + first-submission site calls `emitSubmissionAudit` with the resolved form name.

## Change 3 — `mergeLeads` emits a submission timeline entry (`src/lib/leads/merge.ts`)

After the synthesized submission is created and the merge row finalized, resolve the **absorbed**
lead's form name and call `emitSubmissionAudit`:

```ts
const formName = await resolveFormName(supabase, absorbed.form_config_id ?? null);
await emitSubmissionAudit(supabase, {
  tenantId, leadId: canonicalId, submissionId: synthesizedSubmissionId,
  isFirst: false, matchedExisting: true, formName, requestId,
});
```

Keep the existing `lead.merged` audit/event. Now the absorbed lead's submission shows on the
canonical's timeline as an expandable **"Filled {form}"** entry (with a "Resubmission" badge from
`SubmissionDetail`). The synthesized submission already stores `custom_fields`/`file_urls`, so the
expand shows the real form data.

## Change 4 (UX) — don't truncate the submission history

In `activities-panel.tsx` the system list is capped at `systemActivities.slice(0, 5)` and sits under a
"System Activity" subheader. For a lead with many submissions that hides older ones. Minimal change:
**raise the cap** (e.g. show all `lead.submission` entries, cap only the noisier non-submission ones),
and keep submissions visually first. Do **not** restructure the tabs — confirm with Opus before any
larger UI change.

## Change 5 (small B3 add) — `--email` scope on the backfill, for the sadin-first test

So we can collapse **only** the `sthasadin@gmail.com` group on Admizz (Sadin's own test data) without
touching any other customer leads: add an optional `--email <addr>` filter to `scripts/dedup-backfill.ts`
+ `planBackfill({ tenantId?, normalizedEmail? })` (filter the grouping query by `normalized_email` when
provided). Dry-run default still applies; the `--yes-i-reviewed-the-dry-run` guard still required for
non-synthetic tenants. **Do not run it on Admizz** — that's Opus+Sadin's step.

## Verification (SYNTHETIC, Zunkiree Labs tenant only)

1. Create a brand-new lead via the dedup create path (curl `/api/v1/leads`, is_final, a real
   `form_config_id`) → its detail timeline shows **"Lead created · Filled {form name}"**, expandable to
   the submitted fields.
2. Submit the **same email, different form** → folds (no new lead) → timeline adds **"Filled {form2}"**.
3. Create two synthetic leads + merge them → the canonical timeline shows the absorbed's
   **"Filled {form}"** entry, expandable to its data, plus the `lead.merged` entry.
4. Confirm every entry shows the **real form name**, never "form".
5. `--email` backfill dry-run on a synthetic same-email group writes nothing; `--apply` on the
   synthetic tenant collapses it and each absorbed shows "Filled {form}" on the canonical.
6. Delete all synthetic rows; **re-query → 0**.

CI gates: `npm run build` clean + `npx eslint --max-warnings 50` (0 errors). After adding route logic,
`rm -rf .next` before re-running dev.

## Sonnet handoff prompt

> Continue Phase B on branch `feat/lead-dedup-phase-b` — implement **B4** per
> `docs/LEAD-DEDUP-PHASE-B4-BRIEF.md`: make every lead submission show up in the Activity timeline.
> (1) Add `resolveFormName` + `emitSubmissionAudit` to `src/lib/leads/dedup.ts` (the audit is what the
> timeline reads — `getLeadActivity` → `audit_logs`; include `form_name` in `changes`). (2) Call
> `emitSubmissionAudit` at every submission site — new-lead first submission (currently event-only, no
> audit), the update-fold, create-fold, and email-race-fold in `/api/v1/leads/route.ts`, and the
> equivalent folds/first-submissions in `/api/public/submit/[tenantSlug]/[formSlug]/route.ts` and
> `/api/v1/integrations/crm/leads/route.ts` — each with the resolved form name. (3) In
> `src/lib/leads/merge.ts`, after finalizing the merge, emit a `lead.submission` audit for the
> synthesized submission (absorbed's form name) so merged data appears as an expandable "Filled {form}"
> entry. (4) In `activities-panel.tsx`, raise the `slice(0,5)` cap so submission history isn't truncated
> (no tab restructure). (5) Add an optional `--email <addr>` scope to `scripts/dedup-backfill.ts` +
> `planBackfill` (filter by `normalized_email`). Reuse `createAuditLog`/`emitEvent`. **Verify on
> SYNTHETIC leads in the Zunkiree Labs tenant `a0000000-0000-0000-0000-000000000001` only — never touch
> Admizz (`febeb37c-…`) data; do NOT deploy; do NOT run the backfill on real data.** Confirm: new lead →
> "Lead created · Filled {form}"; resubmit → "Filled {form2}"; merge → absorbed's "Filled {form}" on the
> canonical; all show real form names; expand shows the form fields. Run both CI gates, delete synthetic
> rows and re-query to confirm cleanup, keep commits on the branch, stop at review, report what changed
> + test results.
