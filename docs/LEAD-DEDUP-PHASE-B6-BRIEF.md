# Lead Dedup — Phase B6 Brief: real submission dates + form-driven `last_activity_at`

> **Executor:** Sonnet. **Reviewer:** Opus. **Branch:** `feat/lead-dedup-phase-b`.
> **Bundle with B5** (`docs/LEAD-DEDUP-PHASE-B5-BRIEF.md`) — both touch `activities-panel.tsx`, do them in one pass.
> Approved design: `~/.claude/plans/joyful-strolling-island.md` (read it — it has the full rationale).

## Why

After collapsing duplicates, every timeline entry shows **time only** and is stamped with the
**backfill run-time** (all "today"), because `recordSubmission`/`createAuditLog` default `created_at`
to `NOW()` and merge/backfill never pass the absorbed lead's real date. And the leads table sorts by
**first-created** date, so a lead that re-submits a form stays buried (`updated_at` doesn't bump on a
same-data resubmission). Fix: timeline shows **date+time at the real submission date**, and a new
**`last_activity_at`** (form-submissions only) drives the table so re-engaged leads rise to the top.

## HARD RULES

1. **Migration `035` on a LOCAL/throwaway DB only.** Do **NOT** apply it to the shared Supabase DB
   (Opus applies after review).
2. **Synthetic verification only, Zunkiree Labs tenant** (`a0000000-0000-0000-0000-000000000001`).
   **Never touch Admizz (`febeb37c-…`) data.** Do **NOT** run the sadin re-collapse — that's Opus's data fix.
3. **No deploy.** Commit on the branch, run both CI gates, **stop at review**. Delete synthetic test
   rows and **re-query to confirm cleanup** (B1/B4 left orphans by not checking).

## Work (follow the approved plan §1–§6; §7 is Opus-only)

**§1 — Migration `supabase/migrations/035_last_activity_at.sql`:** add `leads.last_activity_at TIMESTAMPTZ`;
backfill `= COALESCE((SELECT MAX(s.created_at) FROM lead_submissions s WHERE s.lead_id=leads.id), created_at)`;
then `SET DEFAULT now()` + `SET NOT NULL`; partial index `(tenant_id, last_activity_at DESC) WHERE deleted_at IS NULL AND converted_at IS NULL`.

**§2 — preserve original date (backdate via optional `createdAt`):**
- `src/lib/api/audit.ts` `createAuditLog`: add optional `createdAt?: string` → set on insert when present.
- `src/lib/leads/dedup.ts` `emitSubmissionAudit` + `recordSubmission`: add optional `createdAt`, thread through.
- Live submissions omit it (→ `now()`); merge/backfill pass `absorbed.created_at`.

**§3 — `touchLastActivity` helper (dedup.ts), called at EVERY submission site, NOT gated on field-patch:**
`UPDATE leads SET last_activity_at = <at ?? now()> WHERE id=leadId AND tenant_id=tenantId AND last_activity_at < <at ?? now()>`
(forward-only = GREATEST/MAX rule). Sites: `api/v1/leads/route.ts` ×5, `api/public/submit/[tenantSlug]/[formSlug]/route.ts` ×3,
`api/v1/integrations/crm/leads/route.ts` ×3 (all live → now); `merge.ts` synthesized submission (`at: absorbed.created_at`,
and also pass `createdAt: absorbed.created_at` into its `recordSubmission` + `emitSubmissionAudit`). A no-field-change
resubmission MUST still bump `last_activity_at`.

**§4 — `undoMerge` (merge.ts) must delete the merge's `lead.submission` audit** (B4 added it; undo currently leaves it →
duplicate timeline entries on re-collapse). After deleting the synthesized submission, also delete
`audit_logs WHERE entity_id=canonical_id AND action='lead.submission' AND changes->'submission_id'->>'new' = synthesized_submission_id`.

**§5 — table + queries:** `src/types/database.ts` add `last_activity_at: string`; `queries.ts:69` (`getLeads`) +
leads GET route `.order(...)` → `last_activity_at` desc; `leads-table.tsx` add `"activity"` SortField (default),
compare case, dropdown item "Last activity" (first), rename column header **"Date"→"Last activity"**, render
`last_activity_at`. Lead detail `key-info-section.tsx` unchanged.

