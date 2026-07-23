# Brief: Outreach AI-Drafting (email-sequencing Stage 2) — template-first + AI-on-demand

**For:** Sonnet executor session. **From:** Opus planner. **Workflow:** you build → produce a
report → Opus reviews the real diff + re-runs gates. **Do NOT merge; do NOT promote; do NOT touch
prod.** Branch off the LATEST `origin/stage`, PR to `stage`, stop at review. This whole feature
**stays on stage** until the ADR-001 D5 gate is signed — no prod promotion in this brief.

---

## 0. The model (read this first — it's the whole point)

Outreach email-sequencing is shipped for `it_agency`: admins build steps, reps enroll leads, each
step produces a draft the rep reviews/copies/sends by hand. This brief makes AI a **helper**, not a
mandatory step. The model is **template-first, AI-on-demand, promote-winners-to-template**:

1. **Template is the default.** Every step keeps its `subject_template`/`body_template`. At step-fire
   time, the draft is generated **from the template** (current behavior) — cheap, consistent, no AI,
   no PII egress. This is what happens unless someone opts into AI.
2. **Manual writing — always.** The rep can freely edit/rewrite any draft in the review panel before
   copy-sending. (Already true; keep it.)
3. **"Draft with AI" — on-demand button.** In the review panel the rep can click **Draft with AI** to
   (re)generate *that* draft for *that* lead using the LLM + the step's AI instructions. Click again
   → a fresh take. AI never runs unless a human asks (or an admin opts a step into auto-AI, §6).
4. **"Save as template" — admin promotes a winner.** When content lands (hand-written or from Draft
   with AI), an **admin** can save it back onto the step's template, so future enrollments start from
   that proven copy instead of drafting fresh. This is the "once we have content that works, make it
   the template" loop.

