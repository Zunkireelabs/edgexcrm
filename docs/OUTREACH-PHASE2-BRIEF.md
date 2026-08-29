# Outreach Phase 2 — Drip Sequences + Auto-Send (education_consultancy)

**Status:** briefed, not started
**Branch:** `feature/outreach-sequences-education` (branch from the LATEST `origin/stage`)
**Next free migration number:** **216**
**Author:** Opus planning session, 2026-08-25
**Depends on:** Phase 0 (`src/lib/email/outbound/`, PR #434) + Phase 1 (`email_blasts`, daily-cap throttle
model, PR #436) — both merged to stage (Phase 0+1 also promoted to `main` via PR #443, still dark).

---

## §0 Rules of engagement

1. **STOP AT REVIEW.** Build, push, open a **DRAFT** PR to `stage`. No merge, no self-approve, no
   promotion to `main`. Report back and wait.
2. **Never touch the stage or prod database.** Migration 216 (and any further numbers this phase needs)
   go to your **local** Docker Supabase only. Verify stage/prod ledger state via
   `git ls-tree origin/stage supabase/migrations/` before you start and again right before opening the
   PR — the numbering collision on PR #436 (mid-review, another PR took "212" first) is exactly the
   failure mode to check for.
3. **This phase HAS a visible surface** (new "auto-send" toggle/badge on the sequence editor, and the
   cadence timeline showing real sent-via-EdgeX steps). Screenshots required in your report, same bar
   as Phase 1.
4. Rebase onto `origin/stage` again immediately before reporting.
5. **This phase touches a feature that is ALREADY LIVE ON PROD for `it_agency`** —
   `src/industries/_shared/features/outreach/` (email sequencing, manual-copy model, migs 176/177/187 +
   later AI-drafting additions). Read §2 before touching anything in that folder. Any change that alters
   `it_agency`'s existing behavior, even incidentally, is treated as a production regression, not a
   refactor.

---

## §1 What this is

Admizz wants two things beyond the one-shot blast Phase 1 shipped: **drip sequences** (a multi-step
cadence sent over days/weeks to one lead at a time) and **auto-send** — approve the sequence's design
once, then every step actually sends with no per-draft human click. That second requirement is the
whole point of this phase: it's the opposite of what the existing Outreach feature does today.

## §2 What already exists, and why it can't just be reused as-is

`it_agency` already has a full drip-sequence product: `email_sequences` / `email_sequence_steps` /
`sequence_enrollments` / `sequence_step_drafts` (migs 176/177), with a builder UI
(`sequence-editor-dialog.tsx`), an enrollment table, a lead-detail cadence timeline, and a due-draft
bell (`ops-reminders-scan` → `runOutreachDraftReminders`). Read all of `src/industries/_shared/features/outreach/`
before writing anything — the schema and UI shape below are copied from it deliberately.

But its **engine** (`lib/engine.ts`) is built for the opposite of auto-send: a rep manually copies each
step's draft into their own inbox and clicks "mark sent" (`sent_via: 'manual_copy'`, hardcoded). There
is **no scheduler** — `delay_days` only stamps a cosmetic `due_at` used by the worklist/bell; the next
step's draft is generated synchronously the instant a human dispositions the current one, not when the
delay actually elapses. This was a deliberate choice (PR #267: "zero Google dependency" — avoiding a
real send meant no Gmail OAuth/CASA problem), not an oversight, and it must **stay exactly as-is** for
`it_agency` — real reps depend on it in prod today.

The `draft_source` (`template`|`ai`) and `sent_via` (`manual_copy`|`edgex_send`|`agent`) columns were
put there on purpose as the seam for this exact phase — `'edgex_send'` exists in the schema and is
unused anywhere in code. This confirms the intended path: **promote this table set into a genuinely
shared feature** (per CLAUDE.md's "promote, don't copy" rule — this is precisely a second industry
wanting the same conceptual model), not fork a parallel copy for education. `it_agency`'s behavior must
not change one bit; education's auto-send path is new and additive.

## §3 The two product decisions already made — build to these, don't relitigate them

1. **Cap sharing:** `tenant_email_settings.daily_send_cap` is one shared budget across blasts and drip.
   **Drip sends get priority; a running blast takes whatever capacity is left that day.** Rationale: an
   enrolled lead's cadence is a standing commitment to one person, a blast is a bulk campaign that can
   afford to throttle/resume across days without breaking a relationship with anyone specific.
2. **No per-step approval gate.** Once a sequence is enrolled with auto-send on, every step sends
   automatically — no draft-review click. The existing `draft-review-panel` / `sequence_step_drafts`
   'pending' status stays as the **audit trail** (what was generated, what was sent, when — same as
   today), it just stops being a gate that blocks the send for auto-send sequences. `it_agency`'s
   sequences keep the manual gate exactly as today; this is a new mode, not a behavior change to the
   existing one.

## §4 Schema changes (migration 216+)

- Promote `src/industries/_shared/features/outreach/meta.ts`'s `industries` array to include
  `INDUSTRIES.EDUCATION_CONSULTANCY` alongside `INDUSTRIES.IT_AGENCY`. Register
  `{ meta: outreachMeta }` (or whatever the existing export is named) in
  `src/industries/education-consultancy/manifest.ts`, plus a sidebar entry — check the §7.3 naming note
  in `OUTREACH-PHASE1-BRIEF.md` (education already has a referral feature at `/campaigns`; Phase 1
  provisionally used `/email-campaigns` for blasts — pick a non-colliding route for sequences too, e.g.
  `/email-sequences`, flag it in your report, final naming is Sadin's call same as Phase 1).
- Add `auto_send: BOOLEAN NOT NULL DEFAULT false` to `email_sequences` — per-sequence, not per-tenant or
  per-step. `it_agency`'s existing sequences all default to `false` (no behavior change); education's
  new sequences set it `true` at creation.
- No schema change needed for `sent_via: 'edgex_send'` — the column and its allowed value already exist
  (mig 176). Just start actually writing it.
- Decide whether `sequence_step_drafts` needs a new column linking to the real send record (e.g.
  `email_message_id UUID REFERENCES email_messages(id) ON DELETE SET NULL`, nullable) — needed so the
  cadence timeline can show real delivery/bounce status for auto-sent steps, not just "sent". Recommend
  adding it; confirm the join actually gets used by the UI before committing to it.

## §5 The new engine path — additive, `it_agency` untouched

In `engine.ts`, `advanceEnrollment`'s branch that creates the next step's draft must, for
`auto_send: true` sequences, **not stop at creating a `pending` draft** — it needs to actually fire:

1. When a step's draft is created for an auto-send sequence, don't wait for `due_at` to just sit there
   for the bell to notice. `due_at` must become a real trigger, not decoration. This needs the
   scheduler this feature has never had.
2. Build a new Inngest function (e.g. `sequence-step-send.ts`), same shape as `email-blast-send.ts`:
   scans for `sequence_step_drafts` where `status='pending'`, `due_at <= now`, and the parent
   `email_sequences.auto_send = true`. For each due step: materialize an `email_messages` row
   (`source: 'sequence'`, `source_id: draft.id` or the enrollment id — decide which and be consistent
   with Phase 1's `source_id` convention), reuse `composeRecipientEmail`-equivalent rendering (the
   sequence step's `subject_template`/`body_template`, same merge-tag mechanism), then call
   `sendQueuedEmailBatch` — the exact same send path blasts use, so suppression, bounce/complaint
   handling, and the unsubscribe footer (including the mailing-address fix from PR #444) all apply
   uniformly with zero new code.
3. **Respect §3.1's cap priority.** `sendQueuedEmailBatch`'s existing `getDailyCapStatus` call needs to
   account for priority ordering between the two callers — the cleanest approach is almost certainly:
   the drip worker's batches get enqueued/processed before a same-day blast's remaining batches, e.g. by
   having the blast worker check remaining cap *after* pending drip sends for the day are accounted for,
   or by giving the drip send path first claim on `getDailyCapStatus`'s `remaining` value each run.
   Think through the actual interleaving (Inngest doesn't guarantee ordering between two independently
   triggered functions) and propose the concrete mechanism in your report before implementing — this is
   the one piece of real distributed-systems care in this phase, don't hand-wave it.
4. On successful send: mark the draft `sent`, `sent_via: 'edgex_send'`, stamp the `email_messages` link
   (§4), then call `advanceEnrollment` exactly as `markDraftSent` does today — reuse that function,
   don't duplicate its logic.
5. On hitting the daily cap mid-run: leave the draft `pending` (never mark it `sent` or drop it), same
   "throttled is a first-class state" principle as Phase 1's blast worker. The bell
   (`runOutreachDraftReminders`) already notifies on any `pending` + `due_at` past — that path needs no
   change, it'll naturally flag a throttled drip step as "due" same as it does today for a manual one.
6. `it_agency`'s sequences (`auto_send: false` / default) must take **zero** new code path — verify this
   with a regression test that an `auto_send=false` enrollment's step never gets touched by the new
   Inngest function.

## §6 UI

- Sequence editor: add an "Auto-send" toggle at the sequence level (not per-step) — building this only
  for `education_consultancy`'s manifest registration keeps it invisible to `it_agency` regardless, but
  gate the toggle's visibility in the component itself too, in case the same component ever gets reused
  elsewhere later.
- Cadence timeline / draft-review-panel: for an `auto_send` sequence's steps, replace the
  review/edit/send affordance with a read-only "sent automatically via EdgeX at {time}" line, linking to
  the underlying `email_messages` row's delivery status if §4's link column is built. Never remove the
  audit visibility — just remove the action.
- No changes to `it_agency`'s existing UI paths for `auto_send=false` sequences — same components,
  branch on the flag.

## §7 Testing bar

Same as Phase 1: full local `npm run test` green including any newly-CI-skipped DB-backed tests, local
screenshots of the new toggle + a live auto-send demonstration (enroll a test lead, watch a step
actually send without a manual click, confirm it shows in the cadence timeline as `edgex_send`), and a
regression check that `it_agency`'s existing sequence tests and manual-copy flow are byte-for-byte
unchanged.

## §8 Explicitly out of scope for this phase

- Channel-per-step (SMS/email mixed in one sequence) — that's Phase 3.
- Registering Outreach as a distinct top-level nav item for education beyond what §4 requires — Phase 4.
- Folding `/sms` blasts into a unified channel picker — Phase 5.
- Consent/audience-source gating — settled: Outreach email (blast and now drip) reaches the full
  resolved audience exactly like SMS does, no source-based exclusion.