**§6 — timeline date+time:** `activities-panel.tsx` `SystemActivityItem` → `toLocaleString` (`month:"short", day:"numeric",
hour:"numeric", minute:"2-digit"`, show year when not current) in both render branches.

**Also (B5 polish, same file):** in `activities-panel.tsx` — render `lead.merged` as "Duplicate record merged";
in `SubmissionDetail` hide the source badge when `created_via === "backfill"` (map others: Public form / Public API /
Integration / Manual); rename the "Resubmission" badge to "Repeat".

**§7 (Opus-only — build the tooling, do NOT run it):** add an optional `normalizedEmail` filter to `undoBackfill`
(`backfill.ts`) + a `--email` flag on `--undo` in `scripts/dedup-backfill.ts` (mirror the apply scope). Opus uses it
to re-collapse the sadin group after review.

## Verify (synthetic, Zunkiree Labs only — plan §verification)

Apply `035` to a local/throwaway DB; `npm run dev`. (1) Merge a synthetic dup into lead C passing an OLDER `created_at`
→ C's timeline entry shows the **old real date** (submission row + audit), not now. (2) Resubmit C's form with
**identical data** → C's `last_activity_at` jumps to now and C sorts **above** later-created D/E in `getLeads`; timeline
gains a dated entry. (3) Change C's status / log a call → C does **not** move. (4) UI: column reads "Last activity",
default-sorted desc; timeline entries show **date+time**; merge rows read "Duplicate record merged"; backfill entries
have no source badge; resubmissions show "Repeat". (5) No-submission lead → `last_activity_at == created_at`.
(6) Undo+re-apply the synthetic merge → **no duplicate `lead.submission` audits** (§4). CI: `npm run build` clean +
`npx eslint --max-warnings 50` → **0 errors** (re-run it — build-clean ≠ lint-clean). Delete synthetic rows, re-query → 0.

## Sonnet handoff prompt

> On branch `feat/lead-dedup-phase-b`, implement **B6 + the pending B5 polish** per
> `docs/LEAD-DEDUP-PHASE-B6-BRIEF.md` (full design in `~/.claude/plans/joyful-strolling-island.md`).
> B6: (§1) migration `035_last_activity_at.sql` adding `leads.last_activity_at` (backfill = MAX submission date
> else created_at; NOT NULL DEFAULT now(); partial index); (§2) optional `createdAt` threaded through
> `createAuditLog`/`emitSubmissionAudit`/`recordSubmission` so merge/backfill preserve the absorbed lead's real date
> (live submissions keep now()); (§3) a `touchLastActivity` helper called at ALL ~12 submission sites as a separate
> update NOT gated on the field-patch (so a same-data resubmission still bubbles), merge passing `absorbed.created_at`
> (forward-only/GREATEST); (§4) fix `undoMerge` to also delete the merge's `lead.submission` audit (match by
> `changes.submission_id` = synthesized submission); (§5) sort+display the leads table by `last_activity_at`
> (default sort, rename column "Date"→"Last activity", repoint both `.order()` clauses, add the type field);
> (§6) show date+time in the timeline `SystemActivityItem`. B5 (same `activities-panel.tsx`): `lead.merged` →
> "Duplicate record merged"; hide the source badge for `created_via==="backfill"` (map others to friendly labels);
> "Resubmission" → "Repeat". Also (§7) add a `--email`/`normalizedEmail` scope to `undoBackfill`+the script but do
> NOT run it. **Apply migration 035 to a LOCAL/throwaway DB only — never the shared DB; verify on SYNTHETIC leads in
> the Zunkiree Labs tenant `a0000000-0000-0000-0000-000000000001` only, never Admizz; do NOT run the sadin re-collapse;
> do NOT deploy.** Verify the plan's checks (real backdated dates, same-data resubmission bubbles to top, internal
> edits don't move it, no duplicate audits on undo+re-apply). Run both CI gates (`npm run build` + `npx eslint
> --max-warnings 50` → 0 errors), delete synthetic rows and re-query to confirm cleanup, commit on the branch, stop
> at review, report what changed + test results.
