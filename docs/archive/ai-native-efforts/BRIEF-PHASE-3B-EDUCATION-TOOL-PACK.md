# Executor Brief — Phase 3B: education_consultancy AI Tool Pack v1

**For:** Sonnet executor session · **From:** Opus planner · **Date:** 2026-07-17

## Context

Phase 3A (`86f3d0c`) made the manifest's `AiConfig` the home of industry AI expertise. The
real_estate pack (`src/industries/real-estate/ai/tools/`) is the pattern-setter. This brief builds
the second industry pack: **education_consultancy** (Admizz is the real tenant). The industry's
core surfaces (mapped 2026-07-17): application tracking (`applications` +
`application_stages` kanban, mig 057/140), classes + enrollments with fees (mig 065), lead Stages
(`lead_lists`, funnel Pre-qualified → Qualified → Prospects → Applications, mig 059), plus the
already-registered `get_form_submissions_summary`.

Working tree is clean; no Step-0 commit needed. Local prod-mode server is running on :3000;
local Docker Supabase on 54321/54322. **The local DB has ZERO rows in applications /
application_stages / classes / class_enrollments — Step 6 seeds fixtures before live checks.**

## Non-goals

- No affiliates/campaigns/UTM tools (affiliates is blocked anyway: the `record_affiliate_conversion`
  RPC has no migration file — pre-existing flag, do not touch).
- No lead-Stage-funnel aggregate tool (candidate for a later *shared* pack — lead-lists is a
  multi-industry `_shared` feature; an education-only version would be wasted work).
- No writes. `scope: "read"` on every tool; the registry rejects writes anyway.
- No migration, no new deps, no UI changes, no changes to universal tools or the RE pack.

## The 4 tools — `src/industries/education-consultancy/ai/tools/`