**Layering vs the D5 gate:** the template/manual/save-as-template parts use **no AI** and are not
D5-blocked; the **Draft with AI** button + auto-AI steps + the drafter are the AI parts, gated per §1.
Build it all on one branch; it all stays on stage this round (Sadin's call).

---

## 1. THE GATE — governs every AI call

AI-drafting egresses **lead PII** (name, email, phone, city, custom_fields) to the model → the
**ADR-001 D5 privacy gate** (not yet signed for prod). Gate every AI call exactly like the rest of
the AI layer, reusing the **two-part gate** in `src/lib/ai/flag.ts`:

- **Env kill-switch** — add `AI_OUTREACH_DRAFT_ENABLED`, shaped like `isIngestionEnabled()`.
- **Per-tenant grant** — `tenants.ai_enabled` (mig 174). Add an exported
  `isOutreachDraftEnabledForTenant(tenantId)` that ANDs the env flag with `ai_enabled` (mirror
  `isIngestionEnabledForTenant`). **Both must be true.**

Behavior when the gate is NOT satisfied (e.g. prod until D5, or a non-`ai_enabled` tenant):
- The **Draft with AI** button is **hidden/disabled** (don't show reps a dead button).
- An **auto-AI step** (§6) **falls back to template-merge** at fire time (`source:'template'`), so the
  cadence never breaks and no PII reaches any model.

Result: the feature ships everywhere; AI only *activates* where the gate passes (stage +
`ai_enabled` tenant). Do NOT invent a bespoke flag or new per-tenant column — reuse `flag.ts` +
`ai_enabled`. For stage testing, ensure `AI_OUTREACH_DRAFT_ENABLED=true` is added to the staging AI
env block (deploy-staging renders it) and use an `ai_enabled` tenant.

---

## 2. Migration (additive, one file)

Next globally-unique number: `ls supabase/migrations/ | sort | tail` (176/177 are the existing
outreach migs — don't reuse).

```sql
-- <NNN>_outreach_step_ai_instructions.sql
-- Additive: optional per-step AI drafting guidance, used by both the on-demand
-- "Draft with AI" action and (optional) auto-AI steps. Template fields unchanged.
-- Rollback: ALTER TABLE email_sequence_steps DROP COLUMN ai_instructions;
BEGIN;
ALTER TABLE email_sequence_steps
  ADD COLUMN IF NOT EXISTS ai_instructions TEXT;
COMMIT;
```

- No RLS change (inherits the table's admin-only-mutate policies).
- Add the self-recording ledger line (Migration Guard CI fails the PR without it — copy the shape
  from any recent ≥123 migration).
- Apply to STAGE only (`dymeudcddasqpomfpjvt`), in a txn, before/after column check. **Never prod.**

---

## 3. The shared drafter — `src/lib/ai/draft-email.ts` (NEW)

One reusable drafter (the real-estate `comms/draft` route is a MOCK — it is the *contract* precedent
only; do not copy its body). **Read + reuse the AI foundation infra:** `src/lib/ai/provider.ts`,
`models.ts`, `budget.ts`, `telemetry.ts`, and how the assistant chat route calls the model (grep
`src/app/(main)/api/v1/ai/`). Contract:

```ts
export interface DraftEmailInput {
  tenantId: string;
  tenantName: string;
  lead: LeadTemplateContext;             // reuse the type from outreach/lib/engine.ts
  sequence: { name: string; description: string | null };
  step: { stepOrder: number; totalSteps: number; instructions: string | null };
}
export interface DraftEmailResult { subject: string; body_html: string; }
export async function draftSequenceEmail(input: DraftEmailInput): Promise<DraftEmailResult>;
```

Requirements:
- Model from `models.ts` (latest Claude the foundation uses — reuse, don't pick a new one).
- **Enforce the per-tenant daily token budget** (`budget.ts`) — over budget → typed error → caller
  falls back to template.
- **Langfuse telemetry** (`telemetry.ts`), trace name e.g. `outreach.draft`, tagged tenant/sequence/
  step.
- Prompt: system prompt = "write ONE email in a multi-step outreach cadence for {tenantName}"; give
  it sequence name/description, "step N of M", the admin `instructions`, and lead context; return
  structured `{subject, body_html}` (use the foundation's structured-output pattern; else parse a
  delimited response). Body = safe HTML (`<p>/<br>/<a>`, no scripts); trim/sanitize.

---

## 4. Fire-time generation — `outreach/lib/engine.ts`

Make `generateStepDraft` **async** and gate-aware; keep template as the default.

```ts
export async function generateStepDraft(params: {
  step: Pick<SequenceStepRow, "draft_source" | "subject_template" | "body_template"> & { ai_instructions?: string | null };
  lead: LeadTemplateContext;
  tenantId: string; tenantName: string;
  sequence: { name: string; description: string | null };
  stepOrder: number; totalSteps: number;
}): Promise<GeneratedDraft>
```

- If `step.draft_source === 'ai'` (an admin-opted auto-AI step) AND
  `await isOutreachDraftEnabledForTenant(tenantId)` → `draftSequenceEmail(...)` → `{...,'ai'}`. On ANY
  error → log + fall through to template.
- Otherwise → current `renderTemplate` path → `source:'template'`. **This is the default for every
  ordinary step.**
- Update `createDraftForStep` (the only caller): also load the sequence (name/description) + compute
  `totalSteps`, add `ai_instructions` to `SequenceStepRow` + pass through, and `await` the now-async
  call.
- **Do NOT touch `markDraftSent`** — send stays manual-copy (`sent_via='manual_copy'`, log-only).

---

## 5. On-demand "Draft with AI" — `POST /api/v1/outreach/drafts/[id]/regenerate` (NEW)

- Mirror `drafts/[id]/skip/route.ts` for auth: `getFeatureAccess(OUTREACH)` + `scopedClient` +
  own-scope for non-admins; only while draft `status='pending'`.
- **Gate:** require `isOutreachDraftEnabledForTenant(auth.tenantId)` → else `apiForbidden()` (the UI
  hides the button, this is defense-in-depth).
- Loads the draft's step + lead + sequence, calls `draftSequenceEmail(...)` (NOT the fire-time
  template path — this button is explicitly "use AI"), UPDATEs the draft's `subject`/`body_html`, sets
  `draft_source='ai'`, resets `edited=false`. On drafter error → `apiError` (don't wreck the existing
  draft).
- **UI** (`outreach/ui/draft-review-panel.tsx`): a **Draft with AI** button, shown only when the gate
  is satisfied for the tenant (thread the flag through, or a tiny `GET` capability check). Double-click
  guard; toast on success/failure; refresh panel content.

---

## 6. Authoring a step — builder + validation + persistence

- **`outreach/ui/sequence-editor-dialog.tsx`**: every step still shows **template** subject/body
  fields (always). Add: an optional **AI instructions** textarea (guidance for both the on-demand
  button and auto-AI) + an optional **"Auto-draft with AI at fire time"** toggle (sets
  `draft_source='ai'`; default OFF = `'template'`). Helper text: AI drafts are reviewed by a human
  before sending; leave a template as the fallback.
- **`outreach/lib/validate-steps.ts`**: accept `draft_source ∈ {'template','ai'}` (default
  `'template'`) + optional `ai_instructions`. If `draft_source='ai'`, require `ai_instructions`
  non-empty. `subject_template`/`body_template` stay (optional fallback for AI steps — may be `''`).
- **`sequences/route.ts` (POST)** + **`sequences/[id]/route.ts` (PATCH)**: currently drop
  `draft_source` — persist `draft_source` + `ai_instructions`. See §8 for the enrollment-guard change.

---

## 7. "Save as template" — admin promotes a winner

- **Admin-only.** A **Save as template** control in `draft-review-panel.tsx`, visible only to
  admins/owners (role check).
- **Genericization guard (important):** a draft is *rendered* ("Hi John…"); saving it verbatim would
  bake one lead's details into the shared template. So Save-as-template opens an **editable
  confirm view** (small modal/inline) pre-filled with the draft's current subject/body_html + a
  reminder banner: *"Replace lead-specific details with merge tags — {{first_name}}, {{last_name}},
  {{city}} — so future leads are personalized."* Admin edits → confirms.
- On confirm → PATCH the step's `subject_template`/`body_template` via the existing
  `sequences/[id]/route.ts` step-update path (reuse it; don't add a write route unless cleaner). Only
  the two template text fields change.
- After saving, that step's future fire-time drafts use the new template. Existing pending drafts are
  untouched.

---

## 8. Relax the active-enrollment edit guard (template text only)

- Today `sequences/[id]` PATCH blocks step edits while the sequence has active enrollments (protects
  cadence math). **Relax it: allow edits that change ONLY `subject_template`/`body_template`
  (and `ai_instructions`) even with active enrollments** — these affect only newly-generated drafts,
  not in-flight ones. **Keep the block** for structural changes (`step_order`, `delay_days`, adding/
  removing steps, `draft_source` flips). Implement by diffing the incoming step change against the
  stored step: text-only diff → allow; structural diff with active enrollments → keep blocking.

---

## 9. Non-goals (do NOT build)

- No native/autonomous send (Stage 3, Path-A-OAuth-gated, separate brief). Send stays manual-copy.
- No reply-monitoring / Path B / `gmail.readonly`.
- No new AI infra — reuse `provider/models/budget/telemetry`. No bespoke flag beyond §1's env flag,
  no new per-tenant column.
- Don't touch the Inngest jobs, the draft-due bell, or the badge — draft *generation* only.
- No prod promotion, no flag-on for prod, no prod migration.

---

## 10. Verification (include all in your report)

- `rm -rf .next && NODE_OPTIONS=--max-old-space-size=6144 npm run build` clean (only when no dev
  server is live). `npx tsc --noEmit` clean. `npx eslint --max-warnings 50 src/` clean.
- Migration on STAGE only; `ai_instructions` present; ledger row recorded; prod untouched.
- **Manual stage flow:**
  - **Default (template) step:** enroll a lead → draft is `draft_source='template'`, byte-identical to
    today (no regression). Manual edit still works. Copy/mark-sent logs `lead_activities` with
    `sent_via='manual_copy'`.
  - **Draft with AI, gate ON** (`AI_OUTREACH_DRAFT_ENABLED=true` + `ai_enabled` tenant): button
    visible → click → draft becomes AI-written + personalized, `draft_source='ai'` → click again → a
    different draft. No change to the send path.
  - **Draft with AI, gate OFF** (flag unset OR non-`ai_enabled` tenant): button hidden; the regenerate
    route returns 403; auto-AI step (`draft_source='ai'`) falls back to `template` at fire; zero
    Langfuse trace / zero budget spend.
  - **Save as template (admin):** edit a draft → Save as template → confirm view lets me insert merge
    tags → step template updates → a NEW enrollment of that step starts from the saved template.
    Confirm a non-admin does NOT see the control and the step-update path rejects them.
  - **Guard relaxation:** with an ACTIVE enrollment on a sequence, a template-text edit succeeds; a
    structural edit (delay/order) is still blocked.
- Industry gate holds: non-`it_agency` tenant → `/outreach` 404, routes 403.

## 11. Guardrails

- Branch from latest `origin/stage`; rebase before requesting review; squash-PR to `stage`.
  **Do not merge, do not promote to main, do not enable the flag/migration on prod.**
- `scopedClient(auth)` for all tenant queries; preserve counselor/own-scope on every route touched;
  admin-gate the auto-AI toggle + Save-as-template.
- Report the REAL diff (drafter, seam change, regenerate route, save-as-template, guard change,
  migration) + the full two-gate-state stage verification. Opus re-runs gates + reviews independently.
