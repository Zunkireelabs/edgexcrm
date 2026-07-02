# Lead Dedup — Phase B7 Brief: harden the finalize fold (draft-email fallback)

> **Executor:** Sonnet. **Reviewer/deployer:** Opus. **Branch:** `feat/lead-dedup-phase-b`.
> No migration. Small, focused change. (Approved plan: `~/.claude/plans/joyful-strolling-island.md`.)

## Why

A duplicate lead was created instead of folding. The actual root cause was a deploy gap (dev ran
pre-dedup code — Opus is handling the deploy). But the investigation surfaced a real latent weakness:
the **finalize fold resolves identity ONLY from the incoming payload's email**. If a multi-step form's
final step doesn't resend `email` (or names the field differently), `resolveLeadIdentity` gets a null
email, finds no match, and the draft is finalized as a standalone **duplicate** — even though the draft
already stored the email from an earlier step. This brief adds defense-in-depth so that can't happen.

## Change — fall back to the draft's stored email/phone in the finalize fold

In `src/app/(main)/api/v1/leads/route.ts`, the **update/finalize path** (`if (leadId && sessionId)`
branch, ~line 333) already loads the draft as `existingLead`. Before resolving identity for the fold,
prefer the payload's normalized email but **fall back to the draft's stored values**:

```ts
const effectiveEmail = normalizedEmail ?? normalizeEmail((existingLead as Lead).email);
const effectivePhone = normalizedPhone ?? normalizePhone((existingLead as Lead).phone);
const updateIdentity = await resolveLeadIdentity(supabase, {
  tenantId, normalizedEmail: effectiveEmail, normalizedPhone: effectivePhone,
});
```

Use `effectiveEmail` for BOTH the fold match and the `normalizedEmail` passed into the fold's
`recordSubmission` + `emitSubmissionAudit` (so the preserved submission carries the right normalized
email). Reuse the existing `normalizeEmail` / `normalizePhone` / `resolveLeadIdentity` from
`src/lib/leads/dedup.ts` — no new helpers.

Apply the **same draft-fallback pattern** to any equivalent finalize-fold that loads an existing draft
in `src/app/api/public/submit/[tenantSlug]/[formSlug]/route.ts` and
`src/app/(main)/api/v1/integrations/crm/leads/route.ts`. **Do NOT touch the create path** (no draft
exists there) — leave it as-is.

## Guardrails
- Branch `feat/lead-dedup-phase-b` only. No deploy, no migration, no backfill runs.
- Verify on **SYNTHETIC** leads, Zunkiree Labs tenant `a0000000-0000-0000-0000-000000000001` only;
  never touch Admizz data. Delete synthetic rows and re-query → 0.
- Both CI gates: `npm run build` clean + `npx eslint --max-warnings 50` → **0 errors** (re-run eslint).
- Stop at review.

## Verify (synthetic)
1. Create lead A on the Zunkiree tenant with email `dup-test@synthetic.invalid` (is_final, real form).
2. Two-step: POST `is_final:false` (draft B, with the same email) → then POST `is_final:true` with
   B's `lead_id` + `session_id` but **omit `email` from the finalize payload**.
3. Assert: B **folds into A** (B soft-deleted/`merged_into=A`, a submission recorded on A, no new
   standalone lead) — proving the draft-email fallback works.
4. Control: repeat with `email` present in finalize → still folds (no regression).
5. Clean up; re-query → 0.

## Sonnet handoff prompt

> On branch `feat/lead-dedup-phase-b`, implement **B7** per `docs/LEAD-DEDUP-PHASE-B7-BRIEF.md`: harden
> the finalize fold so it falls back to the draft's stored email/phone when the finalize payload omits
> them. In `src/app/(main)/api/v1/leads/route.ts` update/finalize path (`if (leadId && sessionId)`),
> compute `effectiveEmail = normalizedEmail ?? normalizeEmail(existingLead.email)` (and same for phone),
> pass them to `resolveLeadIdentity` AND into the fold's `recordSubmission`/`emitSubmissionAudit`.
> Apply the same pattern to any draft-finalize fold in the public-submit and CRM-integration routes;
> do NOT change the create path. Reuse existing `normalizeEmail`/`normalizePhone`/`resolveLeadIdentity`.
> Verify on SYNTHETIC leads in the Zunkiree Labs tenant `a0000000-0000-0000-0000-000000000001` only
> (never Admizz): a two-step submission whose finalize payload OMITS email still folds into the
> existing lead (no standalone duplicate); control with email present still folds. No migration, no
> deploy, no backfill. Run both CI gates (`npm run build` + `npx eslint --max-warnings 50` → 0 errors),
> delete synthetic rows and re-query to confirm cleanup, commit on the branch, stop at review, report
> what changed + test results.