All follow the RE pack shape exactly: `AgentTool` from `src/lib/ai/tools/types.ts`,
`industries: [INDUSTRIES.EDUCATION_CONSULTANCY]`, self-gate with
`getFeatureAccess(ctx.auth.industryId, FEATURES.APPLICATION_TRACKING)` (or `FEATURES.CLASSES` for
tool 4) returning `{ error }` on failure, `ctx.db` (ScopedClient) only, relative `href` deep links,
sanitized optional params (`optionalString`/`optionalUuid`/`optionalFilterString` from
`src/lib/ai/tools/universal/lib/sanitize.ts` — the all/any/none/* and NIL-uuid lessons apply),
soft-delete filters (`.is("deleted_at", null)`) on applications and class_enrollments.

### 1. `search_applications`
Input: `{ query?: string≤200 (university/program, tokenized AND or-groups like search_leads),
stage?: string (application_stages slug — existence-check via scoped select, unknown ⇒ report
"unknown stage" + list valid slugs), status?: string, country?: string, intakeTerm?: string,
limit?: 1..50 default 20 }`.
**Counselor scoping MUST MIRROR `GET /api/v1/applications`** (route.ts lines 52-63): when
`shouldRestrictToSelf(auth.permissions)`, first fetch the lead ids with `assigned_to = auth.userId`
and filter applications to those leads. Mirror the route, do not invent broader access (the route
deliberately uses assigned_to only for the list view — collaborator visibility is a per-lead
concept handled by tool 2).
Returns `{ total (count exact), applications: [{ id, href: "/applications", leadId,
leadHref: "/leads/<id>", universityName, programName, country, intakeTerm, stage (slug+name),
status, offerType, applicationDeadline, applicationFeePaid }] }` — aggregate nothing here.

### 2. `get_lead_applications`
Input: `{ leadId: uuid }` (required).
**Apply the same lead-visibility check as `get_investor_commitments`** (`canViewLead` semantics:
assigned_to OR lead_collaborators, per the 1B implementation in the universal tools' lib) and
return the same "Lead not found." for missing vs not-visible — no existence oracle.
Returns the student + their applications: `{ name, href: "/leads/<id>", applications: [{
universityName, programName, country, intakeTerm, stage, status, offerType, deadline,
tuitionFee, applicationFeePaid, depositPaid, notesCount }] }` (join `application_notes` count
cheaply or omit — do not fetch note bodies).

### 3. `application_funnel_summary`
Input: `{}` (like `capital_raise_summary`).
Aggregates over ALL non-deleted applications the caller can see (same counselor mirror as tool 1):
count per `application_stages` stage (ordered by `position`, include stage name+slug+terminal_type),
count per `status`, and `deadlinesNext14Days` (count + up to 5 soonest as
`{ universityName, programName, deadline, leadHref }`). **Aggregate over the full row set — never
from a LIMIT'd page** (the get_offering lesson). If the tenant has zero application_stages rows,
say so plainly ("application tracking not set up yet") rather than returning empty arrays silently.

### 4. `class_enrollment_summary`
Input: `{ classId?: uuid }` (optional — existence-check via scoped select; unknown/foreign id ⇒
fall through to the all-classes summary, probing dead, like pipeline_summary).
Gate on `FEATURES.CLASSES`. No counselor narrowing (the classes REST routes have none — mirror
that; enrollments are tenant-level operational data).
All-classes mode: `{ classes: [{ id, name, href: "/classes", isActive, enrolledCount,
feesCollected (sum fee_amount where fee_paid), feesOutstanding (sum fee_amount where NOT fee_paid),
defaultFee }], totals: {...same sums...} }`. Single-class mode adds the enrollment list (≤25, with
`count: "exact"` + truncation flag; each `{ leadHref, feeAmount, feePaid, enrolledAt }`).
Filter `class_enrollments.deleted_at IS NULL`.

## Wiring (the 3A invariant — packs.test.ts enforces both halves)

- `.../education-consultancy/ai/tools/index.ts` registers all 4 (side-effect module, mirror the RE
  pack's index.ts).
- `packs.ts`: add `import "@/industries/education-consultancy/ai/tools";`.
- `.../education-consultancy/ai/agent.ts`: `toolIds` becomes the 4 new ids +
  `"get_form_submissions_summary"` (keep it — the sync test will fail if dropped), and add this
  `promptAddendum` **verbatim**:

> This tenant is an education consultancy: "leads" in the CRM are student applicants /
> prospective students. Lead Stages form the recruitment funnel Pre-qualified -> Qualified ->
> Prospects -> Applications — always call them "Stages". Students apply to universities/programs;
> each application moves through the tenant's application stages on the Applications board, with
> intakes, offers (conditional/unconditional), deadlines, and fees. Classes are taught courses
> students enroll in, with fees tracked per enrollment. Prefer search_applications,
> get_lead_applications, application_funnel_summary, and class_enrollment_summary for any question
> about applications, universities, programs, intakes, offers, deadlines, classes, enrollments, or
> fees.

- ESLint `createServiceClient` ban already covers `src/industries/*/ai/**` — verify it fires with a
  scratch import, then delete the scratch (same proof as the RE pack build).

## Step 6 — seed local fixtures (SQL against local Docker DB, admizz-local tenant)

Seed enough to make live checks meaningful, e.g.: 4 application_stages (Shortlisted/Applied/Offer/
Enrolled, one terminal_type='won'), 4-6 applications across the 2 existing admizz-local leads
(mix of stages, statuses, one deadline within 14 days, spread across 2+ universities), 2 classes,
3 enrollments (mix fee_paid true/false). Give Aisha Khan (`...0000d1`, the counselor-assigned lead)
at least 2 applications and 1 enrollment so counselor-scope checks have data. Keep a cleanup note
in the report (fixtures stay for reuse, like the counselor account).

## Verify (Opus re-runs independently — report actual outputs)

1. Gates: `NODE_OPTIONS="--max-old-space-size=6144" npm run build` exit 0; lint 0 errors; vitest
   all green (report total). Unit tests for each tool (mock ScopedClient pattern from RE pack tests)
   + packs.test.ts green WITHOUT modification (it auto-covers the new pack — that's the 3A payoff).
2. Live (rebuild + restart :3000 first, note it in the report):
   - `owner@admizz.local` "How are our university applications going?" → `application_funnel_summary`,
     numbers match seeded fixtures exactly.
   - "What has <Aisha Khan> applied for?" → `search_leads`/`get_lead_applications` chain, her 2 apps.
   - "How are class fees looking?" → `class_enrollment_summary`, collected vs outstanding match seed.
   - `counselor@admizz.local` (password `counselor123456`) "list all our applications" → ONLY
     Aisha's applications (assigned-lead mirror proven live).
   - `owner@cre-capital.local` asks an applications question → education tools absent, graceful.
3. SQL cross-tenant probe: scoped select for applications with a cre-capital tenant id returns 0.
4. Diff scope: new `education-consultancy/ai/tools/**` (+tests), `education-consultancy/ai/agent.ts`,
   `packs.ts` (one import line). NOTHING else — no route changes, no universal-tool changes, no
   migrations, no package.json.

## Report back

Standard executor report: per-step outcomes, deviations flagged (never silently), gate outputs
verbatim, fixture SQL included, anything discovered mid-build.
