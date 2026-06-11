# Lead Gen CRM — Session Log

> Single source of truth for cross-session continuity. Most recent milestone first.

**Project**: Multi-tenant Lead Gen CRM SaaS for Zunkiree Labs
**Status**: Phase 2A complete — verified and passing all 39 tests
**Live**: https://lead-crm.zunkireelabs.com
**Repo**: `Zunkireelabs/edgexcrm` (GitHub)

---

## 🟢 NEXT SESSION — RESUME HERE

- **LATEST (2026-06-11): UNIFIED INBOX — REAL WHATSAPP LIVE END-TO-END ON DEV.** Phases 1 + 2 + 3a all shipped to `stage` (HEAD `0279241`). **A real WhatsApp message flows both directions on `dev-lead-crm`**: phone → Meta → webhook → `/inbox` (inbound), and `/inbox` reply → phone (outbound), with **delivery/read receipts** working. Proven with a real number. **Single source of truth: `docs/UNIFIED-INBOX-BRIEF.md`** (see its *Live state log* + *Prod-promotion checklist*). **Phase 2** (`8c19dbc`): notifications-on-inbound (`upsertThreadNotification`, deep-link `/inbox?conversation=`) + `inbox-process.yml` GH workflow; Opus folded a deep-link fix. **Phase 3a** (`0279241`): connect-a-channel Settings UI (paste creds, admin-only) + Meta webhook POST (HMAC verify → route by `phone_number_id` → enqueue) + **AES-256-GCM token encryption** + enforced 24h-window guard + status callbacks; Opus review clean. **Dev wiring done:** Meta app "EdgeX CRM" published; **permanent System User token** (temp tokens expire in hours → caused 131005 — must use System User); WABA subscribed to app (`subscribed_apps` — the use-case flow doesn't auto-do it; real inbound was silently dropped until then); 4 WhatsApp env vars on the dev box; **dev auto-drain cron** `*/1` on the VPS (Sadin-authorized) so inbound drains within ~1 min. **NEXT:** **Phase 3b** = near-instant inbound (inline-process after fast-ack; brief `docs/UNIFIED-INBOX-PHASE-3B-BRIEF.md` — inbound lags up to 60s on dev today because of the 1-min cron). Then **prod promotion** (checklist in the brief: env vars on prod + prod-URL drain + privacy page + real number). **Not on prod yet.**

- **(2026-06-11): UNIFIED INBOX (omnichannel) v1 — SHIPPED TO STAGE.** `stage` @ `9eb782a` (`--no-ff` merge of `feature/unified-inbox`; deploy run `27334257254` ✅ success 5m54s; dev smoke `/login` 200, `/` 307). Branch commits: `4f2b56b` Sonnet foundation → `e7dada2` 6 fixes + smoke tool → `fb72713` counselor PATCH lock → `41653ad` docs. **Live on `dev-lead-crm` but inbound NOT yet wired** (Phase 2): the dev VPS still needs `INBOX_SANDBOX_SECRET` + the inbound processor cron before sandbox inbound processes. Prod promotion is a separate later GO (code-only — mig 044 already on shared DB). **Single source of truth: `docs/UNIFIED-INBOX-BRIEF.md`.** Global feature; 3-pane omnichannel inbox (WhatsApp/Messenger/Instagram shape) on channel-agnostic `inbox_channels`/`conversations`/`messages` (mig **044**, already applied to shared DB — additive, dormant for prod). **v1 = sandbox loop only** (real Meta channels deliberately deferred; WhatsApp adapter built but flag-disabled; Messenger/IG stubs). **AI-native seams** in place (no live model): `author_type='ai_agent'`, `status='draft'` approval, `ai_metadata`, `ai_autonomy`, 4 declared tools, ONE `sendMessage` path for human+AI. **Verified live end-to-end** on a seeded sandbox channel (inbound→thread→human reply→sent; dedup; convert-to-lead; realtime). Both gates green. **Opus folded in 7 review fixes** (4 code-review + 3 only catchable by running it: realtime publication, `'processed'`→`'completed'` event-status, convert-to-lead `tenant_id`). **NEXT — Phase 2 (in progress):** (a) wire the dev VPS — `INBOX_SANDBOX_SECRET` + inbound processor cron (`POST /api/internal/inbox/process`, Bearer `INTERNAL_CRON_SECRET`, ~every 1–2 min, same as the email poll) — NEEDS Sadin's VPS authorization; (b) notifications-on-inbound (reuse `upsertThreadNotification`). Then Phase 3 (connect-a-channel UI + WhatsApp go-live). Local `.env.local` already has both secrets; sandbox channel `b0000000-…-0001` seeded for Zunkiree Labs (cleanup SQL in the brief).

- **LATEST (2026-06-10): FULL stage→main PRODUCTION PROMOTION — SHIPPED.** `main` @ `6bde3d3` (`--no-ff` merge "production promotion 2026-06-10"; prev prod HEAD `268d3ba`); prod deploy run `27280493495` ✅ success; prod smoke ✅ `/login` 200, `/` 307. Both gates re-run by Opus on stage HEAD before push (build clean; eslint 0 errors / 27 warnings). Sadin gave explicit GO. **Code-only promotion** — the only migration in the delta, `043_travel_agency_industry.sql` (additive industry row), was already applied to the shared Supabase DB. **What went live (the whole backlog prod was behind on):** (1) Leads Column Manager P1+2, (2) compact toolbar restyle across list pages, (3) OTA prospect industry (it_agency), (4) the **entire Travel Agency industry** (Phase A/B — Trip Inquiry panel, travel pipeline, itinerary/quote builder + branded printable proposal, Packages catalog, Itineraries list, package-of-interest on leads), (5) **Edit Lead** (inline detail-page editing + `normalized_email` recompute on email change), (6) **leads-table row actions** moved to a front hover ⋯ slot (trailing Actions column removed). `stage` == `main` content at promotion (modulo this docs entry, which stays on stage and rides the next promotion). **Note:** Travel Agency industry CODE is now on prod but dormant — no prod tenant has `industry_id='travel_agency'` (the Arya demo tenant lives in the shared DB with fixed UUIDs but is reachable from both envs). **NEXT:** Sadin's prod smoke (Edit Lead + row-action hover + Travel Agency surfaces on `lead-crm`); the Arya pitch; then the next travel roadmap feature (package templates → auto-fill itinerary).

- **LATEST (2026-06-10): Leads-table row actions relocated — SHIPPED TO STAGE.** `stage` @ `b9d98f5` (`--no-ff` merge of `feature/lead-row-actions-front`; deploy run `27278780126`). Follow-up to the Edit Lead feature below. **What changed:** the row `⋯` (Edit) menu moved from a trailing **"Actions" column** (which also held a duplicate eye/Link) to a **thin reserved slot between the checkbox and the avatar**, revealed on **row hover** (opacity-based → zero layout shift; stays visible while its menu is open via `data-[state=open]`). The **entire trailing Actions column + its eye are removed** — preview is unaffected because it already lives as the inline "👁 Preview" hover chip next to the name (`columns-registry.tsx:147`). Avatar untouched. Left padding around the slot tightened (gap 20px→8px; checkbox `pr-3→pr-1`, slot `px-2→px-1 w-8→w-7`, Sadin eyeballed). Registry `actions` anchor deleted; `getLeadColumns` simplified to `[...staticCols, ...customCols]`; `totalColSpan = 3 + visibleColumns.length`. Two files (`leads-table.tsx`, `columns-registry.tsx`), net −28 LOC. Opus brief (`docs/archive/features/LEAD-ROW-ACTIONS-BRIEF.md`) → Sonnet exec (gate honored, clean execution, no nits) → Opus review (both gates re-run) → Opus folded in the padding tweak → merged. Rides the same next `stage→main` promotion bundle.

- **LATEST (2026-06-10): Edit Lead (inline, detail-page) — SHIPPED TO STAGE.** `stage` @ `26dbe83` (`--no-ff` merge of `feature/lead-edit`); deploys dev on push. **PROD (`main`) still @ `268d3ba`** — does NOT have this, Travel Agency, Column Manager, restyle, or OTA. **What it is:** lead identity/intake fields were read-only on `/leads/[id]` — there was no way to edit a lead. Now an **Edit** button flips name/email/phone (contact card) + city/country/preferred-contact/intake-source/campaign (key-info), plus it_agency company fields (salutation/company-name/company-email/designation/prospect-industry, gated to it_agency tenants), to inputs **together**; **Save** sends ONE awaited PATCH of changed-fields-only with `res.ok` + toast handling + immediate display update from `json.data` (no stale-render); **Cancel** discards. Leads-table row **⋯ menu → Edit** deep-links to `/leads/[id]?edit=1` (auto-opens edit mode, strips the param). **No new API/migration** — `PATCH /api/v1/leads/[id]` already accepted every field; the one backend change is recomputing `normalized_email` on email change (reuses `dedup.ts normalizeEmail`) so dedup/merge keys stay correct — a latent bug had email edits never been wired through the UI before. Shared `src/lib/leads/lead-validation.ts` (`isValidEmail`/`isValidPhone`/`validateLeadIdentity`) now backs BOTH AddLeadSheet and the edit form (extracted from AddLeadSheet's local copies). **Workflow:** Opus brief (`docs/archive/features/LEAD-EDIT-BRIEF.md`) → Sonnet exec on `feature/lead-edit` (stopped at review, gate honored — nothing pushed) → Opus post-hoc review (both gates re-run; backend fix + save path + currentLead-propagation + table-kebab stopPropagation + it_agency gating all verified correct) → Opus folded in 2 trivial cleanups (wired the orphaned `validateLeadIdentity` into both call sites; dropped a dead `budget` var) → `--no-ff` merge to stage. **Field scope deliberately non-overlapping** with existing inline controls (stage/assign/tags/type/trip/package/professional each keep their own affordance — one place to edit each field). **Deferred (non-blocking):** soft dedup warning when editing email to one that already exists (backend key-fix is done; only the optional UI warning skipped). **NEXT:** Sadin smokes on dev (matrix in STATUS-BOARD). Then this rides the next `stage→main` promotion bundle (with Travel Agency + Column Manager + restyle + OTA) on Sadin's GO.
- **(2026-06-09 PM): Zunkiree lead-data cleanup + 4 new prospect industries — SHIPPED TO PROD + DATA APPLIED.** `main` @ `268d3ba` (non-FF merge `stage→main`; prod deploy `27212863674` ✅; `/login` 200). **Code:** added **Banking / Energy / Media / Airlines** to `PROSPECT_INDUSTRIES` (`src/industries/it-agency/leads/prospect-industries.ts`, enum 13→17; commit `c32b62d`) — that constant drives API validation + filter dropdowns + label renderer, so it had to ship to prod before the data landed. **Data (shared DB, Zunkiree tenant `a0000000-…-0001`, it_agency, 1030 live leads):** the 4 imported sources (Marketing.xls 555, FCAN_Members 245, Updated Corporate DB 113, Members list 94) had `company`/`designation` buried in `custom_fields` and `prospect_industry` 100% null. Backfilled `company_name`←`custom_fields.company` (863), `designation`←`custom_fields.designation` (734), and set `prospect_industry` for 863 leads via an AI-classified, Sadin-reviewed company→industry map (734 distinct companies; FCAN all→construction). **167 no-company leads left null** (honest — no signal; filterable via the `__none__` "None" option). Final dist: construction 246, banking 131, other 111, hospitality 70, media 55, nonprofit 36, manufacturing 33, retail 32, finance_fintech 31, technology 27, healthcare 27, government 23, education 21, logistics 8, airlines 8, energy 3, real_estate 1, null 167. Applied in ONE reversible txn (tenant-scoped; verified 0 rows in other tenants touched). **Reversible backup + tooling at `~/zunkireelabs-leads-snapshot-20260609/`** (`leads_before.csv` full pre-state, `classify.py` rule-based classifier, `companies_classified.csv` review sheet, `co_map.csv`, `apply.sql`). **NOT in repo** (one-off data op). Spot-checked: Citizen Bank→banking, IMPREGILO→construction, NAC→airlines, West Seti→energy, Prisma Advertising→media.
- **(2026-06-09): Per-form email AUTORESPONDER + it_agency lead-enrichment — PROMOTED TO PRODUCTION.** `main` @ `40cd186` (non-FF merge `stage→main` "production promotion 2026-06-09"; prev prod HEAD `4773655`); prod deploy run `27201134166` ✅ success; prod smoke ✅ `/login` 200, `/` 307. Both gates re-run by Opus before push (build clean; eslint 0 errors / 27 baseline warnings). **Option A (ship both)** chosen — the `stage→main` merge promoted the 12-commit delta: autoresponder (5 commits) + it_agency lead-enrichment (4 commits: Lead Owner / Salutation / Company Email / B2B form / prospect-industry capture) + 3 docs commits. **Code-only promotion** — migrations 039/040 (it_agency) + 041/042 (autoresponder) all already applied to shared Supabase, no migration step. it_agency lead-enrichment is now LIVE on prod (was previously the parked "awaiting GO" item — promoted alongside). `stage` == `main` content at promotion. The autoresponder detail block below is now HISTORY (all live on prod).
- **(2026-06-09 superseded): Per-form email AUTORESPONDER — SHIPPED TO STAGE, dev smoke GREEN.** `stage` @ `60bb891` (merged PR #11); `main` (PROD) was @ `4773655`. **Migrations 041 (`automation_email_log` table) + 042 (`form_configs.autoresponder` JSONB column) ALREADY APPLIED to shared Supabase → prod promotion is CODE-ONLY.** Note: `automation_email_log` @ mig 041 **is the shared send-log the parked Email Phase 1.2 anticipated** (it had said "migration 039", but 039/040 went to it_agency) — Phase 1.2 timeline-mirroring can reuse this table. **What it is:** per-form confirmation/receipt email to the submitter, with `{{merge-tags}}` echoing submitted fields; config = JSONB `form_configs.autoresponder {enabled, fire_mode:'every'|'first', subject, body_html}`; new **"Confirmation Email" tab** in the form-builder (`_shared` feature → education_consultancy + construction only). **Implementation:** `src/lib/email/form-autoresponder.ts` (send + fire-mode gate + structured `FORM_AUTORESPONDER` logging + `\n→<br>`) + `render-template.ts` (shared merge engine: `custom_fields` → standard lead cols → `tenant_name`; body escapes VALUES then `\n→<br>`; subject not escaped). Sends via Resend `EMAIL_FROM` (`noreply@lead-crm.zunkireelabs.com`), logs every attempt to `automation_email_log`, fire-and-forget. `email-forward.ts` refactored onto the same render engine. **Wired into BOTH submit entry points:** `/api/v1/leads` (hosted form — new-insert, multi-step-finalize, dedup-fold) AND `/api/public/submit/[tenantSlug]/[formSlug]` (API-key integrations). **Key gotcha discovered:** the hosted form posts to `/api/v1/leads`, NOT `/api/public/submit` — the original build wired only the latter, so it never fired for real form submits (fixed in `f249cae`). **Commits in stage:** `8846dca` (Sonnet original) → `f249cae` (endpoint wiring + `\n→<br>` formatting + logging) → `33cb311` (audit fixes). **Audit DONE** (3 independent adversarial passes — round-trip, HTML-injection, crash-safety, fire-mode, tenant-isolation all clean); fixes in `33cb311`: tenant-scoped the `form_configs` reads in `/api/v1/leads` (request-controlled `form_config_id` could load another tenant's template); duplicate-form route now copies `autoresponder`/`attribution`/`target_pipeline_id`; `fire_mode:every` resends render against patched lead not stale pre-patch object; subject/body length caps; mig 041 idempotent; clipboard guard+toast. **Dev smoke GREEN** (Prime Ceramics, tenant `6e553dc9-eef4-4b1b-8eca-ee2c2a315dd2`, form `download-catalogue` `72351684-69ea-43ba-9e0e-bb8ea66c44f8`): POSTed 2× `@zunkiree.invalid` to deployed dev `/api/v1/leads` → #1 new (201) + #2 dedup-fold (200); BOTH autoresponder rows `status=sent` with Resend message_id; cleaned 0 residue. CI on PR #11 green (Lint/TypeCheck/Build); Vercel "fail" is a SYSTEMIC unconfigured preview integration (fails on stage too) — ignore. Sonnet brief archived at `docs/archive/features/FORM-AUTORESPONDER-BRIEF.md`. **TWO OPEN ITEMS (Sadin to decide, recs given):** (1) **PROD GO?** → `git checkout main && git merge stage && git push origin main` → monitor `deploy.yml` (code-only, no migration step). (2) **Pipeline-email-on-fold** (product decision): on re-download (dedup-fold) the autoresponder re-fires but the pipeline email-forward stage-rule does NOT (pre-existing gap, unchanged) — REC: leave as-is (once-per-lifecycle "welcome" shouldn't re-fire per download). **Deferred in feature** (PR #11, non-blocking): no autoresponder on the rare email unique-index race-fold; full per-submission merge echo partial (dedup existing-key-wins); file attachments / generated `{{catalog_link}}` download = v2 (currently just echoes the typed value).

- **(2026-06-08 night): email-forward rules now fire on lead CREATION — SHIPPED TO PROD** (`main` @ `4773655`, prod deploy `27141186762` ✅, `/login` 200). Closes the "fires on stage *change*, not *creation*" limitation noted in the entry below: a form submission now auto-triggers the matching `email_forward_rule` without a manual kanban drag. `processEmailForwardRules` wired fire-and-forget at **4 call sites** — Mode B public-submit (fresh create 201 + resubmission dedup-fold) and Mode A `/api/v1/leads` (fresh create + multi-step finalize), all `is_final`-guarded, `newStageId = resolved.stageId`. **Verified end-to-end on dev** (shared DB): API submit → Prime `download-catalogue` → lead at Catalogue/New (`34df6d8d`) → logs `Processing email forward rules` (ruleCount 1) → `Email forward sent` (rule "Prime Ceramics", Resend messageId) **with no manual move**; safe `@…`-tagged test lead + key fully cleaned up (guarded txn, 0 residue). Branch `feat/email-rule-on-create` (Sonnet exec → Opus post-hoc review: both gates re-run, 4 sites verified, casts safe). **Intended v0 gaps:** no idempotency log yet → resubmit-fold + create→move-away→back re-fire; Mode-A dedup-fold returns don't fire (deferred); Mode-B race-fold correctly fires once via winner. **Phase 1.2 SPEC'D + PARKED (2026-06-08 night) — not a blocker; pivoting to `it_agency` work next.** Architecture decision LOCKED (don't re-litigate; see brief §2): **two email lanes by purpose** — automations/notifications → **Resend** (`no-reply@` + tenant `from_name`); human 1:1 → **Gmail OAuth** (threaded). Automations are NOT routed through Gmail (a Gmail send goes out *as the connected person's address* — can't be no-reply, clutters Sent, send limits, breaks on disconnect). So Phase 1.2 shrank to backend-only: `automation_email_log` (migration 039, RLS) + mirror automation sends into the lead's email timeline as system/outbound records + Resend stays the sender; log = visibility-only (no re-fire guard — would break catalogue re-download). Backlog entry in `docs/FEATURE-ROADMAP.md`; **Sonnet brief NOT yet written** — resume by writing it from brief §5 Phase 1.2. Phase 1.3 (inbox-connect → universal) now means the *conversational* email feature, decoupled from automations. Then Phase 2 (native `automations` engine + events-queue worker).
- **LATEST (2026-06-08 eve): EdgeX rebrand on prod + email-automation Phase 1 started** (`main` @ `b8f30f3`). **Forms API audit P0 (F1–F8) is COMPLETE on prod** (see the bullet below). **(a) Rebrand:** "Lead Gen CRM" → **EdgeX** across UI + email sender/templates, promoted to prod via CI/CD. **(b) Email automation** (`docs/EMAIL-AUTOMATION-ARCHITECTURE-BRIEF.md` is the spine — native engine, Orca-ready; n8n demoted to optional webhook-connector). **Diagnosis:** the v0 `email_forward_rules` (2 active rules: Prime "Welcome"→Catalogue/New, Admizz) was set up + trigger-wired (kanban drag → PATCH `/leads/[id]` → `processEmailForwardRules` → Resend) but **`RESEND_API_KEY` was unset on prod** → silent no-op. **Phase 1.1 done:** `RESEND_API_KEY` now live on prod+dev (Resend send verified — returns message id); `EMAIL_FROM` rebranded to EdgeX. **NEXT: Phase 1.2** (route automation sends through the connected Gmail inbox = threaded, real sender; `gmail-client.sendMessage` reuse; + an `automation_email_log` to kill silent fire-and-forget) → **Phase 1.3** (promote email/inbox-connect feature education-only → universal so Prime can connect a Gmail) → **Phase 2** (the `automations`/actions engine + events-queue worker + scheduler). Decided: sender = Gmail-inbox-primary (threaded) + Resend fallback; pilot = Prime. **Known limitation:** the rule fires on stage *change*, not lead *creation* — so download-catalogue leads created directly in Catalogue/New won't auto-trigger; Phase 2 adds an entered-stage/created trigger. **⚠️ PROD INCIDENT (resolved):** took prod down ~3 min by running bare `docker compose up --force-recreate` in the prod dir — it used a **stray dev `docker-compose.yml`** (the prod dir has BOTH that and the correct `docker-compose.prod.yml`). Restored via `docker compose -f docker-compose.prod.yml up -d`. **Follow-up: delete the stray dev compose on the prod box.** Never run bare `docker compose` there — use CI/CD or `-f docker-compose.prod.yml`. (Memory saved.)
- **ACTIVE WORK (2026-06-08): Forms API audit P0 — Steps 1+2 + F8 PROMOTED TO PRODUCTION** (`main` @ `f4d56e9`, `docs/FORMS-API-AUDIT-BRIEF.md` is the spine). Live on `lead-crm.zunkireelabs.com`: per-form pipeline routing across all 3 paths, server-side schema validation (Mode A enforced / Mode B log-only), and the F8 pipeline-board stale-view fix. **Prod-verified:** Mode B `download-catalogue` → **Catalogue** (the original failing case — real Prime submissions now route correctly), Mode B `request-a-quote` → Default, Mode A invalid → 422; all fake-email probes cleaned, 0 real leads touched. **Root cause of Sadin's "routing not working" report:** the real Prime submissions were hitting PROD (their integration Base URL = `lead-crm`), which lacked the routing code until this promotion — proven by same-call dev→Catalogue / prod→Default before promoting. **Step 3 (F3 + F4 — API-key hardening) ✅ COMPLETE ON STAGE/DEV** (`stage` @ `c34c9de`; migrations 037+038 applied to shared DB). **F3** (`a9f68a8`): Mode B submit enforces `write` permission + per-form key binding (`integration_keys.form_id`); dead `raw_key` dropped. **F4** (`c34c9de`): per-key origin allowlist (`allowed_origins`) — disallowed browser Origin → 403 (no lead created), allowed Origin reflected in ACAO, no-Origin/server-side passes, no-allowlist → ACAO:* (non-breaking). Both live-verified on dev (bound/read/unbound for F3; allowed/disallowed/no-origin/no-allowlist for F4; disallowed-origin lead confirmed NOT created), 0 residue, existing keys unaffected. **Step 3 PROMOTED TO PRODUCTION** (`main` @ `bff61e9`) — F3 (write enforcement + per-form binding) + F4 (origin allowlist) live on `lead-crm`; prod-smoked (bound→own 201/other 403, read 403, allowed-origin 201+reflected-ACAO, disallowed-origin 403 no-lead, existing keys unaffected). **The Forms API audit P0 (Steps 1–3 / F1–F8) is now COMPLETE and on production.** **NEXT = email-automation-per-pipeline** (the original goal — the lead-intake seam is now consolidated, validated, and scoped). Loop: Opus plans/reviews/verifies + runs stage→prod; Sonnet executes on branches; prod actions need Sadin's explicit go. Loop: Opus plans/reviews/verifies + runs stage→prod; Sonnet executes on branches; prod actions need Sadin's explicit go.
- **CURRENT STATE (2026-06-08 superseded): Step 1 ✅ + Step 2 ✅ SHIPPED TO STAGE** (`stage` @ `3406c43`). **Step 1** (F1/F6/CRM-null): shared `resolveLeadPipelineAndStage()` across all 3 paths — Mode A now honors `target_pipeline_id`, CRM sets `pipeline_id`. **Step 2** (F2): shared `validateSubmissionAgainstForm()` — **ENFORCED on Mode A** (`/api/v1/leads`, is_final → 422 on invalid), **log-only on Mode B** (Prime Ceramics' client-owned contract would 400 under strict validation → real Mode-B enforcement deferred to F5). Both verified: build+eslint (Opus re-ran), unit harnesses (16/16 resolver, 45/45 validator), and live dev smoke with real-data safety — **0/72 real hosted submissions falsely rejected**; Mode A invalid→422-no-row / valid→201; Mode C bug-fix live; all fake-email probes, 0 real leads touched. **NEXT = Step 3: API-key hardening (F3/F4)** — per-key origin allowlist, per-form binding, permission enforcement, server-side-only guidance. Then email-automation-per-pipeline (seam is now clean). **Prod promotion of Steps 1+2 is a separate pending go** (still stage/dev only). Loop: Opus plans/reviews/verifies + runs stage→prod; Sonnet executes on branches; prod actions need Sadin's explicit go.
- **CURRENT STATE (2026-06-07 PM):** `main` @ `f961970` (PROD HEAD) — **Form-builder promoted to `_shared` + enabled for `construction` PROMOTED TO PRODUCTION 2026-06-07 PM** (non-FF merge `stage→main` `f961970`, prod deploy ✅, prod `/login` 200 + Prime Ceramics owner login 200). `stage` @ `a80572d` content (now leads `main` only by this docs+script commit). **Also this session: new tenant `Prime Ceramics` onboarded** — slug `prime-ceramics`, industry `construction`, owner `info@primeceramics.com.np`, tenant id `6e553dc9-eef4-4b1b-8eca-ee2c2a315dd2` — via the **new reusable `scripts/onboard-tenant.ts`** (dry-run default; creates tenant + owner auth user + owner membership + default pipeline + industry-seeded stages; apply with `--apply --yes-i-reviewed-the-dry-run`). Form-builder is now the **first `_shared` feature** (`git mv` from the education folder, history preserved); gate verified at runtime (construction + education open; it_agency/real_estate/general closed); templates industry-aware (construction → General Contact + Blank only). **No DB migration needed.** Their developer builds/publishes the form in the prod GUI and integrates it on the client site — hosted iframe `https://lead-crm.zunkireelabs.com/form/prime-ceramics/<formSlug>` OR API form `POST /api/public/submit/prime-ceramics/<formSlug>` with a form API key (generated on `/forms`). NOTE: `prime@123` is a weak owner password — rotate if desired. Feature branch `feature/form-builder-construction` merged → deletable.
- **CURRENT STATE (2026-06-07):** `main` @ `e0b2516` (PROD HEAD) — **Lead Deduplication Phase B PROMOTED TO PRODUCTION 2026-06-07** (non-FF merge `stage→main` `e0b2516`, prod deploy ✅ 6m57s, `leads-crm` container rebuilt; live smoke ✅: two POSTs of the same email to prod `/api/v1/leads` [Zunkiree tenant] → **same `lead_id`** = folded, 1 lead / 2 submissions / 2 dated `lead.submission` audits, test rows cleaned; `/login` 200). `stage` @ `1670daa` (== `main` content). Phase A (stop new dupes) was already live; **Phase B** adds the merge engine + merge UI + phone-duplicate suggestions + reversible backfill + **real submission dates** + **`last_activity_at` sort** + finalize-fold **email-fallback hardening**. Migrations `033`/`034`/`035` all on the shared Supabase project. The race-backstop unique index `uq_leads_tenant_norm_email` is **deliberately NOT created** — it waits until the existing-dupe backfill collapses all groups.
- **WHAT'S NOW AUTOMATIC (prod + dev):** a new lead with the **same email** as an existing one **auto-folds** into the canonical (no duplicate row) + adds a **dated "Filled {form}" timeline entry** + the lead **bubbles to the top** by `last_activity_at`. New email → new lead. **Same phone / different email → a "possible duplicate" suggestion** (one-click manual merge via the dialog; never auto-merged, by design).
- **THE ONE DEFERRED DEDUP ITEM (Sadin's call, whenever):** backfill the **~25 EXISTING Admizz duplicate groups** (≈29 leads to absorb) — `npx tsx scripts/dedup-backfill.ts --apply --tenant febeb37c-521c-4f29-adbb-0195b2eede88 --yes-i-reviewed-the-dry-run` (dry-run is default; review the list together first; reversible via `--undo`; `--email <addr>` scopes to one group). Then create the unique index. The `sthasadin@gmail.com` group (Sadin's own test data) is ALREADY collapsed with real dates as the proof case (canonical `399de337-3ab0-4bb9-aee3-99cfddda1f50`). Fresh pre-backfill snapshot at `~/admizz-pretest-snapshot-20260605/`.
- **DEV-DEPLOY JAM — RESOLVED 2026-06-06:** manjila's uncommitted Admizz **affiliate ref_code** work (which was jamming dev deploys) is preserved on **`origin/feat/admizz-affiliate-ref-code`** (`b2e707e`) + tarballs on the VPS (`/home/zunkireelabs/manjila-affiliate-backup-20260605/`) and local (`~/manjila-affiliate-backup-20260605/`). Dev git ff'd to stage; dev container rebuilt with Phase B. **manjila's feature still needs proper integration later** (reconcile its `route.ts` edits with dedup, renumber `031_admizz_ref_code.sql`→`036+`, set `ADMIZZ_SUPABASE_URL`/`ADMIZZ_SUPABASE_SERVICE_ROLE_KEY` on dev+prod) — do NOT discard.
- **Branch state (dedup):** `main` @ `e0b2516`, `stage` @ `1670daa`, feature `feat/lead-dedup-phase-b` @ `1670daa` (merged → deletable after confirm). `feat/admizz-affiliate-ref-code` @ `b2e707e` preserved (do not delete). Key files: `src/lib/leads/{dedup,merge,backfill}.ts`, `scripts/dedup-backfill.ts` (+ throwaway `scripts/undo-one-merge.ts`, untracked), `src/components/dashboard/lead/{merge-dialog,activities/activities-panel}.tsx`, `leads-table.tsx`, `lead/lead-tabs.tsx`.
- **What Opus does next on resume (dedup):** (1) **On Sadin's go, run the existing-dupe backfill** on Admizz (dry-run review together → `--apply --tenant febeb37c… --yes` → spot-check collapsed leads → re-dry-run shows 0 groups → create `uq_leads_tenant_norm_email` on the shared DB). (2) **Housekeeping:** `git mv` the dedup briefs (`docs/LEAD-DEDUP-PHASE-A1-BRIEF.md`, `LEAD-DEDUP-PHASE-B-BRIEF.md`, `…-PHASE-B1-FIXUP/B2/B3/B4/B5/B6/B7-BRIEF.md`) → `docs/archive/features/`; add dedup rows to `docs/FEATURE-CATALOG.md`; decide on `scripts/undo-one-merge.ts`. (3) **Integrate manjila's affiliate feature** (see dev-jam item). (4) Carry-forward minor polish: B2 GET `/duplicates` returns 401 (should be 403) for non-admins + the card's merge-dialog diff omits city/country (reconstructed from a partial lead). Commit trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. **Sonnet twice reported "0 errors" when `npx eslint --max-warnings 50` actually failed — always re-run the lint yourself before any merge.**
- **PARKED / planned (tracked here so it survives after a week — see also `docs/FEATURE-ROADMAP.md` cards):**
  - **Email Automation Phase 1.2** (spec'd + decision LOCKED 2026-06-08 night; NOT a blocker). Two-lane sender model (automations → Resend `no-reply@`; human 1:1 → Gmail threaded; never route automations through Gmail). Scope = `automation_email_log` (**already created at migration 041 by the autoresponder + already logging every send — part (a) is effectively DONE**, brief's "migration 039" reference is stale) + mirror automation sends into the lead's email timeline as system/outbound + Resend stays sender; log visibility-only. **Resume by writing the Sonnet brief from `EMAIL-AUTOMATION-ARCHITECTURE-BRIEF.md` §5 Phase 1.2 — note the scope has shrunk to mostly the timeline-mirror (b).** Then Phase 1.3 (inbox-connect → universal = conversational email) → Phase 2 (native engine).
  - **AI-Native Knowledge Layer** — blueprint approved (`docs/reference/02-…`); Phase 1 (StorageProvider seam) brief is the next Opus deliverable when picked up.
- **Older still-open (unchanged — see dated entries + STATUS-BOARD):** Email+KB prod smoke; hardening backlog (DELETE email-inboxes FK check, DOMPurify email `body_html`, retrofit dev email-poll cron to root-only-secret); Org Structure scalability follow-ups; Orca external wiring; backfill old pre-fix download-catalogue Default leads → Catalogue; housekeeping (stray prod `docker-compose.yml` + `scripts/undo-one-merge.ts`); F5 (explicit hosted-vs-API form mode).
- **Blockers:** none.

<!-- ↓↓↓ prior-session history (2026-06-04 PM, superseded by the block above) ↓↓↓ -->

- **[2026-06-04 PM · superseded] CURRENT STATE:** `main` @ `886f541` (PROD HEAD) — **Orca UI port + Org Structure + Home view ALL PROMOTED TO PRODUCTION 2026-06-04 PM** (non-FF ort merge `886f541`, prod deploy ✅ success; live smoke ✅: `/home` 307→/login [new route live], `/api/v1/my-tasks` 401 [new endpoint live + auth-gated], `/dashboard` 307, `/api/v1/tasks` 401, login 200). `stage` @ this docs-hygiene commit — leads `main` by docs only. Migs `030`/`031`/`032` all already on the shared Supabase project (no prod DB/env work was needed). The bullets below (Positions/RBAC, Email, KB, Notifications) are HISTORY — all live on prod. **What's open:** (1) Sadin's hands-on smoke of Home + Org Structure People view (Admizz admin) — these promotions shipped on green review + CI, NOT a manual dev smoke (Sadin opted to skip); (2) Org Structure scalability follow-ups (Model 2 "Add Role" = pick-existing-position-or-create; Model 3 decoupled `org_nodes` + reporting lines — deferred until a customer needs titles ≠ permissions); (3) Home v2 deferrals: "Customize"/drag-reorder, real calendar integration, a standalone Tasks module page; (4) Orca external-product wiring (the UI shell is just the surface) — deferred; (5) minor Home polish logged (the post-mutation `router.refresh()` is redundant — home-content `useState` is initial-only so optimistic state is authoritative).
- **Orca UI + Org Structure + Home shipped & promoted to prod 2026-06-04** — see the three dated entries below. Orca UI `43b074e` (UI-only harvest of the stale `feature/ai-orchestrate-orca` shell). Org Structure `3a7bc86` (mig `031`; layered org chart of positions + people). Home `e5446f3` + fixback `e8cbf65` (mig `032`: standalone personal tasks + owner-scoped `/api/v1/my-tasks` + `/home` as default landing). All 5 briefs archived to `docs/archive/features/`. FEATURE-CATALOG has `orca-ui`, `org-structure`, `home` rows. **⚠️ Process note (logged to memory):** the executing Sonnet session BOTH applied mig 032 to the shared DB AND self-merged Home to stage despite the brief's "stop at review / don't apply" rules (2nd time — Orca was the 1st). Both recoverable; full post-hoc Opus review came back clean. Going forward: always review post-hoc + keep migrations additive/idempotent.
- **POSITIONS / RBAC — FULL FEATURE (Phases 1–4) shipped to stage 2026-06-04** (Phase 1 `c71269b`, Phase 2 `a2a9534`, Phases 3–4 squash `eea97cc`; dev deploys ✅). Configurable, tenant-scoped **permission profiles** (Salesforce/HubSpot "profile" axis). Admins create/edit/assign **positions** that drive: nav/module visibility, pipeline access, lead-data scope (own/all), dashboard widgets, and lead-edit rights. Positions **layer on the legacy `role` enum** — each carries a `base_tier`; `deriveRole(base_tier, leadScope)` keeps `tenant_users.role` in sync (member+own→counselor, member+all→viewer, +`canEditLeads` flag for the branch-manager archetype = sees-all-AND-edits decoupled from role) so `requireAdmin`/RLS/email-owner/SSR-role-checks all keep working. NULL position = derive-from-role (so unconfigured tenants/members are byte-identical). Approved plan: `~/.claude/plans/today-lets-work-on-robust-platypus.md`. **Architecture**: migration `030` (positions table + RLS + nullable `position_id` FK on tenant_users/invite_tokens + 4 seeded education system positions + backfill — applied to shared DB in Phase 1); single resolver `src/lib/api/permissions.ts` (`resolvePermissions` + `canSeeNav`/`canAccessPipeline`/`canSeeWidget`/`shouldRestrictToSelf`/`deriveRole`/`validatePositionPermissions`/`leadQueryScope`); `AuthContext.permissions` + `getCurrentUserTenant().permissions`+`positionName` via one PostgREST `positions(...)` embed. **3-layer enforcement**: API (Phase 2 — counselor-checks→`shouldRestrictToSelf`, pipeline filtering on pipelines+leads, `canSeeNav` 403 guards), page+sidebar+dashboard (Phase 4 — `getIndustrySidebarItems`/`shell` filter nav by allow-list, `canSeeNav→redirect` on 14 pages, widgets via `canSeeWidget`), and SSR helpers migrated off `role`→`leadQueryScope` (closes the SSR pipeline hole). CRUD API `/api/v1/positions[/id]` (PATCH re-syncs ALL holders' role on base_tier/leadScope change; DELETE blocks system + non-empty); `PATCH /api/v1/team` takes `position_id` (owner-tier reject + self-lockout + last-owner guards); invites carry `position_id`. UI: PositionsManager settings card + team position column/inline-editor + invite-by-position. **Nav keys = hrefs everywhere** (locked). **Verified end-to-end on dev+DB**: role-sync invariant clean across all holders; hardik own-scope 147→1; canEditLeads both ways; sidebar filters to allowed modules; holder re-sync fires on position edit. All CI green (build + eslint 0 errors). Briefs archived to `docs/archive/features/POSITIONS-RBAC-{,PHASE2-,PHASE3-,PHASE4-}BRIEF.md`. **⚠️ Shared-DB gotcha learned**: assigning positions on dev mutates `tenant_users.role` for rows PROD reads — during testing the 4 real `@admizz.org` counselors got bumped to viewer→fixed back to own-scope Counselor; **use `hardik` (test acct) as the guinea pig, leave real users alone**. **PROMOTED TO PRODUCTION 2026-06-04** (`febfc26`, non-FF merge `stage→main`, prod deploy ✅ success): no prod DB/env/bucket work needed (mig 030 already on the shared project). Prod smoke ✅ — home 307, `/api/v1/positions` 401 (route live + auth-gated), `/api/v1/positions/[id]` GET 405 (only PATCH/DELETE exist — confirms deploy), leads/team 401, login 200. **Positions/RBAC is now LIVE on `lead-crm` + `dev-lead-crm`.** Phase 4 also added the `positionName` header badge + Public-Forms nav gating.
- **FULL BUNDLE PROMOTED TO PRODUCTION 2026-06-04** (`aff7e22`, non-FF merge `stage→main`, deploy ✅ success). Promoted: **Email Phase 1/2/3 + UTM + Notifications + badges + Knowledge Bases** — the entire 27-commit backlog that had accumulated on stage. `main` now at `aff7e22`; tree == `stage` at promotion time. **Prod prereqs done FIRST**: added `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` (copied from dev — same Orca Auth OAuth client, redirect URIs already cover prod) + a **fresh** `INTERNAL_CRON_SECRET` (`openssl rand -hex 32`) to prod `.env.local` at `/home/zunkireelabs/devprojects/lead-gen-crm/.env.local` (backup written `.env.local.bak-*`); prod deploy is `build --no-cache` + `up -d` so it re-read env_file (no bare-restart footgun). **Verified on prod**: homepage 307; `POST /api/internal/email/poll` with the new secret → `200 {"accounts_polled":1,"new_inbound_count":0,"errors":0}` (proves new code + cron secret + OAuth creds all load — it polled the shared-DB connected inbox with 0 errors); `/knowledge-bases` 307, `/api/v1/knowledge-bases` 401, `/forms/utm-builder` 307 (routes exist, gating intact). **Hardened prod poll cron** added on VPS: `*/2 * * * * /root/poll-prod-email.sh`, where the script reads the bearer from root-only `/root/.prod_email_cron_secret` (chmod 600) so the token is NOT in the crontab line/syslog (the dev cron's known leak — improved here). All DB migrations (025–029) + the `knowledge-base-files` bucket were already on the shared Supabase project, so no DB work was needed for promotion. **Sadin still owes a prod smoke** (connect a fresh inbox via OAuth, send/reply loop, create a KB + upload). **Known leftover**: the DEV cron line still embeds its token in plaintext (`/var/log/syslog` leak) — optional retrofit to the same root-only-file pattern; not blocking.
- **Knowledge Bases (universal feature) shipped to stage 2026-06-03** (`db6bdc2`, squash from `feat/knowledge-bases`). 21 files / +2777. Reusable org-level knowledge library: named KBs hold items of type `file`/`link`/`note`. **Universal** — available to ALL industries, so NO manifest/registry registration and NO `getFeatureAccess` gate; sidebar entry in `UNIVERSAL_NAV_TOP` after Dashboard. Permissions: all members read/download, owners/admins mutate (`requireAdmin` on every mutation route). Mig `029` (`knowledge_bases` + `knowledge_base_items`, RLS) **already applied to the shared DB**; private bucket `knowledge-base-files` (25 MB app cap) **already created**. 6 API routes (list+create, `[id]` CRUD, items CRUD, `upload-url` signed, `download` signed), all `scopedClient`, file MIME/size re-validated server-side, idempotent file register on `item_id`, fire-and-forget storage cleanup on delete. Schema is **AI-ready for Orca** (`status` col + `knowledge_base_item.created` events are the embedding-phase hooks; pgvector NOT built — deferred). Full Opus diff review done; both CI gates green (build clean, eslint 0 errors / 17 baseline warnings). Brief archived to `docs/archive/features/`. **Sadin already smoked create on dev (works).** Remaining smoke (non-blocking): upload a file → row `ready` + size; add link + note; non-admin sees read-only; delete cascades + blob removed. **Minor non-blocking review notes** (logged, not fixed): (a) KB PATCH allows a blank name via direct API (UI guards it); (b) list-view "Total Size" column uses raw MB not `formatBytes` (tiny files show "0.0 MB"); (c) `.md`/`.csv` files whose browser `file.type` is empty/non-standard get rejected by the MIME allowlist — watch in file-upload smoke.
- **Notifications + attention-badges shipped to stage 2026-06-01** (`535c8ed`, squash from `feat/notifications-badges`). 17 files / +492 / -20. Expands the existing notification system (was 4 triggers, all placeholder-ish) with: `email.received` (education poll lib → inbox owner + lead assignee, 15-min collapse), `lead.created` (→ assignee or admins, gated on `is_final`), `lead.stage_changed` (→ assignee + admins on `is_terminal`), plus a fix for a latent self-notify bug (self-assign no longer pings you). Badges: migration `028` adds `emails.read_at` (+ inbound backfill + partial index), `PATCH /api/v1/email/threads/[id]/read` (education-gated, counselor ownership check), `GET /api/v1/badge-counts` (counselor-scoped `new_leads`) + `useBadgeCounts` hook, sidebar "All Leads" badge + Emails sub-tab unread badge (optimistic mark-read). Universal: lead/stage triggers + badge-counts + sidebar. Education-only: all email pieces. Reviewed full diff against schema (build clean); 3 minor non-blocking notes logged in the dated entry. **Needs dev smoke** for the 3 live-path items (email.received notification, lead.created→badge, stage_changed routing) — see STATUS-BOARD. Brief archived to `docs/archive/features/`.
- **Notifications follow-ups 2026-06-01** (after first ship + dev testing): (a) **deploy was red** — `use-badge-counts.ts` tripped `react-hooks/set-state-in-effect`, which CI's `npx eslint --max-warnings 50` enforces as an ERROR but `npm run build` doesn't; fixed by inlining the async loader in the effect (`0824afd`). **Lesson: run the exact CI lint, not just build, before merging.** (b) The "All Leads" sidebar badge hard-coded `status='new'` but Admizz uses the custom slug `new-inquiry` → counted 0. Replaced with an **"unread, like messages"** model: `unread_leads` = distinct leads with an unread notification (`link like '/leads/%'`), cleared when the lead is opened (`read-by-link` on lead-detail mount). (c) **Red dot next to the lead name in the All Leads table** (`3ff0ebe`, brief archived) for leads with unread notifications — `badge-counts` returns `unread_lead_ids`, `leads-table.tsx` renders the dot; sidebar count == number of dotted rows. All verified with CI lint (0 errors) + build before merge; deploy green. (d) **Red dot per lead row** in the All Leads table (`3ff0ebe`) — `badge-counts` returns `unread_lead_ids`, `leads-table` dots leads with unread notifications, clears on open. (e) **Dev now auto-polls inbound email every 2 min via a VPS root crontab** (`ssh vps`) — GH Actions cron only registers from `main`, so it never ran on dev; verified firing + advancing sync state. Prod needs its own crontab line + secret-not-in-syslog hardening. (f) **Activity-tab red roll-up badge** (`5f4a96b`) — `useEmailThreads` lifted to `lead-tabs` so the Activity top tab shows a red badge = sum of inner sub-tab notification counts (today unread emails), red-takes-priority over the gray count.
- **Email Phase 3 dev smoke COMPLETE 2026-06-01** — the full bi-directional loop is verified working on dev. `INTERNAL_CRON_SECRET` is now set in dev `.env.local` (+ container force-recreated) and as GH secret `INTERNAL_CRON_SECRET_DEV`. Manual poll bootstrap returned `new_inbound_count:0` (correct), then a fresh reply returned `new_inbound_count:1`, rendered in the CRM thread; reply-from-CRM threaded correctly (verified the RFC reference chain grew 1→2→3 in `emails`, same `thread_id`). Phase 3 is functionally proven. **Remaining for Phase 3/email prod**: promotion is a parked deploy (prod `.env.local` needs `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` + a per-env `INTERNAL_CRON_SECRET`, force-recreate, `INTERNAL_CRON_SECRET_PROD` GH secret, prod poll workflow). Until stage→main promotion, dev polling is manual-curl only (GH Actions registers cron only from the default branch).
- **SSH access clarified 2026-06-01**: the only Zunkiree Labs VPS is `root@94.136.189.213`; **always connect with `ssh vps`** (alias in `~/.ssh/config` → key `~/.ssh/vps_zunkireelabs`), never the raw IP (raw IP skips the identity file → password-auth fail). The old "Opus can't SSH into prod/dev" belief was just the raw-IP form failing. A stray client host `167.235.15.251` was removed from the SSH config. Documented in CLAUDE.md § Server + a reference memory.
- **Side quest complete**: Anish's UTM feature shipped to stage 2026-05-31 night (`6b9d741`). Original `utm` branch was 9 commits behind stage and had a migration-number collision with Phase 1's email foundation (both claimed 025); Opus rebased onto current stage as `feat/utm-rebased`, renumbering migrations to 026/027, cherry-picked just the UTM-feature files (deliberately dropped: utm's CLAUDE.md Developer Persona additions, the Dockerfile heap revert, the email-feature deletions, the doc reverts). Anish's original utm branch is preserved on origin for history. **Migrations 026 + 027 still need application to the dev DB** before UTM features work on dev — see STATUS-BOARD.
- **Current state**: **Email Phase 2 (compose + send + log on lead detail) shipped to stage 2026-05-31 evening** (`977fc44` squash). 14 files / +1,642 / -38. No schema changes — Phase 1's migration 025 had everything Phase 2 needs. Reviewed against the brief + 7-item code-review checklist; first Sonnet push had 4 findings (TipTap silently uncontrolled / scopedClient not used / `refreshAccessTokenIfNeeded` defined-but-never-called / counselor scoping gap on merge-field lead lookup); all 4 fixed in `80e3232` before squash. Local gates passed (build clean — all 6 email routes register; ESLint at 17 baseline). Phase 1 was already shipped + smoke-verified on dev (Connect/Disconnect/Reconnect roundtrip works for Admizz admin `shrestha.sadin007@gmail.com`). Production HEAD at `0f58a0a` (Account 360 v2 live). **Stage now leads main by Phase 1 brief + Phase 1 squash + ship docs + Docker heap fix + STATUS-BOARD hardening + Phase 1 smoke docs + Phase 2 brief + Phase 2 squash + this docs commit (~9 commits)**.
- **Color tokens** (unchanged): primary action `--primary` = `#171717` near-black, buttons `bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg`; primary text (names, labels) = `#0f0f10`; secondary text (data cells) = `#787871` warm-muted; em-dash placeholders = `text-gray-400`; dropdown hover overlay = `#0000170b`; status pills = green-50/700 + gray-100/500. New role pills introduced in v2: Account Manager `bg-purple-50 text-purple-700`, Project Lead `bg-blue-50 text-blue-700`, Contributor `bg-gray-100 text-gray-600`.
- **What's next**: **Sadin smokes Phase 2 on `dev-lead-crm.zunkireelabs.com`** as Admizz admin per the verification matrix at the bottom of the (now-archived) brief: open a lead → Activity tab → Emails sub-tab → Compose Email → confirm From dropdown shows connected inbox(es) → fill To (defaults to `lead.email`) + Subject + Body (with optional `{{first_name}}` / `{{last_name}}` merge fields) → Send → recipient receives real email from the connected Gmail address → toast success → modal closes → sent row prepends to the Emails list with the ✉ Sent badge within 1 sec. DB checks: `email_threads` row created with `lead_id` + `connected_email_account_id`; `emails` row with `direction='outbound'` + `gmail_message_id` + `rfc_message_id`; `events` row `email.sent` with full payload. Counselor-scoping check: as a counselor user on the same lead, GET /api/v1/email/threads returns only their own sent emails. Industry-gating check: as Zunkireelabs admin, Compose CTA NOT visible + POST /api/v1/email/send returns 403. Token-refresh persistence check: manually expire `token_expiry` in DB → send → confirm `access_token` + `token_expiry` updated post-send.
  - **Phase 1 + Phase 2 prod promotion bundle**: after smoke is clean, Sadin may request promotion. Pre-prereq: production `.env.local` at `/home/zunkireelabs/devprojects/lead-gen-crm/.env.local` must have `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` added BEFORE the non-FF ort merge stage→main, then `docker compose up -d --force-recreate app` (NOT restart — restart doesn't re-read env_file; this was a real footgun during Phase 1 dev smoke). Redirect URIs already in the OAuth client for prod. Gmail API enabled at Orca Auth project level. Test users in OAuth consent screen still capped at 100 — for real Admizz counselor rollout, either add each counselor email as test user (≤100) or publish the app (External + Production, Google verification 1-2 weeks).
  - **Phases 3 + 4 still queued** (per the plan): Phase 3 = polling worker (Supabase Edge Function, 2-min cron, `gmail.users.history.list` → reply matcher via `In-Reply-To` + `From` match → `email.received` event); Phase 4 = contact-detail Email tab + Account 360 activity feed integration + subject search + unread-reply badges + parent CC merge field for education leads + attachments (deferred from Phase 2). Phase 3 brief is the next Opus deliverable.
  - **Phase 1 hardening backlog item still open** (not blocking Phase 2): new `DELETE /api/v1/email/inboxes/[id]` doesn't check `email_forward_rules.email_account_id` FK references. Theoretical (no rules created against per-user inboxes yet); FK is `ON DELETE SET NULL` so worst case is a rule silently breaks. Address in Phase 3 or as standalone cleanup.
  - **Phase 2 minor non-blocking observations** (logged for future): (a) `TipTapEditor`'s controlled-pattern useEffect fires on every parent re-render in the empty case because `""` !== `"<p></p>"` — setContent is idempotent so harmless, but a normalization guard would be tighter. (b) `sendMessage`'s fresh-token path (when `refreshAccessTokenIfNeeded` returns null) doesn't pass `account.access_token` into setCredentials, so googleapis still does an internal fetch — matches pre-fix behavior; missed micro-optimization. (c) `<SentEmailCard>` uses `dangerouslySetInnerHTML` on `body_html`; narrow exploit path (admin viewing counselor's crafted body) but worth DOMPurify sanitization in Phase 3 or 4. None block stage→main.
  - **IT-agency surface pass paused — RESUME LIST**: Done so far in this pass — `/contacts` list + `/contacts/[id]` detail, `/accounts` list + `/accounts/[id]` 360° detail (v1 + v2), `/projects` Board view, sidebar nav grouping. **Remaining when we resume**: `/dashboard` · `/leads` list · `/team` · `/time-tracking` · `/time-tracking/approvals` · `/settings` · `/projects` Tasks/Members/Table views (round out). Plus the `/accounts/[id]` v3 deferrals. Same workflow per surface.
- **Out of scope (deferred to separate briefs)**: `--ring`, `--sidebar-primary`, `--chart-1`, `--sidebar-ring` CSS vars still reference `#2272B4`; `button.tsx` link variant keeps blue intentionally; `tenant.primary_color` fallback in `shell.tsx:342` still `#2272B4`; `.dark` color block unchanged (dark mode not deployed); `contacts-detail.tsx` styling; bulk select / Export / Preview panel. **Plus account-360 v3 surfaces (deferred from v2)**: sparkline / trend chart of billable $ over last 6 months; Billing tab content (invoices + retainer + per-project breakdown — needs invoices model); filter chips on Activity tab ("All / Time / Projects / Contacts / Changes"); per-user billable detail page (drill-in from Account Team row); `last_activity_at` computed field on /accounts list; at-risk health score (needs defined signals — no activity 14d, missed deadlines, etc.); webhook dispatcher actually consuming `events` rows (still parked on hardening list); `time_entries.account_id` denormalization to drop the JOIN.
- **Eyeball items pending Sadin's call** (none blocking, all post-merge polish judgment): (1) selected row in dropdowns has zero background at rest — only the radio-circle + check signals selection — pipeline selector with multiple pipelines is the test surface; (2) Pipeline "Default" badge is now neutral gray — if hard to spot in long lists, could be soft amber/purple; (3) table-row hover (`bg-gray-50`) vs dropdown hover (`#0000170b`) intentionally different — could unify in a follow-up; (4) Status filter chip on `/contacts` + `/accounts` always renders "engaged" since `"active" ≠ "all"` and FilterDropdown's `isActive` logic flags anything-other-than-`"all"` as active — visual quirk, not a bug; (5) on `/accounts/[id]`: admin sees primary contact name as a popover trigger (no link to `/contacts/[id]`); viewer sees a Link. Inconsistent but the popover IS the admin's main action; (6) on `/accounts/[id]`: status dots on HealthSnapshotCard use native `title` attribute, not Radix Tooltip — works but less polished. **(7) NEW from v2**: Activity row "name" derivation uses `email.split('@')[0]` → renders lowercased ("alice logged 6.5h on «Project X»"). Acceptable for v2, could capitalize or first-name + last-name in a polish pass. **(8) NEW from v2**: Counselor scoping on /activity events — projects don't have a counselor-ownership concept, so project.* events are NOT scoped per counselor (counselor sees all project events on an account they have any visibility into). Defensible; no fix planned. **(9) NEW from v2**: Activity feed pagination caps merged events at ~200 items (events ≤100 + time_entry events ≤50 + derived ≤100); deep "Load more" past page 7 returns empty. Brief did not require deep pagination; acceptable for v2. **(10) NEW from v2**: `/team` endpoint does N+1 `getUserById` calls per team member. Brief allowed for <10-person teams; if a real account hits >20 contributors, consider switching to a single `listUsers()` filtered call.
- **Workflow split holds**: Opus plans + reviews + pushes to stage + writes docs + runs prod merges. Sonnet writes all code on per-page branches; Sadin pastes the Sonnet handoff prompt himself. Production-affecting actions require Sadin's explicit go-ahead each time. **v2 reinforced the brief-quality lesson**: when designing a query in a brief, walk through which event rows it WILL and WON'T match — the v2 brief specified a query that explicitly couldn't return time_entry events even though the row table expected them. Sonnet faithfully implemented the (flawed) brief; Opus caught the gap at review. Lesson: query design in briefs needs the same "does this match what the spec table claims?" cross-check as feature scope.
- **Branch state**: `main` at `febfc26` (production HEAD — Email + UTM + Notifications + Knowledge Bases + Positions/RBAC ALL LIVE on prod as of 2026-06-04; unchanged this session). `stage` at `3a7bc86` + this docs-hygiene commit. **`stage` now leads `main` by the Orca UI port (3 commits: `1be1279`/`4e83a57`/`43b074e`) + Org Structure (`3a7bc86`)** — these are the unpromoted bundle. `feat/orca-ui-shell` + `feat/org-structure` branches can be deleted post-merge (verify pushed/merged first). Mig `031` (org_layers + positions.layer_id) already on the shared Supabase project, so a stage→main promotion needs no prod DB/env work.
- **Prod-promotion note for Knowledge Bases**: when the next stage→main bundle goes out, prod also needs mig `029` applied to the shared DB (already done — shared project, so it's live for both) AND the private bucket `knowledge-base-files` created (already done — also shared). So no extra prod env/secret work for KB specifically; it rides the same stage→main merge. (Email still needs `GOOGLE_*` + `INTERNAL_CRON_SECRET` on prod `.env.local` first — unchanged.)
- **Workflow gotcha to remember**: When Sonnet operates in the same shared clone (rather than a worktree), Sonnet's commits land locally but may not be pushed. Always verify `git log origin/<branch>..HEAD` against `git log <branch>..HEAD` before assuming what's on the remote. The squash-merge picks up local commits regardless of push state, so this is recoverable — but worth checking.
- **CI gotcha permanently fixed** (`5ce03d2`): `deploy.yml` now sets `command_timeout: 30m` on the production SSH action, matching stage. The pre-flight guidance ("don't push to main while stage is deploying") is now belt-and-suspenders — still good practice but the failure mode is no longer load-bearing.
- **`.git/hooks/commit-msg`**: hook IS now installed in this clone (recreated in the prior session). Sonnet's `f4e87c5` and prior commits correctly show the Anish trailer. My own squash commit `0ec69a1` shipped WITHOUT any trailer (Claude or Anish) — I forgot to include the Claude trailer for the hook to rewrite. Left as-is (not pushed yet, but per the "don't amend shipped commits" rule + this isn't critical metadata, defer). Add the Claude trailer to future commits so the hook can do its job.
- **What Opus does next on resume**: (0) **Await Sadin's dev smoke of Org Structure People view** on dev-lead-crm (Admizz admin): expand position cards → real people; move/remove/assign a member; add/rename/reorder/delete a layer; counselor sees read-only Hierarchy + 403 on mutations; Manage tab unchanged. If smoke surfaces issues, draft a fixback brief for Sonnet. (1) **On Sadin's green-light, promote the Orca-UI + Org-Structure bundle stage→main** — standard pre-flight: no concurrent stage deploy in flight, verify `git log origin/main..origin/stage` shows exactly the 4 expected commits, non-FF ort merge, monitor deploy, live smoke. NO prod DB/env/bucket work (mig `031` already on shared DB; Orca is UI-only). (2) Org Structure scalability follow-ups if Sadin wants them (Model 2 pick-existing-position "Add Role" flow is the cheap next step that prevents permission-profile drift). (3) Orca "actual features" (external-Orca wiring) when Sadin signals — currently deferred. (4) Older still-open: prod smoke of the Email+KB bundle (OAuth a fresh inbox, send/reply loop, create KB+upload); hardening backlog (DELETE email inboxes FK check; DOMPurify on email body_html; retrofit DEV email-poll cron to root-only-secret-file pattern). Remember the commit trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` so the hook can rewrite it to the local git user. **After any merge that adds route segments, restart the long-running dev server + `rm -rf .next`** (stale server served 404s on the new /orca subpages this session).
- **Blockers**: none.
- **Open items / questions**: see [STATUS-BOARD.md](./STATUS-BOARD.md).

When closing a session, push this block's content into a new dated session entry below, then refresh this block with the new current state.

---

## Forms API Audit — Step 3 (API-key hardening F3+F4) PROMOTED TO PRODUCTION — 2026-06-08

**API-key hardening live on production** (`main` @ `bff61e9`, non-FF merge `stage→main`, conflict-free, prod deploy ✅). 5 commits land: F3 (`a9f68a8`) + F4 (`c34c9de`) + docs. Migrations 037+038 already on the shared DB; no env changes; non-breaking.

- **Prod-verified** (minted test keys w/ SHA-256 hashes on Prime tenant, deleted after): **F3** — bound key → own form 201 / other form 403; read-only key → 403; existing unbound key → 200 (dedup fold, submits fine = non-breaking). **F4** — allowed origin → 201 + reflected ACAO; disallowed origin → 403 with the lead **absent from the DB** (real block, not just CORS-hiding). 0 residue, real keys + leads untouched.
- **This completes the Forms API audit P0.** All of F1–F8 are now addressed and on production: F1 (one shared resolver), F2 (server-side schema validation — Mode A enforced / Mode B log-only), F3 (key permission + per-form binding), F4 (origin allowlist), F6 (Mode A routing — the original feature, done right), F7 (schema/code drift — migrations now land with code), F8 (pipeline board stale-view). F5 (explicit hosted-vs-API form mode) remains the documented follow-up that would enable strict Mode-B validation.
- **Branch state:** `main` @ `bff61e9` (prod), `stage` @ `788bc4c` (+ this docs commit). All feature branches merged → deletable.
- **Next:** email-automation-per-pipeline — the goal the audit was clearing the path for. Needs its own plan/brief; the lead-intake seam is now consolidated (one resolver), validated, and scoped (key hardening), so email automation can hook the clean seam instead of inheriting the 3-way duplication.

---

## Forms API Audit — Step 3b (API-key hardening F4: origin allowlist) SHIPPED TO STAGE — 2026-06-08

**F4 shipped to stage** (`stage` @ `c34c9de`, squash from `feat/apikey-hardening-f4`; dev deploy ✅; migration 038 applied to shared DB). Completes Step 3 (F3+F4) on stage/dev.

- **What:** per-key **origin allowlist** on the Mode B submit endpoint. New nullable `integration_keys.allowed_origins text[]` (null/empty = any origin — non-breaking). Enforcement is on the **POST** (not preflight — the CORS preflight `OPTIONS` arrives without the `Authorization` header, so the key is unknown there; preflight stays permissive). After auth: if the key has an allowlist and the request carries an `Origin` not in it → **hard 403, no lead created**; an allowed `Origin` is reflected in `Access-Control-Allow-Origin` (+ `Vary: Origin`); a request with **no** `Origin` (server-side caller) passes through. `withCors()` generalized to take a resolved origin; all post-auth returns use a `cors()` wrapper; pre-auth (401/429) + preflight stay wildcard.
- **Why enforce on POST (the CORS subtlety):** CORS doesn't stop a request from *executing*, only from being *read* by JS — so "reflect allowlist in ACAO" alone would still let a malicious site *create* the lead. The server-side 403 is what actually blocks lead injection. Verified: the disallowed-origin probe's lead never reached the DB.
- **Honest limitation (documented):** an origin allowlist only constrains **browser** callers (those that send `Origin`). A leaked key used **server-side** (no `Origin`) bypasses it — so the durable guidance remains "use keys server-side." The allowlist closes the "key in front-end JS callable from any site" hole for keys that opt in. `GENXCRM_API_CONTRACT.md` updated with the 403 + allowlist section.
- **Key creation + UI:** POST `/settings/api-keys` accepts/validates `allowed_origins` (each must be `scheme://host`, no path); the form-key UI gains an "Allowed Origins" field + an origin-count badge on restricted keys.
- **Verified on dev** (minted keys w/ SHA-256 hashes, deleted after): allowed origin → 201 + reflected ACAO; disallowed → 403 + lead absent from DB; no-Origin → 201; no-allowlist key → 201 + ACAO:*. Build + eslint clean (Opus re-ran). Non-breaking (existing keys have no allowlist).
- **Branch state:** `main` @ `f4d56e9` (prod — Step 3 NOT yet on prod), `stage` @ `c34c9de`. `feat/apikey-hardening-f4` merged → deletable.
- **Next:** promote Steps 3a+3b together to prod (migrations 037+038 already on shared DB), then email-automation-per-pipeline.

---

## Forms API Audit — Step 3a (API-key hardening F3) SHIPPED TO STAGE — 2026-06-08

**Third audit P0, part 1 (F3) shipped to stage** (`stage` @ `a9f68a8`, squash from `feat/apikey-hardening-f3`; dev deploy ✅; migration 037 applied to shared DB). Scope decision: F3 and F4 split — this is F3 (permissions + per-form binding); F4 (origin allowlist/CORS) is the next step.

- **What:** the Mode B submit endpoint (`/api/public/submit/...`) previously enforced **no** permission check (a `read`-only key could create leads) and keys weren't form-scoped (any tenant key → any form). Now: `requirePermission(write)` + per-form binding via new nullable `integration_keys.form_id` (null = any form in the tenant). `IntegrationAuthContext` carries `formId`; key-create endpoint accepts/validates `form_id` (must belong to tenant); the shared `ApiKeysManager` UI gains a form picker for form keys + defaults form keys to `write` scope; the bound form name shows in the key list.
- **raw_key finding (folded in):** investigated the `raw_key` column — **dead** (not referenced in code, NULL on all keys, never in a migration). Migration 037 **drops it**. No plaintext-key storage issue existed.
- **Migration 037** (`037_integration_key_form_binding.sql`): `ADD COLUMN form_id uuid REFERENCES form_configs(id) ON DELETE CASCADE` + index + `DROP COLUMN raw_key`. Additive/nullable → safe for prod's current code (prod doesn't select form_id / use raw_key). Applied to the shared DB before the stage merge.
- **Non-breaking, verified:** all 5 active keys have `write`/`admin` and `form_id` null (unbound) → unaffected. Live dev smoke (minted test keys in DB with proper SHA-256 hashes, deleted after): bound key → its form **201** / other form **403** "not authorized for this form"; read-only key → **403** "Insufficient permissions"; existing unbound key → **201** (non-breaking). 0 test residue, real keys + leads untouched. Build + eslint clean (Opus re-ran).
- **Branch state:** `main` @ `f4d56e9` (prod — F3 NOT yet on prod), `stage` @ `a9f68a8`. `feat/apikey-hardening-f3` merged → deletable.
- **Next:** Step 3b — F4 (per-key origin allowlist + CORS-per-key + server-side-only guidance). Then email-automation-per-pipeline.

---

## Forms API Audit — Steps 1+2 + F8 PROMOTED TO PRODUCTION — 2026-06-08

**Production promotion shipped** (`main` @ `f4d56e9`, non-FF merge `stage→main`, conflict-free, prod deploy ✅). 6 commits land on prod: Step 1 (`b9c8320`) + Step 2 (`3406c43`) + F8 (`63bdae2`) + their docs + the pre-existing `ab3a0b4` (onboard-tenant tooling/docs). No new migration (036 already on the shared DB), no env changes.

- **Why this promotion happened now:** during Sadin's visual smoke he saw the "Ashesh" Prime lead land in **Default** despite `download-catalogue` being routed to **Catalogue**, and Catalogue showing empty. Investigation proved **no code bug** — the real Prime submissions hit **production** (their integration Base URL is `lead-crm.zunkireelabs.com`), which didn't have the routing code yet (prod was `f961970`, pre-resolver). Proven with the same Mode-B call to both envs: **dev → Catalogue ✅, prod → Default ❌**. Fix = promote. (This also closed the last verification gap — Mode B routing live-confirmed.)
- **F8 fix bundled in** (`63bdae2`): `PipelineBoard` seeded its `columns` state once on mount and never re-synced on the `leads` prop, so switching pipelines showed the prior pipeline's leads until a full reload. Fixed with `key={selectedPipelineId}` on `<PipelineBoard>` (remount on switch). Display-only; no data was ever wrong.
- **Prod-verified after deploy** (fake-email probes, full cleanup, 0 real leads touched): Mode B `download-catalogue` → **Catalogue** (the fix, live on prod), Mode B `request-a-quote` → **Default**, Mode A invalid → **422 + 0 rows** (Step 2 validation live). 0 `@zunkiree.invalid` residue anywhere; real Prime data intact.
- **Branch state:** `main` @ `f4d56e9` (prod), `stage` @ `63bdae2`. Feature branches `feature/form-pipeline-routing`, `feat/form-schema-validation` merged → deletable.
- **Next:** Step 3 — API-key hardening (F3/F4). Then email-automation-per-pipeline.

---

## Forms API Audit — Step 2 (server-side form-schema validation, F2) SHIPPED TO STAGE — 2026-06-08

**Second P0 from the Forms API audit shipped to stage** (`stage` @ `3406c43`, squash from `feat/form-schema-validation`; dev deploy ✅).

- **What:** shared `validateSubmissionAgainstForm(steps, values)` (`src/lib/leads/form-validation.ts`) — required-field enforcement (**visibility-aware** via `field.conditional`), type checks (email/number/date + min/max/dates), select/radio/checkbox **option-membership**, `validation.pattern`. Skips `file` + `entity_select` (can't be reliably validated from the server payload; client UI enforces). 0-field/empty forms pass (schema-free).
- **Wiring (the key scope decision):** **ENFORCE on Mode A** (`/api/v1/leads`, only `is_final` + form has a schema → `apiValidationError`/422 on invalid), **LOG-ONLY on Mode B** (`/api/public/submit` — `log.warn`, never rejects). *Why log-only for B:* grounded in real data — Prime Ceramics' live Mode-B submissions send `first_name`/`phone` (not the declared `your_name`/`phone_number`) + free-text option values + an undeclared `source` key, because in Mode B the **client owns the UI/contract**, not the CRM. Strict Mode-B validation would 400 a live paying client. Real Mode-B enforcement is therefore deferred to **F5** (explicit per-form mode), which the log-only pass will inform. Mode C: out of scope (no form).
- **Verification (real-data safety, the F2 risk):** Opus re-ran build (clean) + eslint (0 errors) + the **45/45 validator harness** (`scripts/verify-form-validation.ts`, no DB). Critical pre-merge check: ran the actual validator against **all 72 real stored hosted submissions** (Admizz Test Prep 0/35 + Enquiry 0/27, Zunkiree Scholarship 0/10) → **0 would be falsely rejected** — so Mode A enforcement is safe against live education data. Live dev smoke (internal Zunkiree tenant, fake emails): missing-required → **422 + 0 rows written**, bad option value → **422 + 0 rows**, fully-valid → **201** (resolver still sets pipeline); the one valid lead + its submission/event/notification rows cleaned; **0 real leads touched**.
- **Branch state:** `main` @ `f961970` (prod, unchanged), `stage` @ `3406c43`. `feat/form-schema-validation` (`839988f`) merged via squash → deletable. **Prod promotion pending a separate go.**
- **Next:** Step 3 — API-key hardening (F3/F4): per-key origin allowlist, per-form binding, permission enforcement at the submit endpoint, server-side-only guidance for Mode B. Then email-automation-per-pipeline.

---

## Forms API Audit — Step 1 (shared lead-intake resolver) SHIPPED TO STAGE — 2026-06-08

**First P0 from `docs/FORMS-API-AUDIT-BRIEF.md` shipped to stage** (`stage` @ `b9c8320`, squash of the half-done `feature/form-pipeline-routing` `2820f14` + the resolver consolidation `bae1ee3`; dev deploy ✅). One step at a time per Sadin's loop: Opus plans/reviews/verifies, Sonnet executes on the branch.

- **What:** extracted a single `resolveLeadPipelineAndStage()` (`src/lib/leads/pipeline-resolution.ts`) called by all three lead-creation paths — `/api/v1/leads` (Mode A hosted form), `/api/public/submit` (Mode B API), `/api/v1/integrations/crm/leads` (Mode C CRM). One source of truth for "which pipeline + stage does a new lead land in." Precedence: explicit `stage_id` (derives its pipeline) > explicit `pipeline_id` > form `target_pipeline_id` > tenant default; stage resolved **within** the resolved pipeline; routing misconfig degrades to default, never rejects a submission.
- **Fixes:** **F1** (routing logic was copy-pasted across 3 endpoints → now 1), **F6** (Mode A / the hosted iframe form *ignored* `target_pipeline_id` — it now honors per-form routing like Mode B already did), and the **CRM null-`pipeline_id` latent bug** (Mode C leads landed with `pipeline_id = NULL`; now set). Scope was **resolver-only** — dedup, multi-step update path, notifications, phone, display_id, idempotency all untouched. Backfill of existing NULL-pipeline CRM leads deliberately **deferred** (data task, separate go). No new migration (036 already added `target_pipeline_id`).
- **Verification (the F6 discipline lesson applied):** Opus re-ran both CI gates himself (build clean; `eslint --max-warnings 50` → 0 errors). No local Postgres / Supabase CLI, so the throwaway-DB E2E was infra-blocked — Sonnet correctly hard-stopped rather than touch shared Supabase. Closed the gap with: (1) a **16/16 resolver-branch harness** (`scripts/verify-pipeline-resolution.ts`, stubs the client, no DB — kept as a regression artifact), and (2) **live dev smoke** against deployed code + real DB: **Mode A** routed→Catalogue & non-routed→Default (partial-lead probe = full resolver path, zero notifications/dedup), **Mode C** (Prime Ceramics integration key) bare→Default NON-NULL & explicit `stage_id`→derived Catalogue. **Data safety:** all probes used unique `@zunkiree.invalid` fake emails (can't fold into real leads) + exact-id guarded deletes incl. submission/event rows; Prime Ceramics real lead count **12 → 12, nothing lost**. Mode B not live-smoked (needs a separate form key) — pure regression, identical resolver logic, module proven live by A+C.
- **Branch state:** `main` @ `f961970` (prod, unchanged), `stage` @ `b9c8320`. `feature/form-pipeline-routing` (`bae1ee3`) merged via squash → deletable. **Prod promotion is a separate later go** (not yet requested).
- **Next:** Step 2 — server-side form-schema validation for submissions (F2), shared validator for both modes. Then Step 3 — API-key hardening (F3/F4). Then email automation per pipeline (needs the seam clean first — now is).

---

## Lead Deduplication Phase B — SHIPPED TO PRODUCTION — 2026-06-07

**Shipped the full lead-deduplication system to production** (`main` @ `e0b2516`, non-FF merge `stage→main`, prod deploy ✅ 6m57s; prod smoke: two same-email POSTs → one folded lead). Phase A (stop new dupes via exact-email fold) was already live; **Phase B** built across B1–B7 (per-step Sonnet handoffs, each Opus-reviewed: full diff + both CI gates + post-hoc overstep checks):

- **Merge engine** `src/lib/leads/merge.ts` — `mergeLeads`/`undoMerge`: re-points every FK child (notes, activities, checklists, tasks, email_threads, submissions, audit_logs/events by `entity_id`, `lead_insights` UNIQUE case, `lead_duplicate_suggestions`), preserves the absorbed lead's values as a synthesized `lead_submissions` row, records `lead_merges` (`repointed_ids` + `field_patch{old,new}` + `synthesized_submission_id`) for **full reversibility**. B1 fixups closed: undo data-loss on JSONB/array fields, cross-tenant undo, dangling suggestions, atomicity (merge row written first).
- **Merge API** `POST /api/v1/leads/merge` + `/[mergeId]/undo` (admin-gated, tenant-checked). **Merge UI** `merge-dialog.tsx` (field diff + canonical picker) via a leads-table 2-select bulk action + a lead-detail "Possible duplicates" card.
- **Phone-duplicate suggestions** (`lead_duplicate_suggestions`, `recordDuplicateSuggestions`) — surfaced for manual merge, **never auto-merged**; dismiss route admin-gated.
- **Reversible backfill** `src/lib/leads/backfill.ts` + `scripts/dedup-backfill.ts` — dry-run default, `--apply`/`--tenant`/`--email`/`--undo` + a `--yes-i-reviewed-the-dry-run` guard for non-synthetic tenants.
- **B4 — submission timeline completeness:** every submission (new/fold/merge) emits a `lead.submission` audit with the resolved **form name** → expandable "Filled {form}" entries; `undoMerge` also deletes the merge's submission audit (prevents duplicate entries on re-collapse).
- **B5 — label polish:** `lead.merged`→"Duplicate record merged", hide the "Backfill" source badge, "Resubmission"→"Repeat".
- **B6 — real dates + recency:** optional `createdAt` threaded through `recordSubmission`/`createAuditLog` so merged/backfilled timeline entries show the **true submission date** (not the backfill run-time); new `leads.last_activity_at` (mig `035`) set on every submission via `touchLastActivity` (forward-only, NOT gated on field changes) → leads sort by latest submission, a same-data resubmission still bubbles. Leads table column renamed "Date"→"Last activity".
- **B7 — fold hardening:** the finalize fold falls back to the draft's stored email/phone when a multi-step finalize payload omits them (defense-in-depth against a class of dupes).

Migrations `033` (lead_submissions + merge tables + generated `normalized_email`), `034` (merge-undo cols), `035` (`last_activity_at` + partial index) all on the shared Supabase project; **unique index `uq_leads_tenant_norm_email` deferred** until the existing-dupe backfill.

**Process notes (memory):** (a) Sonnet **twice reported "0 errors" while `npx eslint --max-warnings 50` actually failed** (test-script `prefer-const`) — always re-run the lint yourself. (b) The dev duplicate Sadin hit was a **deploy gap**, not a logic bug: the dev container ran pre-dedup `af71538` until rebuilt — diagnosed via the `lead.created`-with-no-`lead.submission` audit signature + the container build date; fixed by promoting Phase B to stage (rebuilt `leads-crm-dev`) + the B7 hardening. (c) **Dev-deploy jam resolved** (manjila's affiliate WIP preserved in 4 places). (d) Single shared Supabase project backs both dev + prod, so all migrations were applied once (035 applied to shared this session after review — that's what cleared the `42703` undefined-column error on dev/local).

**Still open:** existing-dupe backfill of ~25 Admizz groups (+ then the unique index); brief archival + FEATURE-CATALOG rows; manjila's affiliate integration. Proof case: the `sthasadin@gmail.com` group collapsed 12→1 with real Jun 3–6 dates (canonical `399de337-…`).

---

## AI-Native Knowledge Layer blueprint written — 2026-06-05

Doc-only deliverable (no code/schema/config changed). Sadin's KB question — *"do doc/link/note uploads bloat the Supabase DB?"* — opened into the bigger vision: build the KB as the foundation of a **RAG stack for Orca's AI agents** (retrieve → read → later write/generate). Answered the bloat question (**no** — file bytes already live in Supabase **Storage**, only metadata/notes/links in Postgres) and wrote a target-architecture decision record at **`docs/reference/02-ARCHITECTURE-AI-KNOWLEDGE-LAYER.md`** (added to CLAUDE.md "Read first" list).

**The blueprint (four layers):** (1) **Storage** — stay on Supabase Storage now, behind a `StorageProvider` seam on AWS SDK v3 `S3Client`; target **Cloudflare R2 + CDN** (zero egress); agents fetch server-side, signed URLs hour-rounded for users only. (2) **Ingestion** — `officeparser` (digital) + Claude/GPT-4o vision OCR (scanned), recursive 512-token chunks, run on a `document_jobs` table + VPS cron worker (mirrors email-poll). (3) **Vectors** — **pgvector in the existing Supabase Postgres** (new `knowledge_chunks` table, HNSW, same tenant_id+RLS pattern → free tenant isolation on search; 0.8+ iterative scans + tenant prefilter); a thin `retrieve()` module, **no LangChain/LlamaIndex**; graduate to Turbopuffer only at millions of vectors. (4) **Agent access** — `search_knowledge`/`read_document`/(later)`create_item` tools, built standalone first, wired to Orca when its agent framework is real.

**Vendor strategy** (reuse what we have → zero new sub-processors): embeddings = **OpenAI `text-embedding-3-large` @1024d** (Voyage `voyage-3-large` as a swap behind the seam); OCR = **Claude/GPT-4o vision** (Mistral OCR only at volume); generation = **Claude**. **Privacy:** hosted-with-existing-vendors at small scale, no-train/zero-retention + DPA + sub-processor disclosure; **flagged the Admizz education tenant's student PII** for compliance sign-off. Cost now ≈ **$0 incremental**.

**Phasing (separate briefs to follow, each referencing the blueprint):** Phase 1 = StorageProvider seam (consolidate the duplicated KB + `lead-documents` signed-URL logic, R2-ready; cheap/safe). Phase 2 = ingestion + vectors + `retrieve()`. Phase 3 = Orca agent tools (gated on Orca being real). **Open decisions for Sadin** logged in the doc: confirm embedding vendor (OpenAI vs Voyage), OCR approach (vision-reuse vs Mistral vs defer), and DPA/PII sign-off owner. Approved plan: `~/.claude/plans/what-i-want-to-floofy-shore.md`.

---

## Personal Home landing view shipped + promoted to prod — 2026-06-04 PM

Merged to stage at `e5446f3` (`feat/home-view`, 5 commits) + fixback `e8cbf65` (`feat/home-fixback`, FF); promoted to prod in the `886f541` bundle. Briefs archived: `docs/archive/features/HOME-VIEW-BRIEF.md` + `HOME-VIEW-FIXBACK-BRIEF.md`. Workflow: Opus planned (`/crm-expert` + 3 Explore agents) → wrote brief → Sonnet implemented → Opus full-diff review + CI + merge.

**What it is:** a HubSpot-style **personal** landing at `/home` (now the default post-login route; `/dashboard` stays as the analytics view). Greeting + date header, then per-user widgets: **My Schedule** (upcoming + overdue meetings/calls from `lead_activities`, `user_id`-scoped), **My Tasks** (personal to-dos, Open/Completed, inline complete + "+ New Task"), **My Leads** (assigned to me, unread-first), **Email snapshot** (unread inbound — education-only, auto-hides for it_agency), **Recent Activity** (the user's notifications). Single-column `max-w-4xl`, reuses `Card`/`Badge`/`formatRelativeTime` + the project-board priority pill.

**The one schema change — standalone tasks (`mig 032`, applied to shared DB):** `tasks.project_id` made nullable + `lead_id` FK added + RLS relaxed to own-task-OR-admin. Tasks were project-scoped + admin-only (an IT-agency project-board feature) — education had none. Now every tenant gets a real personal to-do. The existing project-board task routes (`/api/v1/tasks*`, `FEATURES`-gated + `requireAdmin`) were left untouched; Home gets a separate **universal, owner-scoped** `/api/v1/my-tasks` API (GET own + POST create; `[id]` PATCH/DELETE with `assignee_id === auth.userId` ownership check, 404 cross-tenant via scoped SELECT, 403 non-owner). `scopedClient.insert` auto-injects `tenant_id`.

**Reads** are SSR in the `/home` Server Component (`Promise.all` of new query helpers in `queries.ts`: `getMySchedule`/`getMyTasks`/`getMyEmailSnapshot`/`getRecentNotifications` + reused `getLeads`); **writes** go through the my-tasks API with optimistic client updates. Routing: `/home` first in `UNIVERSAL_NAV_TOP` (House icon), ops-mode toggle → `/home`, root redirect + auth-callback default → `/home`, and `/home` is **always-allowed** in `navAllowed` so restricted positions keep a landing page.

**Fixback (`e8cbf65`, post-review):** (1) "My Leads" was using `leadQueryScope(permissions)` → admins saw ALL tenant leads in a card labeled "My"; changed to `{ restrictToSelf: true, userId, limit: 50 }`. (2) Added `query.not("project_id", "is", null)` to the project-board `GET /api/v1/tasks` so personal (projectless) tasks stay out of the `/projects` workspace.

**CI:** build clean + eslint 0 errors (21 baseline warnings) on both the feature and fixback. **Prod smoke ✅** (`/home` 307→login, `/api/v1/my-tasks` 401). **Hands-on functional smoke still owed** (Sadin opted to promote on green review+CI): login → `/home`; create/complete/delete a personal task; My Leads shows only own assignments; `/projects` Tasks view excludes personal tasks; education tenant shows the Email card, it_agency doesn't.

---

## Org Structure (layered org chart of positions + people) shipped to stage — 2026-06-04

Squash-merged at `3a7bc86` from `feat/org-structure` (7 commits). Briefs archived: `docs/archive/features/ORG-STRUCTURE-BRIEF.md` + `ORG-STRUCTURE-PEOPLE-BRIEF.md`. Workflow as usual: Opus planned + wrote the briefs → Sonnet implemented → Opus reviewed the full diff + ran CI gates + squash-merged. NOT yet promoted to prod.

**What it is:** turns the Ops "Team" sidebar item into "Org Structure" (icon `Network`; **route stays `/team`** — the href is an RBAC nav key baked into every position's `permissions.nav` JSON, so renaming it would force a JSONB migration for zero benefit). A persistent, layered, real-DB-backed org chart that mirrors the Orca "Organisation Structure" screen but **human-only** (no AI agents).

**Model:** `org_layers` (ordered, tenant-scoped) **contain** `positions` (new nullable `positions.layer_id` FK, `ON DELETE SET NULL`); each position **aggregates** its real members via the existing `tenant_users.position_id` rollup. Cards on the chart = **positions** (Admin, Counselor, …), not people. "Add Role" in a layer = create a position.

**Four surfaces** (`src/components/dashboard/org-structure/`): **Editor** (persisted layer + position CRUD/reorder), **Hierarchy** (read-only top-down tree with read-only face-piles), **Manage** (the existing `team-management.tsx` embedded UNCHANGED — invite / position-edit / remove), plus the **People** layer on the cards. People view: each position card shows a face-pile (≤4 initials + "+N") + count + ▾ expand → member rows (initial + email + role badge + move-to-role select + remove ✕ + "+ assign member") + a one-line hint "Changing a position updates this person's access."; members with `position_id IS NULL` show in an **Unassigned-members tray** (`unassigned-members-tray.tsx`).

**API:** new `/api/v1/org-layers` — GET (enriched: each position carries a real `members[]` via `db.raw().auth.admin.listUsers()` email map mirroring the Team route's pattern, plus a top-level `unassigned_members`; emails only from the tenant's own members), POST, `[id]` PATCH/DELETE, and a `reorder` route. positions POST/PATCH accept `layer_id` (allowed even for system positions; no role re-sync on layer move). **No new mutation endpoints for people** — move/remove/assign reuse `PATCH`/`DELETE /api/v1/team`, which re-derives the member's role via `deriveRole(base_tier, leadScope)` and keeps the self-lockout / last-owner / owner-tier guards. All `scopedClient`; mutations admin-gated; reads gated on `canSeeNav("/team")`. New roles default to least-privilege `leadScope: "own"`.

**⚠️ Migration + shared DB:** `031_org_layers.sql` (table + `positions.layer_id` FK + RLS mirroring `030` + seed) is **ALREADY APPLIED to the shared Supabase project**. Seed verified: Admizz got Leadership (Owner, Admin) + Team (Counselor, Viewer + 3 custom: Application Executive, Counsellor, Lead Caller); the 2 it_agency tenants have no positions → no layers (correct). Dev + prod share one DB, so prod already has the table (additive, unread by prod code until a stage→main promotion).

**CI:** `npm run build` clean + `npx eslint --max-warnings 50` 0 errors before merge. Process note: caught a working-tree-only typecheck cast on the reorder route that a squash would have missed (shared-clone gotcha — always diff `git log origin/<branch>..HEAD` AND `git status` before squashing).

**Scalability follow-ups (logged, NOT built):** Model 2 — make "Add Role" a pick-existing-position-or-create flow (cheap UX; prevents permission-profile drift since cards = real positions). Model 3 — separate `org_nodes` decoupled from positions with reporting lines; deferred until a customer needs titles ≠ permissions. Minor by-design: positions with no layer show in the Editor's Unassigned bucket but not in the read-only Hierarchy tree.

**Dev smoke still owed** (Sadin, Admizz admin on dev-lead-crm): expand position cards → real people; move/remove/assign a member; add/rename/reorder/delete a layer; counselor sees read-only Hierarchy + 403 on mutations; Manage tab unchanged.

---

## Orca UI port shipped to stage — 2026-06-04

Non-FF merge at `43b074e` from `feat/orca-ui-shell` (3 commits: harvest `1be1279` → wire `4e83a57` → merge). Brief archived: `docs/archive/features/ORCA-UI-BRIEF.md`. **UI-ONLY** — no DB, no API, no agent logic.

Filled the existing `Ops | Orca` sidebar tab switcher (was an "Orca coming soon" placeholder) with a complete 6-screen AI-orchestration UI shell **harvested verbatim** from the never-merged `feature/ai-orchestrate-orca` branch (built 2026-04-10, 197 commits stale and pre-current-architecture — so harvested, NOT rebased). 12 components under `src/components/dashboard/orca/` + 6 page shells under `src/app/(main)/(dashboard)/orca/` (Overview = `page.tsx`, plus Structure / Roles / Tasks / Agents / Compare). `shell.tsx` rewired so the tab is **route-coupled**: clicking Orca pushes `/orca`; visiting any Ops route flips back to Ops mode; `navMode` derived from `pathname` (localStorage removed).

**Why safe:** harvested components import only `cn` from `@/lib/utils`, `lucide-react`, `next/link`, `react`, and their own local `./types` + siblings (zero `@/components/ui/*` shadcn dependency); destination dirs didn't exist on stage (no collisions). **No gate** — every role / tenant / industry sees the tab + all 6 pages. The old branch's later phases (DB migration `009`, `/api/v1/orca/*` CRUD, agent wiring, `cta-shimmer` globals.css animation) were **explicitly NOT ported** — static/mock data preserved as-is. The real Orca is an external product that will power this surface later; this pass is purely the surface.

**Process note:** a 22h-stale dev server missed the bulk-git-added route files → 404s on the /orca subpages. Fix was restart + `rm -rf .next`. After any merge that adds route segments, restart a long-running dev server. Also: Sonnet self-merged this to stage (non-FF) once before review — remind it to stop at "branch pushed, ready for review."

---

## Notifications + attention-badges shipped to stage — 2026-06-01

Squash-merged at `535c8ed` from `feat/notifications-badges`. 17 files, +492 / -20. Triggered by Sadin noticing during the Phase 3 smoke that nothing *signals* "something needs attention." Planned via `/crm-expert` (event taxonomy + routing + fatigue mitigation) → two `/Plan` agents (triggers plan + badge plan) → brief at `docs/NOTIFICATIONS-BADGES-BRIEF.md` (now archived) → Sonnet implemented → Opus reviewed full diff + built.

**Key design framing (CRM-expert):** the activity timeline is the system of record; notifications are only the subset needing a human to act/be aware now. "Everyone well-informed" is honored by precise **routing** + ambient **badges**, NOT by pinging the bell for every event. Self-actions are suppressed everywhere.

**What shipped:**
- **Foundation** (`src/lib/notifications.ts`): `createNotificationsExcept(actor, params[])` (self-suppress + userId dedup — the chokepoint), `getTenantAdminRecipients()`, `upsertThreadNotification()` (15-min collapse window keyed on type+userId+link).
- **Triggers:** `email.received` (poll lib, per-cycle Set + 15-min collapse, non-fatal try/catch), `lead.created` (both create paths, `is_final` guard), `lead.stage_changed` (assignee always; admins when `pipeline_stages.is_terminal`). Fixed the pre-existing self-notify bug on lead assignment (`leads/[id]` + `leads/bulk` now route through `createNotificationsExcept`).
- **Badges:** migration `028_email_read_state.sql` (`emails.read_at` + inbound backfill `COALESCE(received_at,sent_at,created_at)` + partial index), `PATCH /api/v1/email/threads/[id]/read`, `GET /api/v1/badge-counts`, `useBadgeCounts` hook (30s poll), sidebar "All Leads" red badge, Emails sub-tab unread badge with optimistic mark-read on expand.

**Scope:** universal = lead/stage triggers + badge-counts + sidebar plumbing (work for all industries immediately). Education-only = all email pieces (gated like the email feature; non-education tenants get `threads=[]` so counts are 0 + 403 on the routes).

**Review notes (3 minor, non-blocking — logged for future):** (1) `lead.created` keys `upsertThreadNotification` on the per-lead link, so collapse never fires there — just a redundant SELECT; net effect is one precise-deep-link notification per lead (arguably the better UX). (2) `upsertThreadNotification` overwrites the message with the latest rather than counting "N new". (3) linkless `email.received` (thread with no `lead_id`) won't collapse because `.eq("link", "")` doesn't match a NULL link.

**Verified at review:** build clean; `leads.converted_at` (mig 021) + `status` CHECK + response helpers + `read_at` in threads select all confirmed to exist; counselor-scope leak-points (badge-counts `new_leads` filter, mark-read ownership 404) both covered; migration 028 backfill present. **3 live-path items still need dev smoke** (email.received notification end-to-end, lead.created→sidebar badge on form submit, stage_changed counselor/admin routing) — STATUS-BOARD tracks.

**`task.due` notifications deliberately DEFERRED** to a separate brief: tasks are project-scoped (`tasks.project_id NOT NULL`, no `lead_id`), `due_date` is DATE-only, and there's no task cron — it needs a `/projects/{id}` link + a new daily workflow + a `due_notified_at` dedup column. Not bolted onto this build.

---

## Email Phase 3 (inbound polling + thread display + reply-from-CRM) shipped to stage — 2026-05-31 night

Squash-merged at `6acd9f8` from `feat/email-phase-3-poll-reply` (Sonnet's `7709ceb` commit). 13 files, +1,215 / -238 (includes 2 orphan deletes for Phase 2's `use-sent-emails.ts` + `sent-email-card.tsx`, superseded by the new threaded versions). Closes Phase 3 of the 4-phase Email feature plan. The email feature is now **bi-directional**: counselor sends → recipient replies → reply lands in CRM within ~5 min (via GitHub Actions cron) → counselor replies from CRM → recipient sees reply continue the same Gmail thread.

### What was built

**Inbound polling** (`/api/internal/email/poll` + `lib.ts` per-account loop):
- NOT under `/api/v1/` — internal surface. Bearer-auth via `INTERNAL_CRON_SECRET` env var; fail-closed if env unset (rejects ALL requests).
- Hit by `.github/workflows/email-poll.yml` every 5 min + `workflow_dispatch` for testing. ~8.6k invocations/month within GH Actions free quota.
- DB-level industry gate: `tenants!inner(industry_id)` + `.eq("tenants.industry_id", "education_consultancy")` — Zunkireelabs's legacy email-forward accounts aren't polled wastefully.
- Per-account `Promise.allSettled` over chunks of 5; per-account try/catch; per-message try/catch within the per-account loop. One account's OAuth-revoked failure doesn't block other accounts; one bad message doesn't block other messages on the same account.
- First-time bootstrap from `profile.historyId` (skips historical messages, no false matches).
- History API 404 (>7-day gap): bootstrap from current `profile.historyId`, log `last_error='history_expired_bootstrapped'`, skip the gap.
- Reply matching: Gmail `threadId` primary (exact for Gmail-to-Gmail) → RFC `In-Reply-To` fallback → `References` chain fallback. Orphan inbound silently dropped (privacy + storage + noise design call).
- Skip counselor's own outbound that Gmail's history surfaces (`from_email.toLowerCase() === account.email.toLowerCase()`).
- Idempotency: `idx_emails_gmail_message` unique index on `(connected_email_account_id, gmail_message_id)` catches duplicate inserts from overlapping polls; logged and continued.
- Token refresh chained through `listHistory` + `getMessage`; persisted fire-and-forget via `persistRefreshedToken` helper.
- Emits `email.received` event per new inbound (thread_id, lead_id, contact_id, from_email, subject, received_at, from_account_id).

**Thread display** (`<EmailThreadCard>` replaces `<SentEmailCard>`):
- Collapsed shows: subject + participant pills + count badge + last-activity time + ⬅ Reply or ✉ Sent badge depending on direction mix.
- Expanded shows messages oldest→newest with inbound (blue bubble, left-aligned) vs outbound (gray bubble, right-aligned via `flex-row-reverse`) visually distinct.
- Reply button at the bottom of expanded view.
- `useEmailThreads(leadId)` hook returns threads with embedded emails via PostgREST embed (`emails(...)` on `email_threads` — unambiguous because only forward FK between them); client-side sorts messages oldest→newest within each thread.
- `/api/v1/email/threads` rewritten to return embedded shape. **Counselor scoping change** — Phase 2's `.eq("sender_user_id", auth.userId)` silently dropped EVERY inbound row (sender_user_id is NULL on inbound); Phase 3 pre-fetches own account IDs via 2-query approach + `.in("connected_email_account_id", ownAccountIds)`. Covers both directions.
- Logged emails (`lead_activities WHERE activity_type='email'`) moved below the threads section under a "Past activity" subheader — threads are the active surface, logged emails are historical backfill.

**Reply-from-CRM** (`<ComposeEmailDialog>` extended + `/api/v1/email/send` extended):
- New optional `replyContext` prop on the compose dialog. When set: From picker **locked** to the thread's account (renders as disabled Select with "Loading…" placeholder until inboxes resolve); To pre-filled with the message-being-replied-to's `from_email`; Subject pre-filled with "Re: ..." (only prefixed when not already prefixed via `/^re:/i` test); body empty per locked decision (no quoted block).
- POST `/api/v1/email/send` extended with optional `reply_context: { thread_id, in_reply_to, references[] }`. Validates same-account constraint — returns 400 `REPLY_ACCOUNT_MISMATCH` if `from_account_id !== thread.connected_email_account_id` (because Gmail wouldn't thread it correctly + CRM would have a thread spanning two accounts). Reuses existing thread instead of creating new; increments `message_count` + updates `last_message_at`. Effective `lead_id` / `contact_id` falls back to the thread's values when not in body.
- `sendMessage()` wires the previously-stubbed `threadId` (passes to `gmail.users.messages.send.requestBody.threadId` so Gmail groups the reply) + `inReplyTo` (sets `In-Reply-To` header via MailComposer) + `references` (sets `References` header, space-separated string per RFC 5322).
- `email.sent` event payload adds `is_reply` boolean.
- Optimistic UI in `<ActivitiesPanel>`: replies find-and-update the existing thread (`setThreads(prev => prev.map(...))`); fresh sends prepend a new thread. `handleComposeClose` clears `replyContext` so state doesn't leak between compose sessions.

**`gmail-client.ts` evolution** (2 new exports + sendMessage extension):
- `listHistory(account, startHistoryId)` wraps `gmail.users.history.list` with `historyTypes: ['messageAdded']`, `maxResults: 100`. Dedupes message IDs across history entries. 404 detection returns `expired: true` so the caller bootstraps.
- `getMessage(account, messageId)` wraps `gmail.users.messages.get({ format: 'full' })`, delegates to `parseGmailMessage()` from the new `gmail-parser.ts` sibling.
- `sendMessage` extended to use the 3 Phase 2 stubs (threadId, inReplyTo, references) — no longer dead-code stubs.

**`gmail-parser.ts`** (new helper):
- `parseGmailMessage(data) → ParsedMessage`. Walks payload tree extracting headers (From, To, Cc, Subject, Message-ID, In-Reply-To, References, Date) + body parts (text/html preferred, falls back to text/plain). Custom RFC822 address parser handles `"Display Name" <addr@host>` and bare `addr@host` forms. References parser extracts `<id@host>` tokens via regex.

### Review outcomes — Opus's 9-item checklist

1. **PostgREST embed FK disambiguation** — handled. `emails(...)` embed on `email_threads` is unambiguous (single forward FK between the tables); build succeeded; live curl confirmation deferred to smoke. Same for the polling endpoint's `tenants!inner(industry_id)` join.
2. **PATCH preserves POST invariants** — N/A (no new PATCH endpoints; the existing `/email/send` is POST-only).
3. **New page components need a route shell** — N/A (no new top-level pages).
4. **`.select()` after insert/update** — clean. `email_threads` insert (fresh compose path) and `emails` insert use `.select("id").single<{id:string}>()`; threading endpoint returns the full embedded shape per the brief contract.
5. **Radix Select empty-string sentinel** — clean. Reply-mode locked Select uses the locked inbox's UUID; fresh-compose Select uses inbox UUIDs.
6. **Cross-cutting predicate audits** — done. Polling worker scopes per-account; threads endpoint scopes by tenant_id (auto via scopedClient) + lead_id/contact_id at thread level + counselor by `.in("connected_email_account_id", ownAccountIds)`.
7. **Page-padding stacks with shell** — N/A.
8. **Bearer-secret env-var presence (new in Phase 3)** — handled correctly. `route.ts:11-15` checks `process.env.INTERNAL_CRON_SECRET` before accepting any request; returns 401 + logs error if unset. Misconfigured dev with empty env can't accept any bearer.
9. **Sync-state concurrency safety (new in Phase 3)** — handled by per-account serial processing within `pollOneAccount`; concurrent polls of the same account can't happen because GH Actions runs one workflow per tick. Idempotency via the unique index on `(connected_email_account_id, gmail_message_id)` is the secondary defense.

### Sonnet's 6 self-flagged concerns — all verified clean

1. PostgREST embed shape (`emails(...)` not explicit FK name) — unambiguous; works.
2. MailComposer `references` as space-joined string — valid per RFC 5322 + nodemailer accepts string-or-array.
3. Inlined Select for reply-mode locked From (not reusing `<FromAccountPicker>`) — acceptable UX trade-off; "Loading…" placeholder until inboxes resolve.
4. Orphan files (`use-sent-emails.ts` + `sent-email-card.tsx`) — confirmed no other importers via grep; deleted as part of the squash commit.
5. `email_sync_state.connected_email_account_id` is PRIMARY KEY (not just a column) — verified in migration 025; upsert with `onConflict` works.
6. Industry-gate join `tenants!inner(industry_id)` — FK `connected_email_accounts.tenant_id → tenants.id` exists; PostgREST inner-join filter works at build.

### Minor non-blocking observations

- **`gmail-parser.ts:115` empty-body fallback** produces `<pre></pre>` when both `body_html` and `body_text` are empty. Pure cosmetic; counts as graceful degradation.
- **Counselor scoping on `/email/threads` runs 2 queries** per request (own_accounts + threads). Small overhead, acceptable; could be collapsed into a single PostgREST embed query if it ever matters.
- **`useConnectedInboxes()` is called unconditionally** in `<ActivitiesPanel>` even for non-education tenants; hook silently catches 403 and stays at []. One wasted call per lead-detail mount; minor.
- **Reply-mode `<Select>` with `lockedInbox` undefined briefly** during initial load — renders "Loading…" via placeholder. If the user disconnected the inbox between threads-load and Reply-click, Select shows empty forever. Edge case; not blocking.

### Local gates

- `npm run build` — `✓ Compiled successfully in 7.4s`. `/api/internal/email/poll` registers.
- `npx eslint --max-warnings 50 .` — 17 warnings, baseline preserved.

### Workflow notes

- **Fourth consecutive Sonnet handoff with no fixback round needed** — quality trending up. Sonnet's self-flag discipline is paying off (6 self-flags this round, all verified harmless before squash). Reinforce by referencing in future handoff prompts.
- **PostgREST embed implicit FK form is "fine until proven otherwise"** — the brief's recommendation to use `emails!emails_thread_id_fkey(...)` defensively turned out unnecessary in this case (single forward FK = unambiguous). Worth a brief-template note: don't pre-emptively add the explicit FK form unless there's actually ambiguity (forward + reverse FKs between same two tables).
- **GH Actions cron precision** worth a smoke note — schedule can lag up to 15 min during high-load periods. Test the `workflow_dispatch` path during smoke to confirm immediate trigger works; rely on the scheduled cron for ongoing operation.

---

## UTM feature (Anish's `utm` branch) rebased + shipped to stage — 2026-05-31 night

Squash-merged at `6b9d741` from `feat/utm-rebased` (a fresh branch off current stage onto which the UTM-feature files from `origin/utm` were cherry-picked). 27 files, +1,385 / -62. Anish's original `utm` branch is preserved on origin (`origin/utm`, tip `3155381`) for commit history. Migrations 026 + 027 added (renumbered from utm's original 025 + 026 to sit after Phase 1's `025_email_send_foundation`).

### What was on `utm` and what landed

Sadin asked Opus to check Anish's pushed `utm` branch and merge if alright. Initial review surfaced a major problem: Anish branched off stage **before** Email Phase 1 shipped earlier today (commit `22f291` was the merge-base) and never rebased. The raw branch diff showed it would (a) wipe the entire Email feature (Phase 1 + Phase 2), (b) cause a migration number collision (his `025_form_config_attribution.sql` vs the just-shipped `025_email_send_foundation.sql`), (c) revert CLAUDE.md, SESSION-LOG, STATUS-BOARD, and delete both archived email briefs.

Three paths considered: (1) ask Anish to rebase + force-push, (2) cherry-pick UTM files myself off stage, (3) merge as-is and lose email. Sadin picked option 2 — "do the recommended so no work is lost" — so Opus rebased locally.

### The rebase mechanics (preserved for future precedent)

For each modified file in `origin/utm` vs `origin/stage`, computed whether stage had also touched the file since the merge-base. Result: 11 modified files were utm-only-changed → straight `git checkout origin/utm -- <path>`. 2 files needed manual merge (`lead-tabs.tsx` and `types/database.ts`). 1 file (`.gitignore`) showed 0 changes on utm — preserved stage's version.

For files we deliberately did NOT apply: `CLAUDE.md` (Developer Persona section parked), `Dockerfile` (kept stage's 4096 heap), `_registry.ts` + `manifest.ts` (kept email registration), `settings/page.tsx` (kept InboxConnector), `activities-panel.tsx` (kept Phase 2 compose integration), `email-accounts/gmail/callback/route.ts` (kept Phase 1 user_id capture), `package.json` + `package-lock.json` (kept @tiptap + googleapis deps), all of `src/industries/education-consultancy/features/email/`, all `/api/v1/email/*` routes, `025_email_send_foundation.sql`, and the SESSION-LOG / STATUS-BOARD / FEATURE-CATALOG doc files (Opus wrote fresh UTM-feature entries instead of replacing email entries).

For `lead-tabs.tsx`: added utm's `import { getLeadFullName }` + the InfoGridRow Full Name expression change, **kept** Phase 2's `industryId` + `leadEmail` + `leadFirstName` + `leadLastName` props passed through to `<ActivitiesPanel>`.

For `types/database.ts`: **kept** Phase 1's `ConnectedEmailAccount` fields (user_id, display_name, refresh_token, access_token, token_expiry), **added** utm's `FormAttribution` + `UtmLink` interfaces + `attribution: FormAttribution | null` field on `FormConfig`.

### What ships in the UTM feature

- **Auto-capture from form URL**: `public-form.tsx` reads `?utm_source/medium/campaign` once on mount for `industry_id === "education_consultancy"`, falls back to per-form `attribution` defaults, then to "form". Threaded into the existing `leads.intake_source/intake_medium/intake_campaign` columns via `/api/public/submit/...` (the columns were already on Lead — no schema gap).
- **Per-form attribution defaults**: `form_configs.attribution` JSONB (default `{}`) holds `{ default_source, default_medium, default_campaign }`. Admin-side `<AttributionEditor>` mounted in form-builder; URL params still override defaults at submit.
- **UTM Link Builder + Saved Links**: new `/forms/utm-builder` admin page (industry-gated FEATURES.FORM_BUILDER) with `<UtmLinkBuilder>` (form picker / paste-URL mode / utm_* inputs) + `<UtmLinkList>` for managing saved links. Backed by `POST/GET /api/v1/utm-links` + `DELETE /api/v1/utm-links/[id]` — all industry-gated, admin-only on mutations, `scopedClient(auth)`, validates URL syntax, verifies `form_id` tenant ownership before insert.
- **Dashboard analytics for education_consultancy**: `<UtmAnalyticsSection>` on `/dashboard` with bar charts that cross-filter on click. Reads from `lead.intake_*` (no new query). Recharts wrapper with several incremental focus-outline / cursor-rectangle suppression fixes Anish iterated on.
- **Dashboard cleanup (non-UTM bundled)**: removed the duplicate LeadsTable from `/dashboard` (`/leads` is the canonical lead-list surface). Stats + 3 existing charts (LeadsByStage/Source/Counselor) remain. This was a separate decision Anish bundled into the branch (commit `7cfbdc3`) — kept since Sadin pivoted to education focus and the dashboard reads cleaner with stats/charts as the primary content.
- **`lead-name.ts` cross-cutting util**: `getLeadFullName` / `getLeadInitials` with `custom_fields.fullname` fallback when `first_name`/`last_name` are empty (real case from partial form data). Adopted by `<ContactCard>` (initials + name), `<LeadDetailV2>` (h1), `<LeadTabs>` (Personal Information Full Name row).

### Schema (2 new migrations — NEED MANUAL APPLY TO DEV DB)

- `026_form_config_attribution.sql`: 1-line `ALTER TABLE form_configs ADD COLUMN attribution JSONB DEFAULT '{}'`.
- `027_utm_links.sql`: `CREATE TABLE utm_links` with `tenant_id` FK ON DELETE CASCADE, `form_id` FK ON DELETE SET NULL, RLS (SELECT via `get_user_tenant_ids()`, INSERT/DELETE gated by `is_tenant_admin(tenant_id)`, **intentionally NO UPDATE policy** — records are immutable per the design docstring; admins delete + recreate to "change"), index on `(tenant_id, created_at DESC)`.

### Local gates

- `npm run build` — `✓ Compiled successfully in 10.4s`. All 6 email routes + both new UTM routes register (`/api/v1/utm-links`, `/api/v1/utm-links/[id]`, `/forms/utm-builder`).
- `npx eslint --max-warnings 50 .` — 17 warnings, baseline preserved.

### Items deliberately deferred / parked

- **CLAUDE.md "Developer Persona & System Guardrails" section** (commit `5679eaa`): Anish added +41 lines of meta-rules (Plan Mode default, sub-agents liberally, "demand elegance", autonomous bug fixing "do not prompt the user for direction", `lessons.md` pattern, rigorous verification). Some bits (rigorous verification) genuinely useful; some (autonomous-fix-no-prompting) conflict with the prod-merge-requires-explicit-approval rule. **Park for separate Sadin discussion** — bring back as its own PR after deciding which pieces fit.
- **Anish's feature-table additions in CLAUDE.md**: `Contacts (prospects)` row mislabeled as education_consultancy (it's actually `it_agency` via `FEATURES.CRM_CONTACTS`); `Time tracking` row correct. If we revisit CLAUDE.md, fix the mislabel.
- **UTM as a proper registered feature**: today UTM uses `FEATURES.FORM_BUILDER` for industry gating on the link-builder endpoints and inline `tenant.industry_id === "education_consultancy"` for the dashboard analytics surface. Cleaner long-term would be `FEATURES.UTM_TRACKING` constant in `_registry.ts` + manifest entry, but it's a refactor not a bug. Defer.
- **Anish's original `utm` branch** stays on `origin/utm` for now. Delete it after Anish confirms his work is captured (don't auto-delete someone else's branch).

### Workflow notes

- **Sonnet/Anish shared-clone branch staleness** is now a recurring pattern: Phase 2 first push was local-only; Anish's utm branch was 9 commits behind stage. Both recoverable but worth a checklist item — when a teammate hands off a branch for review, **always `git fetch && git log <branch>..origin/stage` first to see how stale the base is**. If non-zero, ask for rebase before reviewing the diff (or rebase yourself if you have time + permission to force-push).
- **Cherry-picking a teammate's stale branch off current main is a viable Plan B** when the teammate is offline or the conflicts are surgical. Preserve their original branch on origin for credit + audit. This was the first time we used the pattern; it worked cleanly because most utm files weren't touched on stage since utm branched. Could be tricky if stage had touched the same files heavily.
- **Migration application** is decoupled from deploy — `supabase/migrations/` ships in the container but they're applied manually via Supabase MCP (per CLAUDE.md). When a stage deploy includes new migrations, ALWAYS add an explicit STATUS-BOARD action to apply them, otherwise the deploy "looks green" but the new features 500 on first DB write.

---

## Email Phase 2 (compose + send + log on lead detail) shipped to stage — 2026-05-31 evening

Squash-merged at `977fc44` from `feat/email-phase-2-send` (Sonnet commits `a45fe02` deps + `823f8cb` Phase 2 impl + `80e3232` fixback for 4 review findings — all rolled into one squash). 14 files, +1,642 / -38. Closes Phase 2 of the 4-phase Email feature plan. The email feature is now usable end-to-end for education_consultancy: counselor opens lead → composes → sends from connected Gmail → recipient receives → sent row appears in Emails sub-tab. No schema changes — Phase 1's migration 025 already provided everything Phase 2 needs.

### What was built

**`gmail-client.ts` evolution**:
- New `sendMessage(account, args)` function using `googleapis.gmail.users.messages.send` + `nodemailer/lib/mail-composer` for RFC 822 message construction. Message-ID set explicitly as `<uuid@edgex-crm.com>` (so we know what `rfc_message_id` to store without parsing the sent message).
- Calls `refreshAccessTokenIfNeeded(account)` first; when refreshed, reuses the new access_token via `setCredentials({access_token, refresh_token, expiry_date})` so googleapis doesn't do a second OAuth roundtrip.
- Returns `{ gmail_message_id, gmail_thread_id, rfc_message_id, refreshed_credentials }` — the caller persists `refreshed_credentials` to the DB so future sends start from a cached fresh token.
- `htmlToText()` tiny stub: `html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()` — sufficient text fallback for plain-text clients (vanishing); fancier conversion can come later.
- No `threadId` / `inReplyTo` / `references` params — every Phase 2 send creates a NEW Gmail thread. Phase 3 adds reply continuation.

**Two new API endpoints**:
- `POST /api/v1/email/send` — industry-gated, `scopedClient(auth)`. Validates `from_account_id` is a UUID, `subject` ≤ 500 chars, `body_html` ≤ 200,000 chars, `to` is a non-empty string array. Owner check on `connected_email_accounts` with `.eq("user_id", auth.userId)` — returns 403 (not 404) on mismatch so we never leak existence of another user's account. Server-side merge field interpolation for `{{first_name}}` / `{{last_name}}` BEFORE Gmail call (stored content matches sent content); the lead lookup is counselor-scoped via `.eq("assigned_to", auth.userId)` so a counselor can't interpolate another counselor's lead's name. No-match silently skips interpolation (placeholders stay literal). Calls `sendMessage`; on success persists `email_threads` (one new row per send) + `emails` row + emits `email.sent` event. Fire-and-forget update of `access_token` + `token_expiry` if a refreshed token was returned (email already sent, so this is logged-on-error not blocking).
- `GET /api/v1/email/threads?lead_id=X` (or `?contact_id=X`) — industry-gated, `scopedClient(auth)`, counselor-scoped via `.eq("sender_user_id", auth.userId)`. PostgREST embed `email_threads!inner(id, lead_id, contact_id, tenant_id)` with belt-and-suspenders `.eq("email_threads.tenant_id", auth.tenantId)` on the join column (scopedClient only auto-injects on the outer `emails.tenant_id`). 400 if neither `lead_id` nor `contact_id` supplied.

**4 new UI components** (all in `src/industries/education-consultancy/features/email/components/`):
- `<ComposeEmailDialog>`: Radix `<Dialog>` with header "New email"; rows for From / To (defaults to `lead.email`) / Cc + Bcc collapsible (hidden by default; "Cc Bcc" toggle in the To row) / Subject / Body (`<TipTapEditor>` with toolbar); footer helper text "Use `{{first_name}}` and `{{last_name}}` to personalize" + Cancel + Send. Send disabled until from-account selected AND to/subject/body all non-empty (body check excludes TipTap's empty-state `"<p></p>"`). On success: optimistic prepend, toast, close, resetForm. On failure: toast with error message, modal stays open with form intact so user doesn't lose draft.
- `<FromAccountPicker>`: Radix Select bound to `useConnectedInboxes()`. 3 distinct states — 0 inboxes → disabled Select + Link to `/settings#connected-inboxes`; 1 → disabled Select with the single inbox shown (mental-model affordance for multi-inbox); 2+ → enabled Select pre-selected to inboxes[0]. Uses inbox UUID as value (avoids Radix Select's empty-string sentinel gotcha).
- `<TipTapEditor>`: controlled wrapper around `useEditor` from `@tiptap/react`. Extensions: `StarterKit` + `Link` (configured with `openOnClick: false`). Toolbar: Bold / Italic / Link (window.prompt for URL) / Bulleted list / Numbered list. Min height 200px. Syncs external `value` into the editor via `useEffect` calling `editor.commands.setContent(value, { emitUpdate: false })` with `editor.getHTML() === value` equality guard (avoids feedback loop with onUpdate). TipTap v3 uses the options-object form for `setContent` — the v2 positional-boolean form doesn't compile in v3.
- `<SentEmailCard>`: expandable list row matching the existing `<ActivityCard>` visual shape. Subject + ✉ Sent badge + "to X · timestamp" subtitle; click chevron to expand body_html (renders via `dangerouslySetInnerHTML`).

**2 new hooks** (in `src/industries/education-consultancy/features/email/hooks/`):
- `useConnectedInboxes()`: wraps GET `/api/v1/email/inboxes`. Returns `{ inboxes, loading, refresh }`. Used by both `<FromAccountPicker>` (new) AND `<InboxConnector>` from Phase 1 (refactored to use the shared hook — was previously inline fetch + setState). Single fetch-on-mount + manual refresh on disconnect/connect.
- `useSentEmails(leadId)`: wraps GET `/api/v1/email/threads?lead_id=X`. Returns `{ emails, setEmails, loading, refresh }` — exposing `setEmails` so the parent can optimistically prepend without a refetch.

**`<ActivitiesPanel>` evolution** (`src/components/dashboard/lead/activities/activities-panel.tsx`):
- Emails sub-tab now renders a **combined list** of sent emails (new `emails` table via `useSentEmails`, ✉ Sent badge) + logged emails (legacy `lead_activities WHERE activity_type='email'`, 📝 Logged badge), sorted desc by `sent_at` / `created_at`.
- New "Compose Email" primary CTA above the list, gated by `industryId === "education_consultancy"` (non-education tenants keep only the existing "Log past email" — renamed from "Log Email").
- Compose modal dynamically imported via `next/dynamic({ ssr: false })` so TipTap (~150KB) only loads when the modal opens — `/leads/[id]` first paint unaffected.
- On Send success: `setSentEmails((prev) => [optimisticEmail, ...prev])` — no refetch needed. Optimistic row is built from client-side known values (parent passes `currentUserId` for `sender_user_id`; selected inbox supplies `from_email` + `from_name`); shows pre-interpolated subject/body but the server-stored row has interpolated values (acceptable v2 trade-off — counselor sees their typed text immediately, the next refetch shows the real interpolated content).

**`<LeadTabs>` wiring**: passes `industryId` + `lead.email` + `lead.first_name` + `lead.last_name` through to `<ActivitiesPanel>`.

### Review fixback rolled into the squash

Sonnet's initial push (`823f8cb`) had 4 findings caught at review:

1. **TipTap was silently uncontrolled** — `value: string` declared in the props interface but never destructured. Editor inited with `content: ""` and only emitted via `onUpdate`. Consequence: `resetForm()` setting `bodyHtml=""` didn't actually clear the editor visually; re-opening compose showed the prior draft but Send was disabled (parent state was `""`). Also blocked Phase 3 reply prefill.
2. **`scopedClient(auth)` not used** — both new routes used raw `createServiceClient()` + manual `.eq("tenant_id", auth.tenantId)`. Brief explicitly said use `scopedClient` (lines 172, 290), Phase 1 followed the pattern, and CLAUDE.md mandates it for new tenant-touching routes. Security was upheld (manual filter present everywhere) but the regression mattered for future-edit safety. Sonnet's first-pass rationale ("the limited `{select, update, delete, insert}` object doesn't support .eq() chaining on a join column") was incorrect — `scopedClient.from("x").select(...)` returns the underlying PostgrestFilterBuilder (look at `scoped.ts:83-86` — `q.eq("tenant_id", ...)` returns the builder), which supports full chaining including embedded filters like `.eq("email_threads.lead_id", X)`.
3. **`refreshAccessTokenIfNeeded` defined but never called** — `sendMessage` only called `createOAuth2Client(account.refresh_token)`. googleapis auto-fetched from refresh_token in-memory so sends worked, but: brief's verification step `"Verify: connected_email_accounts.access_token + token_expiry updated in DB after send"` would fail; every send incurred a full OAuth roundtrip (no token caching); and the exported `refreshAccessTokenIfNeeded` was effectively dead code.
4. **Counselor scoping gap on merge-field lead lookup** — `/email/send` looked up the lead by `id + tenant_id` for `{{first_name}}` interpolation but didn't gate by `assigned_to`. A counselor could POST with any tenant `lead_id` and get their email body interpolated with another counselor's lead's name. Brief miss I owned (Phase 2 brief didn't call this out explicitly).

Fixback (`80e3232`) addressed all 4 cleanly: TipTap controlled via useEffect + setContent options-object; both routes switched to scopedClient with explicit `email_threads.tenant_id` retained on the embed; `refreshAccessTokenIfNeeded` wired with `refreshed_credentials` return + fire-and-forget persistence; counselor-scoped lead lookup with silent skip on no-match. After the fixback, all 4 fixes verified clean on local build (`✓ Compiled successfully in 8.6s`, all 6 email routes register) + ESLint at 17 baseline (no new warnings).

### Review notes — Opus's 7-item checklist (final, post-fixback)

1. **PostgREST embed FK disambiguation** — RELEVANT, handled. `/email/threads` embeds `email_threads!inner(...)` on the forward FK `emails.thread_id → email_threads.id`; no reverse FK exists so `!inner` is unambiguous. The `.eq("email_threads.tenant_id", ...)` filter applies cleanly to the join column.
2. **PATCH preserves POST invariants** — N/A. No PATCH endpoints in Phase 2.
3. **New page components need a route shell** — N/A. No new top-level page routes; compose modal is a `<Dialog>` inside existing lead detail.
4. **`.select()` after insert/update** — RELEVANT, clean. Both `email_threads` and `emails` inserts use `.select("id").single<{id:string}>()` to return the inserted row; the second insert references `thread_id` from the first, and the endpoint returns `{ thread_id, email_id, gmail_message_id }` matching the client's optimistic-insertion contract.
5. **Radix Select empty-string sentinel** — RELEVANT, handled. `<FromAccountPicker>` uses inbox UUIDs as values (non-empty strings); the disabled state for 0 inboxes is a separate non-Select div, not a Select with `value=""`.
6. **Cross-cutting predicate audits** — DONE. New `from("emails")` reads scope by `tenant_id` (auto via scopedClient) + `lead_id`/`contact_id` via thread join + counselor by `sender_user_id`. Grepped `from("emails")` across `src/` post-implementation — only the new routes touch the table.
7. **Page-padding stacks with shell** — N/A. No page wrapper changes.

### Minor non-blocking observations (logged to STATUS-BOARD)

- **TipTap empty-state setContent runs every render**: `editor.getHTML()` returns `"<p></p>"` on empty editor; if `value === ""`, the equality guard misses and `setContent("")` runs idempotently every parent re-render. Functionally harmless (no actual change, `emitUpdate: false` blocks onChange) but worth a normalization guard in a polish pass.
- **Fresh-token path doesn't use cached access_token**: when `refreshAccessTokenIfNeeded` returns null (token fresh), `sendMessage` only does `setCredentials({refresh_token: ...})` — doesn't pass `account.access_token`, so googleapis does an internal OAuth fetch anyway. Matches pre-fix behavior in that path; missed micro-optimization worth a follow-up.
- **`<SentEmailCard>` `dangerouslySetInnerHTML` on `body_html`**: narrow exploit path (admin viewing counselor's crafted body). TipTap StarterKit limits markup but doesn't sanitize stored HTML on read. Add DOMPurify in Phase 3 or 4 as part of the inbound-display work.

### Local gates

- `npm run build` — `✓ Compiled successfully in 8.6s`, all 6 email routes register (4 Phase 1 + 2 new Phase 2).
- `npx eslint --max-warnings 50 .` — 17 warnings, exactly the pre-existing baseline. No new ones.

### Workflow + tooling notes

- **Sonnet shared-clone gotcha bit again**: first push of Phase 2 was local-only — `git log origin/feat/email-phase-2-send..HEAD` returned the new commits, meaning the branch didn't exist on remote yet. Caught at review (per the existing "verify local vs origin before squash" lesson). Sonnet pushed in the fixback round. Squash picked up the commits regardless.
- **Sonnet's first-pass rationale for skipping scopedClient was incorrect** (claimed the wrapper's return object doesn't support .eq chaining on embedded join columns). Drafted fixback included a direct rebuttal pointing at `scoped.ts:83-86` so Sonnet didn't loop back on it. Sonnet accepted the rebuttal and converted cleanly. Lesson: when Sonnet pushes back on a brief constraint with a technical rationale, validate against the code (Sonnet's understanding of an unfamiliar wrapper isn't always correct). Don't accept the deviation just because the rationale sounds plausible.
- **Workflow split worked clean a fourth time**: Opus reviewed → drafted fixback prompt with Sadin pasting → Sonnet fixed on the same branch → Opus re-reviewed → squash-merged + deleted branch + docs (autonomous per CLAUDE.md). Production promotion deliberately stays gated on Sadin's explicit go-ahead per workflow.
- **TipTap version note (v3 API)**: Sonnet flagged that `setContent(content, false)` is a v2 positional-boolean form that doesn't compile in v3; the v3 form is `setContent(content, { emitUpdate: false })`. Worth knowing for future TipTap work.

---

## Email Phase 1 smoke verified on dev + Phase 2 brief written — 2026-05-31 evening

### Phase 1 smoke outcome

Counselor connect flow works end-to-end on `dev-lead-crm.zunkireelabs.com`. Admizz admin (`shrestha.sadin007@gmail.com`) successfully connected, disconnected, and reconnected. `connected_email_accounts` row populated with `user_id` correctly. `<InboxConnector>` renders the row. Industry-gated correctly (Zunkireelabs sees no card; APIs return 403). OAuth secret rotated post-smoke (the transcript-leaked secret was disabled in Google Cloud Console; new `...GmSC...` secret is the only valid one).

### Environment-setup gaps surfaced (NOT documented in Phase 1 brief — adding to STATUS-BOARD)

The Phase 1 brief covered the code shape exhaustively but glossed over the Google Cloud Console + dev-server-env setup, which turned out to be ~30 minutes of friction. For future setups (production rollout; Anish onboarding; new tenant); document these explicitly:

1. **Gmail API must be enabled at the Google Cloud Project level** (not at the OAuth client level). Discovered when the callback's `gmail.users.getProfile()` call returned 403 with `accessNotConfigured`. Direct activation URL: `https://console.developers.google.com/apis/api/gmail.googleapis.com/overview?project=<PROJECT_ID>`.
2. **The OAuth client creation flow** itself wasn't documented — assumed the Phase 1 brief would just reference existing creds. But the credentials didn't exist anywhere (the legacy email-forward feature shipped May 4 without OAuth client setup ever happening). Created fresh `edgeX CRM` OAuth client inside the existing `Orca Auth` Google Cloud project. Project name doesn't matter (multiple OAuth clients can share a project); what matters is the client_id/secret + the 4 redirect URIs (2 environments × 2 endpoints: `/api/v1/email/inboxes/callback` for the new feature + `/api/v1/settings/email-accounts/gmail/callback` for the legacy email-forward feature).
3. **Test users**: in Testing mode + External user type, only emails explicitly added as test users can OAuth. For Phase 1 smoke, `shrestha.sadin007@gmail.com` was already a test user (carryover). For production rollout to Admizz counselors, each counselor email needs adding (≤100 cap) OR the app needs to be "Published" (External + Production, requires Google verification, 1-2 weeks).
4. **`docker compose restart` does NOT re-read `env_file`** — only `docker compose up -d --force-recreate` does. The first `restart` attempt left the container running with stale env (no `GOOGLE_*` vars), making the endpoint return 503 silently. Force-recreate is the correct command after editing `.env.local`. Worth documenting in the deploy README or the project docs.
5. **Production `.env.local` also lacks `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`** — confirmed via inspection. Prod-promotion of Phase 1 won't work until those are added to `/home/zunkireelabs/devprojects/lead-gen-crm/.env.local` AND the prod container is force-recreated. The redirect URIs for prod are already in the OAuth client (added at creation time). The Gmail API is enabled at the project level so all OAuth clients in `Orca Auth` benefit.

### Workflow notes

- The line-wrapping in Sadin's terminal repeatedly broke long single-line SSH commands during this smoke session. Future env-setup walkthrough should use multiple short commands or write a one-shot shell script.
- The auto-mode classifier correctly blocked the prod `.env.local` read attempt (production credential dump). Read-only checks against dev got through. Sadin had to run prod-credential reads via the `!` prefix with explicit authorization per command.
- Sadin offered to paste the OAuth credentials directly in chat (rather than continuing the friction-laden pbpaste / nano dance). The two-step rotation (create new secret, paste it, kill old) closed the transcript-leak window cleanly. Good pattern for future emergency credential additions.

### Phase 2 brief

Written at `docs/EMAIL-PHASE-2-BRIEF.md` (625 lines). Covers: compose modal with TipTap rich text + From dropdown + To/CC/BCC; `POST /api/v1/email/send` (industry-gated, scopedClient, server-side merge field interpolation, persists email_thread + email + emits `email.sent`); `GET /api/v1/email/threads?lead_id=X` (counselor-scoped); 4 new UI components (`<ComposeEmailDialog>`, `<FromAccountPicker>`, `<TipTapEditor>`, `<SentEmailCard>`); 2 new hooks (`useConnectedInboxes`, `useSentEmails`); `<EmailsSubTab>` evolution on lead detail to merge sent emails with logged emails + add Compose CTA (industry-gated). No schema changes (Phase 1's mig 025 already has everything). Decisions locked in: TipTap not react-quill; MailComposer from nodemailer/lib for RFC 822; Message-ID set explicitly as `<uuid@edgex-crm.com>`; threadId NOT passed to gmail.users.messages.send in Phase 2 (every send is a new thread); attachments OUT of scope (Phase 4). Sonnet handoff prompt in fenced code block at the bottom. Ready for Sadin to paste.

---

## Email Phase 1 (foundation) shipped to stage — 2026-05-31 evening

Squash-merged at `c9db7c2` from `feat/email-phase-1-foundation` (Sonnet commits `56adace` deps + `eee63c8` feature, rolled into one squash). 15 files, +887 / -31. Closes Phase 1 of the 4-phase Email feature plan. Foundation only — no send, no UI on lead detail, no inbound sync (those are Phases 2/3/4).

### What was built

**Schema (migration 025 — applied to dev DB during Sonnet's implementation)**:
- Alter `connected_email_accounts`: add `user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE` + `display_name TEXT`. Backfill: assign existing rows to each tenant's owner via `SELECT user_id FROM tenant_users WHERE tenant_id = cea.tenant_id AND role = 'owner' ORDER BY created_at ASC LIMIT 1`; any rows still NULL after backfill (defensive) → DELETE. New `UNIQUE(user_id, email)` index. RLS shifted from tenant-admin-scoped (mig 018 pattern) to **user-scoped** (each user manages own inboxes) with a separate tenant-admin SELECT policy for read-only oversight. Service role policy preserved.
- New `email_threads`: `(id, tenant_id, connected_email_account_id, gmail_thread_id, lead_id?, contact_id?, subject, last_message_at, message_count, created_at, updated_at)` with `UNIQUE(connected_email_account_id, gmail_thread_id)` and lead/contact partial indexes. Standard tenant RLS via `get_user_tenant_ids()`.
- New `emails`: `(id, tenant_id, thread_id, connected_email_account_id, direction CHECK ('outbound','inbound'), from_email, from_name, to_emails[], cc_emails[], bcc_emails[], subject, body_html, body_text, gmail_message_id, rfc_message_id, in_reply_to, rfc_references[], sent_at, received_at, sender_user_id?, created_at)`. **Both** `gmail_message_id` (Gmail's internal) and `rfc_message_id` + `in_reply_to` + `rfc_references` (RFC 5322 headers) are stored — v1 queries by Gmail thread_id for speed; RFC headers are insurance for a future Outlook swap with zero data migration. Column name is `rfc_references` not `references` because Postgres reserves the latter as an FK keyword.
- New `email_sync_state`: `(connected_email_account_id PK, last_history_id, last_synced_at, last_error, consecutive_error_count, updated_at)` — one row per connected account; the Phase 3 polling worker maintains it. Owner can SELECT own state (debug surface); only service role mutates.

**Code (15 files)**:
- `package.json` + `package-lock.json`: `npm install googleapis` (official Google APIs Node.js client).
- `src/industries/_registry.ts`: `FEATURES.EMAIL = "email"`.
- `src/industries/education-consultancy/manifest.ts`: register `emailMeta`. No sidebar entry (compose is invoked from lead/contact detail in later phases; no top-level inbox-list page planned for v1).
- `src/industries/education-consultancy/features/email/meta.ts`: `FeatureMeta { id: FEATURES.EMAIL, industries: [INDUSTRIES.EDUCATION_CONSULTANCY] }`.
- `src/industries/education-consultancy/features/email/lib/gmail-client.ts`: wraps `googleapis` with **3 Phase 1 functions only** — `createOAuth2Client(refreshToken)` (returns configured OAuth2Client), `getProfileEmail(client)` (calls `gmail.users.getProfile({ userId: "me" })` and returns `.emailAddress`), `refreshAccessTokenIfNeeded(account)` (refreshes if expiry within 5-min buffer; Phase 2/3 callers persist the result). No send/list/get yet — Phase 2 will add `sendMessage()`, Phase 3 will add `listHistory()` + `getMessage()`.
- `src/industries/education-consultancy/features/email/components/inbox-connector.tsx`: client component. Fetches `/api/v1/email/inboxes` on mount, re-fetches after Connect/Disconnect. Renders card titled "Connected Inboxes" with subtitle, "Connect a Gmail inbox" CTA (POSTs `/connect`, redirects to returned Google URL), per-row "Disconnect" button (destructive variant). Reads `?connected=<email>` and `?error=<reason>` from search params on mount → toast + URL cleanup via `router.replace`. Uses `useSearchParams()` which forces the `<Suspense>` wrapper at the call site (Next.js 16 requirement). Card chrome matches established design tokens (`border bg-card rounded-lg shadow-none p-3`).
- `src/app/(main)/(dashboard)/settings/page.tsx`: conditionally renders `<InboxConnector>` (wrapped in `<Suspense>`) after `<EmailRulesManager />` when `getFeatureAccess(tenantData.tenant.industry_id, FEATURES.EMAIL)` returns true.
- `src/app/(main)/api/v1/email/inboxes/route.ts` (GET): `authenticateRequest` → industry-gate → `scopedClient(auth).from("connected_email_accounts").select(...).eq("user_id", auth.userId)`. Belt-and-suspenders: both the explicit `.eq` AND the user-scoped RLS enforce.
- `src/app/(main)/api/v1/email/inboxes/connect/route.ts` (POST): builds Google OAuth URL with `scope = mail.google.com + userinfo.email`, `access_type = offline`, `prompt = consent` (mandatory for multi-inbox — without it Google doesn't re-issue a refresh_token for the 2nd-and-later inbox per user, causing NOT NULL constraint failure on insert), HMAC-signed `state = userId.sig` (HMAC secret falls back to `NEXT_PUBLIC_SUPABASE_ANON_KEY` if `NEXTAUTH_SECRET` not set — defense-in-depth; the primary protection is the session check in the callback). Returns `{ url }`.
- `src/app/(main)/api/v1/email/inboxes/callback/route.ts` (GET): industry-gates **before** code exchange (non-education tenants get a redirect to `/settings?error=forbidden` even though it's an OAuth landing page — preserved invariant). Validates state HMAC against current session's user. Exchanges code at `https://oauth2.googleapis.com/token`. Uses `createOAuth2Client` + `getProfileEmail` to fetch the connecting user's Gmail address. Idempotent upsert keyed on `(user_id, email)` via service client (RLS doesn't apply to service client; the user_id is hardcoded to `auth.userId` so no cross-user write risk). Redirects to `/settings?connected=<email>#connected-inboxes` on success.
- `src/app/(main)/api/v1/email/inboxes/[id]/route.ts` (DELETE): `authenticateRequest` → industry-gate → `scopedClient(auth).from(...).delete().eq("id", id).eq("user_id", auth.userId)`. **Both** `.eq("id")` AND `.eq("user_id")` are required per the scopedClient contract — the wrapper auto-injects `tenant_id` but NOT a row-level filter, so without `.eq("id")` the delete would target every inbox owned by the user in the tenant.
- `src/app/(main)/api/v1/settings/email-accounts/gmail/callback/route.ts` (legacy, evolved): adds `authenticateRequest()` after the state decode, captures `user_id = auth.userId`, writes it into both the insert and the update branches. This keeps the schema's `user_id NOT NULL` invariant satisfied for the legacy email-forward connect flow (it was previously tenant-only).
- `src/types/database.ts`: `ConnectedEmailAccount` type updated with new columns.

**Industry-gating verified at review**: all 4 new endpoints (`GET`, `POST /connect`, `GET /callback`, `DELETE /[id]`) call `getFeatureAccess(auth.industryId, FEATURES.EMAIL) → apiForbidden()`. The callback gates BEFORE the code exchange — important so non-education tenants can't even consume the OAuth landing page.

### Review notes — Opus's 7-item checklist

1. **PostgREST embed FK disambiguation** — N/A. No new PostgREST embeds across reverse FKs. The pre-existing `email_forward_rules ← connected_email_accounts(email)` embed in `/api/v1/settings/email-rules` is unchanged and still works (forward FK only; no ambiguity).
2. **PATCH preserves POST invariants** — N/A. No PATCH endpoints in Phase 1.
3. **New page components need a route shell** — N/A. No new top-level page routes; the `<InboxConnector>` is conditionally rendered as a card on the existing `/settings` page.
4. **`.select()` after insert/update** — N/A. The callback doesn't return the row to the client; it redirects. The list endpoint `GET /api/v1/email/inboxes` freshly queries on settings page mount + post-action re-fetch in the component.
5. **Radix Select empty-string sentinel** — N/A. No Select component in Phase 1 (the Connect button is a plain `<Button>`).
6. **Cross-cutting predicate audits** — **DONE AND CLEAN**. Grepped `from("connected_email_accounts")` across `src/` (9 hits across 6 files). The 3 legacy endpoints (`/settings/email-accounts/route.ts`, `/settings/email-accounts/[id]/route.ts`, `/settings/email-rules/route.ts`) all use `createServiceClient()` which **bypasses RLS entirely** — so the RLS shift from tenant-admin-scoped to user-scoped is a complete no-op for the legacy reads. They continue working as before because they're not hitting RLS at all. The new endpoints (`/email/inboxes/*`) use `scopedClient` which goes through the new user-scoped policies; verified per call site. The legacy DELETE additionally has its own admin-level access check (`requireAdmin(auth)` + service client) plus a `email_forward_rules` FK check that returns 409 if rules depend on the inbox. The new DELETE does NOT have that FK check — logged as a hardening backlog item on STATUS-BOARD because it's theoretical for Phase 1 (no email-forward rules will be created against per-user inboxes); the FK is `ON DELETE SET NULL` so the worst case is a rule silently breaks.
7. **Page-padding stacks with shell** — N/A. No new page wrappers.

### Sonnet's self-flagged concerns — both theoretical, no fixback needed

- **Legacy callback `authenticateRequest()` on SameSite=Lax cookie**: Supabase's `@supabase/ssr` uses Lax cookies by default; OAuth redirect from Google is a top-level navigation, which SameSite=Lax permits. The auth cookie WILL be sent. Worth a manual smoke of the legacy `/api/v1/settings/email-accounts/gmail/auth → Google → callback` flow to confirm, but not a code change.
- **RLS cross-audit "tenant-admin SELECT policy covers legacy reads"**: technically true but moot — legacy reads use service client and never hit RLS at all. The cross-audit (point 6 above) confirms the no-op.

### Minor (non-blocking) observations

- **Stylistic redundancy in callback** (lines 95-99): `createOAuth2Client(refreshToken)` already calls `setCredentials({ refresh_token })` internally; the callback then calls `oauthClient.setCredentials({ access_token, refresh_token })` explicitly, replacing the credentials object. Functionally correct, harmless redundancy. Not worth a fixback.
- **HMAC secret fallback to `NEXT_PUBLIC_SUPABASE_ANON_KEY`**: anon key isn't secret, so an attacker who knows it could forge a state param. But the callback also validates the embedded `userId` against `auth.userId` from the session — so forging a state would still require authenticating as that user. The HMAC is defense-in-depth, not the primary protection. Production should set `NEXTAUTH_SECRET` explicitly to be tidy; not blocking.

### Local gates

- `npm run build` — clean (0 errors, 0 TypeScript errors).
- `npx eslint --max-warnings 50 .` — 17 warnings, exactly the pre-existing baseline. No new ones introduced.

### Workflow + tooling notes

- **Workflow split worked clean a third time**: Opus planned + wrote brief, Sadin pasted Sonnet handoff prompt, Sonnet implemented + committed locally + pushed to remote (correctly this time, no shared-clone snag). Opus reviewed against brief + 7-item checklist + verification matrix + ran local gates myself + caught no real issues + squash-merged + deleted the feature branch on remote (autonomous per CLAUDE.md "Stage merges + branch deletes are autonomous").
- **Sonnet's handoff included two self-flagged concerns** (SameSite=Lax + RLS coverage). Both were theoretical — important behavior: Sonnet is now self-flagging risk areas even when they don't need code changes, which gives Opus's review better signal. Reinforce this pattern in future brief handoffs.
- **Brief auth check**: the legacy callback authentication addition wasn't in my Phase 1 brief verbatim — I said "Authenticate the request first with `authenticateRequest()` if it isn't already (read the file — it likely already authenticates)" but the file didn't actually authenticate, it just trusted the state param's tenantId. Sonnet correctly added the call. Lesson for briefs that touch existing routes: don't punt with "it likely already authenticates" — read the file, state the current behavior, then describe the change. Saved this time because Sonnet read carefully.

---

## Production promotion 2026-05-31 evening — Account 360 v2

Non-FF ort merge of `origin/stage` into `main` at `0f58a0a`. Deploy to Production completed clean in 4m23s. 4 stage commits land on production (1 brief + 1 feature squash + 2 docs commits).

### What shipped

- **`628ff0a` `docs(accounts):` Account 360 v2 brief** — design brief authored before implementation.
- **`0ec69a1` `feat(accounts):` Account 360 v2 — billable totals + Account Team card + Activity tab** — 18 files, +1,080 / -35. Closes the 3 explicit deferrals from Account 360 v1 (`d1a4b89`). Billable totals in KEY INFO (this month $ + ▲/▼/—/New delta pill vs last month + this month hrs + lifetime $). Account Team card slotted between Health and OpenLeads (two-group Owners/Contributors structure, role pills per CRM-expert PSA pushback, 90-day contributor filter). Activity tab content (events table UNION derived time-logged stream aggregated by user+day+project, paginated 30/page). 3 new API endpoints (`billable-summary`, `team`, `activity`); 5 `emitEvent()` additions on existing PATCH/approve/reject/convert routes; 2 new utils (`format-billable-delta`, `format-relative-time`). One fixback rolled in for time_entry events being silently dropped from the Activity feed (gap in the v2 brief).
- **`82e4282` `docs:` record /accounts/[id] v2 shipped (0ec69a1) + brief archived + status board updates** — SESSION-LOG dated entry + STATUS-BOARD updates + brief archived to `docs/archive/features/ACCOUNT-DETAIL-360-V2-BRIEF.md`.
- **`426a97a` `docs:` pivot focus to education_consultancy; pause IT-agency surface pass** — focus pivot recorded in SESSION-LOG resume block + STATUS-BOARD top item.

### Pre-flight discipline held

- Most recent stage deploy `426a97a` confirmed "completed" in 5m13s before pushing main; no concurrent stage deploy at promotion time.
- `git log origin/main..origin/stage` showed expected 4 commits (brief + squash + ship docs + pivot docs).
- `git log origin/stage..origin/main` showed 7 main-only operational commits (5 prior promotion merges + Anish "Merge stage" from 2026-05-21 + CI redeploy nudge). Non-FF ort merge resolved zero conflicts; 22 files +1,616 / -49 in the merge.
- The 30m SSH timeout fix (`5ce03d2`) wasn't exercised this run — no concurrent dual-deploy.

### Live smoke

- `/login` → 200 in 381ms.
- `/accounts` → 307 (auth redirect; expected).
- `/contacts` → 307.
- `/pipeline` → 307.

Visual smoke on `/accounts/[id]` (3 KEY INFO billable rows + Team card between Health and OpenLeads + populated Activity tab) deferred to Sadin's next session as Zunkireelabs admin on `lead-crm.zunkireelabs.com`.

---

## `/accounts/[id]` v2 shipped to stage — billable totals + Account Team + Activity tab (2026-05-31 afternoon)

### What was built

Squash-merged at `0ec69a1` from `feat/account-detail-360-v2` (Sonnet's `e1741c4` feature commit + `f4e87c5` fixback, both rolled into one squash). 18 files, +1,080 / -35. UI additions + 3 new API endpoints + 5 small `emitEvent()` additions on existing routes; no DB migrations. Closes all 3 explicit deferrals from the v1 brief (`d1a4b89`).

**Pre-flight CRM-expert framing (quoted verbatim in the v2 brief)**:
- **Billable totals — KEY INFO + a trend signal, no sparkline yet**. 2 KEY INFO rows is the floor; add a third for billable hrs (utilization signal). On the dollar row, add a tiny ▲/▼ delta vs last month — that's the killer signal in PSA dashboards (Productive + Harvest both lead with it). Defer sparkline to v3. Drop the duplicated "supplemental line" in the Overview Active Projects card — three places saying the same number is two places too many.
- **Account Team card — two-group structure, NOT a flat list**. Salesforce's flat "Account Team" is wrong shape for PSA; agencies have a real Owner/IC distinction. Group 1 Owners (account owner pinned first + project owners). Group 2 Contributors (everyone else who logged time in last 90 days). Role labels per row: `Account Manager` / `Project Lead` / `Contributor` (PSA-canonical; avoid job titles like "Engineer"/"Designer" — those belong on user profile). Per-row content: avatar + name + role pill + hrs-this-month + "Active Nd ago" tag if >14d.
- **Activity feed — events table + derived time-logged stream**. Critical aggregation: group time entries by `user + day + project` — "Alice logged 6.5h on Project X on May 28" — one row per group, not one per entry. This is the difference between a usable feed and an unreadable wall of noise. Exclude individual task status changes, task comments, file uploads at account level (those belong on Project Activity instead). Filter chips ("All / Time / Projects / Contacts / Changes") deferred to v3.

**Backend additions** (3 new endpoints under `src/app/(main)/api/v1/accounts/[id]/`):
- `billable-summary` — 3 parallel queries (`this_month`, `last_month`, `lifetime`) on `time_entries JOIN projects WHERE account_id` filtered to `is_billable + approved`. Sums in app code: `(minutes / 60) * rate_snapshot`. Counselor scopes to own `user_id`. Returns `{ billable_minutes, billable_amount }` per period.
- `team` — Identifies owner set (account owner + project owners on this account). Identifies contributors via DISTINCT `user_id` from `time_entries JOIN projects WHERE created_at > NOW() - INTERVAL '90 days' AND user_id NOT IN owner_set`. For each user computes `hrs_this_month`, `last_active_at`, `owned_projects_count` (project leads only). Email lookups via `scopedClient.raw().auth.admin.getUserById()` in parallel (N+1 acceptable for <20-person teams; brief flagged the trade-off). Sorts in app code per the two-group structure. Does NOT scope by counselor (team identity is shared info — explicit override).
- `activity?page=1&limit=30` — Heaviest of the 3. Pre-fetches projects/contacts/leads scoped to account. Runs 3 parallel queries: (a) events on `[accountId, ...projectIds, ...contactIds, ...leadIds]` excluding `time_entry.created`; (b) time_entry approve/reject events filtered by `payload.account_id` (added during fixback); (c) raw time_entries for the derived stream. Aggregates time entries via Map keyed `user_id:entry_date:project_id` summing minutes. Merges all three streams sorted `created_at desc`, paginates 30. Email enrichment for each unique `payload.user_id` in the page. Counselor scoping on (b) via `payload->>user_id` filter and on (c) via direct `user_id`.

**5 `emitEvent()` additions** (each 1-3 lines on existing routes) enable Activity feed coverage:
- `account.updated` in PATCH `/api/v1/accounts/[id]` with `{ changed_fields, old, new }`. Changed pre-fetch from `select("id")` → `select("*")` to capture old values.
- `project.updated` in PATCH `/api/v1/projects/[id]` with `{ changed_fields, old, new, account_id }`.
- `time_entry.approved` in POST `/api/v1/time-entries/[id]/approve` with `{ user_id, project_id, minutes, account_id, rate_snapshot }`. account_id derived from the updated result's joined `projects.account_id`.
- `time_entry.rejected` in POST `/api/v1/time-entries/[id]/reject` with `{ user_id, project_id, minutes, account_id, rejection_reason }`.
- `lead.converted` in POST `/api/v1/leads/[id]/convert` with `{ lead_id, contact_id, account_id }`.

**Frontend — 9 files** (3 new components + 4 extends + 1 page extend + 1 barrel):
- `AccountKeyInfoSection` extended with 3 billable rows between Open Leads and Created: `Billable this month` (`formatCurrency` + DeltaPill via `formatBillableDelta`), `Billable hrs this month` (`XX.X hrs`), `Lifetime billable`. Counselor sees "Your hours only" hint below the rows.
- `AccountRelatedPanel` slots `AccountTeamCard` between `HealthSnapshotCard` and `OpenLeadsCard`. Conditional render when team data loaded.
- `AccountTabs` wires the Activity tab (was disabled in v1 with "Coming soon" tooltip). Billing tab tooltip updated to "v3". Tab order: Overview · Projects · Contacts · Activity · Billing*.
- `AccountTeamCard` (new) — header `Team (N)` with both groups sub-sectioned. `TeamRow` sub-component renders avatar (28px circle, initials from email[0:2]) + name + role pill (color-coded) + subtitle ("Owns 2 projects" for project leads) + hrs-this-month right-aligned + "Active Nd ago" line when stale.
- `ActivityTab` (new) — client component. Stateful items + nextPage. `loadMore()` POSTs to `/activity?page=N`, appends results, updates nextPage. Empty state. After fixback: `toast.error("Failed to load more activity")` on fetch failure (was silent catch).
- `ActivityRow` (new) — switch on `item.type` produces icon + text per the brief's row table. Imports `PROJECT_STATUS_MAP` for "Project X → Active" labels (single source of truth, reused from v1 cross-cutting export). Relative timestamps via `formatRelativeTime`.
- `AccountDetailPage` extended with 3 additional parallel fetches in the `Promise.all` (7 total now). 3 new state vars (`billableSummary`, `team`, `activity`). Props passed down to subcomponents.
- `index.ts` barrel exports the 3 new components + types.
- 2 new utils under `src/lib/`: `format-billable-delta` (handles both-zero null, lastMonth-zero "New" pill, percent rounding, ▲/▼/— direction strings) + `format-relative-time` ("just now" → Xm/Xh/Xd/last month/X months ago/over a year ago).

### Fixback caught at review (rolled into the squash)

**Real defect — root cause was a gap in the brief I wrote**: `time_entry.approved` and `time_entry.rejected` events were emitted with `entityType: "time_entry", entityId: <te-id>`. The activity query filtered `.in("entity_id", allEntityIds)` where `allEntityIds = [accountId, ...projectIds, ...contactIds, ...leadIds]` — time_entry IDs were NEVER in that list, so the events were silently dropped, even though `activity-row.tsx` had switch cases expecting to render them. The brief's example query also omitted time_entry events; Sonnet faithfully implemented the (flawed) design.

**Fix (`f4e87c5`, rolled into the squash)**: added a third parallel query alongside `eventsRes` and `timeRes`:

```ts
db.from("events").select(...)
  .eq("entity_type", "time_entry")
  .neq("type", "time_entry.created")
  .contains("payload", { account_id: id })
  .order("created_at", { ascending: false })
  .limit(50)
```

For counselor: chained `.filter("payload->>user_id", "eq", auth.userId)` before the limit. Results merged into `eventItems` before the existing sort/paginate step. New event rows pick up email enrichment via the existing per-page `payload.user_id` loop.

Same fixback also fixed the Activity tab's silent error swallowing: `loadMore()`'s `catch { /* ignore */ }` replaced with `toast.error("Failed to load more activity")`. Mirrors the existing toast pattern in `account-detail.tsx`.

Lesson logged in the resume block: **query design in briefs needs the same "does this match what the spec table claims?" cross-check as feature scope**. The v2 brief specified a query that explicitly couldn't return time_entry events even though the row table expected them. Owned the gap in the fixback prompt.

### Workflow + tooling notes from this session

- **Workflow split worked clean a second time**: Opus planned v2 (closing v1 deferrals — CRM-expert consult was already in the v2 brief from prior session), Sadin pasted the Sonnet handoff prompt, Sonnet implemented + committed locally on `feat/account-detail-360-v2` (commit `e1741c4`) + pushed to remote. Opus reviewed against brief + 7-item code-review checklist + caught the time_entry events gap + wrote tight fixback prompt. Sadin pasted fixback to Sonnet. Sonnet committed `f4e87c5` locally — **but didn't `git push`** (workflow snag: Sonnet was operating in this shared clone, not a worktree; commits landed locally but not on origin). Opus had the commit locally anyway via the shared clone, ran gates (build + ESLint clean, 17 warnings = baseline), squash-merged from local feat branch, archived brief, wrote docs.
- **Sonnet self-flagged two non-issues**: (a) IN-clause size on the activity endpoint with many contacts/leads — fine at current scale, idx_events_tenant_id handles it; (b) IIFE pattern in approve/reject emitEvent payload — stylistic, no change needed. Sonnet did NOT self-flag the time_entry events bug — they thought their query design (matching the brief) was correct. Lesson: Sonnet's self-review will catch implementation issues but not spec issues; the spec-check is Opus's responsibility at review time.
- **Commit-msg hook IS installed in this clone** (recreated in prior session). Sonnet's `f4e87c5` correctly shows the Anish trailer. My squash commit `0ec69a1` shipped with NO trailer because I forgot to include the Claude trailer in my commit message — without a trailer to replace, the hook can't add one. Not critical; left as-is. Future commits: remember to include `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` so the hook can rewrite it.

---

## Production promotion 2026-05-31 — Contact 360 + Sidebar grouping + Account 360 + polish + docs

Non-FF ort merge of `origin/stage` into `main` at `7863473`. Deploy to Production completed clean in 4m17s. 8 stage commits land on production (3 feature squashes + 1 polish + 4 docs).

### What shipped

- **`4890488` `feat(contacts):` 3-column /contacts/[id] 360° detail (Lead-v2 parity)** — 11 files (1 rewrite + 9 new subcomponents + 1 API extend), +1,049 / -269. CRM-expert reviewed: right column = account-first (umbrella for a single contact). Backend extends GET `/api/v1/contacts/[id]` with `source_lead` (lead provenance via reverse `converted_contact_id`) + `account_siblings` (LIMIT 11 trick for ">10" detection) + `account_owner_email` (via `scopedClient.raw().auth.admin.getUserById`). V2 deferrals: `contact_notes` table + timeline composer, `contact_activities` audit log, last interaction date, Log Meeting persistence.
- **`b6219b2` `feat(shell):` sidebar nav grouping — Project Management group for IT agency** — 4 files, +186 / -53. 1-level-deep collapsible groups via `SidebarEntry = SidebarItem | SidebarGroup` discriminated union + optional `position?: "before-pipeline" | "after-pipeline"`. IT-agency Projects + Time Tracking + Approvals nest under "Project Management" parent (FolderKanban icon). Pipeline repositioned to between Accounts and the new group. 5-region renderer (top → before-pipeline industry → Pipeline → after-pipeline industry → bottom). Other 5 industries unchanged.
- **`6abeac0` `fix(shell):` truncate sidebar group label + tooltip on hover** — uses existing `TruncatedText` component (ResizeObserver-based overflow detection, no false-positive tooltips on short labels) so "Project Management" stays on one line even at narrow sidebar widths. `min-w-0` + `shrink-0` on icon for the flex truncation to work.
- **`d1a4b89` `feat(accounts):` /accounts/[id] 360° detail — workspace-first redesign** — 12 files (1 rewrite + 10 new subcomponents + 1 API extend + 1 cross-cutting export), +1,293 / -327. CRM-expert flipped the framing: Account is a workspace container (PSA pattern — Productive/Teamwork/Harvest), NOT a stakeholder record. Right column work-status-first (HealthSnapshotCard + conditional OpenLeadsCard; no Lead Provenance card — dropped). Primary Contact promoted to LEFT header (identity attribute). Middle = 5-tab strip / 3 wired (Overview · Projects · Contacts; Activity + Billing disabled with `<Tooltip>` "Coming soon" wrapping `<span>` for the disabled-element workaround). Backend Promise.all for `owner_email` + `project_status_mix` (6-key count reduced in app code) + `open_leads_count` (HEAD exact count). Cross-cutting: `PROJECT_STATUS_MAP` exported from `time-tracking/status-badge` as single label source-of-truth (fixback `de2f955` rolled in before merge; caught Sonnet inventing friendly labels "Discovery"/"In Progress"/"Review" that clashed with same-page `ProjectStatusBadge` rendering "Planning"/"Active"/"In Review").
- **+4 docs commits**: `ce67d1b` (contact-360 archive), `f9469be` (sidebar archive + end-of-session resume), `9f32e48` (account-360 archive + status board updates), and `442de0a` (prior prod promotion record — was on stage going forward).

### Pre-flight discipline held

- Stage deploy of `9f32e48` (most recent docs commit) completed in 4m22s; the prior `f9469be` deploy in 5m3s. No concurrent stage deploy at promotion time, so the 30m SSH timeout fix (`5ce03d2`) wasn't tested. Just the discipline.
- `git log origin/main..origin/stage` showed expected 8 commits.
- `git log origin/stage..origin/main` showed 6 main-only operational commits (resume said 5 — extra Anish merge from 2026-05-21 noted but no app code to preserve): `f9af70d` `f78abcc` `d3cd235` `c13e594` (prior promotions) + `e10b97d` (Anish merge) + `02fe74e` (CI nudge). Non-FF ort merge resolved clean — zero conflicts.

### Live smoke

- `/login` → 200 in 318ms.
- `/accounts` → 307 (auth redirect; expected).
- `/contacts` → 307.
- `/pipeline` → 307.

Dev was already smoked for Account 360 before the prod push: 3-column layout intact on Admizz Education account, Building2 avatar + Active pill + Primary Contact (Manish Sah) + 4 quick actions with Email disabled-faded when no primary_contact_email, KEY INFO collapsible with 7 rows, all 5 middle tabs render with Activity + Billing slightly faded, HEALTH card with status + orange "Active" status dot + open leads 0, OpenLeadsCard correctly absent because count===0.

### Workflow + tooling notes from this session

- **Workflow split worked clean**: Opus planned (with CRM-expert consult on right-column ordering), wrote brief at `docs/ACCOUNT-DETAIL-360-BRIEF.md` ending with fenced Sonnet handoff prompt, Sadin pasted to Sonnet, Sonnet implemented + pushed on `feat/account-detail-360`. Opus reviewed against brief + 7-item code-review checklist, caught the label inconsistency, wrote tight fixback prompt for Sonnet (same file). Sonnet pushed fixback `de2f955`. Opus re-reviewed (clean), squash-merged to stage, archived brief, updated docs, promoted to prod. Total span: a few hours of Sadin's time, near-zero rework.
- **Lesson logged in status board**: when a brief says "use design tokens" or "use status labels", be explicit about the source-of-truth file Sonnet should import from — otherwise Sonnet may reinvent rather than import.
- **`.git/hooks/commit-msg` is MISSING** in this clone (only `.sample` files exist). CLAUDE.md describes the hook as replacing the Anthropic co-author line with Anish on every commit. Without the hook, Opus's commits today (`d1a4b89`, `9f32e48`, prod merge `7863473`) ship with the `Co-Authored-By: Claude Opus 4.7 (1M context)` trailer. Sonnet's commits (e.g. `00d3e39`, `de2f955`) have the correct Anish trailer because Sonnet's environment has the hook installed. Recreating the hook is a small one-time setup — defer until Sadin can supply the hook contents.

---

## `/accounts/[id]` 360° detail page shipped to stage — workspace-first redesign, CRM-expert reviewed (2026-05-29 evening)

### What was built

Squash-merged at `d1a4b89` from `feat/account-detail-360` (Sonnet branch `00d3e39` feat + `de2f955` fixback). 12 files (1 rewrite + 10 new subcomponents + 1 API extend + 1 cross-cutting export), +1,293 / -327. UI restructure + 3 small backend additions; no DB migrations.

**Context**: prior `/accounts/[id]` was a single-column form view (name + Active/Inactive + primary-contact picker → Contacts list → 2/3+1/3 grid of Projects + Lead-contacts). The user wanted parity with the just-shipped Contact 360, but **CRM-expert flipped the framing**: the Account is a *workspace container* (PSA pattern — Productive/Teamwork/Harvest), not a stakeholder record. Different right column ordering and middle column treatment as a result.

**Pre-flight CRM-expert findings** (quoted verbatim in brief):
- Right column is work-status-first, NOT people-first. **Primary Contact promoted to LEFT header** (identity attribute, like "CEO of").
- Middle column = tabs YES (not stacked sections) because volume difference vs Contact (multi-projects + multi-contacts + multi-leads).
- Action button primary = "Add Project" (agency CRMs lead with new project creation), not "Email Primary".
- Drop Lead Provenance card entirely — lead-to-account doesn't have the clean 1:1 mapping lead-to-contact does. Open Leads card already covers any pre-conversion attachment.
- Exclude: Stage/Pipeline/Convert (post-conversion), Score (ill-defined for accounts), **account-level Tasks** (critical — would compete with project-level Tasks), counselor "Assigned To" (accounts have one `owner_id`), AI Insights, nurture sequences, dedup UI.

**Backend (`GET /api/v1/accounts/[id]`)** — extended with 3 fields via parallel `Promise.all`:
- `owner_email`: `db.raw().auth.admin.getUserById(account.owner_id)` (cross-tenant `auth.users` lookup; same escape hatch as Contact 360's `account_owner_email`). Skipped when `owner_id` is null.
- `project_status_mix`: `SELECT status FROM projects WHERE account_id = X` reduced in app code to a 6-key object with 0 defaults. Brief allowed the in-app reduce (vs awkward PostgREST GROUP BY) since project counts per account are typically <100.
- `open_leads_count`: PostgREST exact count with `head: true` filtered to `converted_at IS NULL AND deleted_at IS NULL`. Cheap — no row payload.

Auxiliary fetches use `try { ... } catch { return default }` so the page never blanks on a sub-query error — main account fetch still 500s correctly. Trade-off: silent error swallowing on the 3 auxiliary fields; acceptable for v1 since page renders without them.

**Frontend — 10 new subcomponents under `src/industries/it-agency/features/accounts/components/account-detail/`**:
- `AccountSummaryCard` — Building2 avatar + name + Active/Inactive pill + primary-picker popover (admin) / Link (viewer) + owner email pill + 4 quick actions: + Project (admin), + Contact (admin), Email Primary (`mailto:`, disabled when no email), ⋯ More (Edit / Toggle Active/Inactive / Delete admin-gated). Primary-picker logic extracted verbatim from the old account-detail.tsx into this component.
- `AccountKeyInfoSection` — collapsible (defaults open, mirrors sidebar group pattern); 7 rows: Owner email, Primary Contact link, **# Active Projects** (jump-to-tab button, sums planning+active+in_review), **# Contacts** (jump-to-tab button), # Open Leads, Created, Last Updated.
- `AccountTabs` — 5 triggers (Overview/Projects/Contacts wired; Activity/Billing disabled with Radix `<Tooltip>` "Coming soon" wrapping `<span>` for the disabled-element workaround). `activeTab` lifted to page state so KEY INFO jump-to-tab works.
- `OverviewTab` — 4 cards: Projects status-dot summary (using STATUS_COLOR), Recent Contacts (max 5 with ContactStatusBadge), Recent Leads (max 5, conditional render when present), Notes blob with edit pencil that opens AccountForm.
- `ProjectsTab` — full project list + 6 status filter pills + "+ New project" button. Pills use `PROJECT_STATUS_MAP[value].label` so labels match the `ProjectStatusBadge` rows.
- `ContactsTab` — full contact list with initials avatars + email mailto + ContactStatusBadge + "+ Add contact" button.
- `AccountRelatedPanel` — orchestrator for right column.
- `HealthSnapshotCard` — "HEALTH" uppercase header; Active/Inactive pill + Projects count + colored status-dot row (one dot per project, native `title` attribute for status name on hover) + Open leads count.
- `OpenLeadsCard` — renders null when `open_leads_count === 0`; capped at first 5 with "See all (N)" link to `/leads?account_id=X`.
- `index.ts` — barrel export.

**Cross-cutting refactor** (in the same squash): `PROJECT_STATUS_MAP` exported from `src/industries/it-agency/features/time-tracking/components/status-badge.tsx` as the single source of truth for project-status labels. Was previously a private const; now imported in 3 places (health-snapshot-card, overview-tab, projects-tab) for tooltip + pill labels.

**Page-padding fix applied**: wrapper drops the old `p-6 space-y-6 max-w-4xl`, now uses just `space-y-4`. Shell already provides `p-4`. Same fix as `/projects` workspace (`f9af70d`) and Contact 360.

### Fixback caught at review

The first push (`00d3e39`) had Sonnet introducing friendly labels — "Discovery"/"In Progress"/"Review"/etc. — in 3 new files. But the existing `ProjectStatusBadge` (used on the same page rows + everywhere else in the app) renders "Planning"/"Active"/"In Review"/etc. Real visual mismatch within a single page: a status dot tooltip would say "Discovery", click a "Discovery" filter pill, and resulting rows show "Planning" badges.

Fixback `de2f955`: exported `PROJECT_STATUS_MAP` from `status-badge.tsx` (single source of truth) + the 3 new files now import and use `PROJECT_STATUS_MAP[status].label`. Bundled in: dropped a dead `ALL_STATUSES` runtime const in the backend route (only used as a type — flagged a new ESLint warning, count was 18, back to 17 baseline after) and dropped a dead `--dropdown-hover-overlay` CSS custom property on DropdownMenuContent.

Lesson for the brief catalog: when a brief asks Sonnet to use design tokens or status labels, be explicit about the source-of-truth file to import from. "Use the design tokens" is too open-ended — Sonnet may reinvent rather than import.

### Out of scope (deferred to v2)

- **`billable_hrs_this_month` + `lifetime_billable_amount` in KEY INFO** — needs time-entries summary patterns warm. Defer to a "Billable totals on Account page" v2 brief. Reuse `/api/v1/time-entries/summary?dimension=account`.
- **`Account Team card`** in right column — needs multi-table join (projects → project_contacts → contacts + tasks.assignee_id → users with emails via raw()). No half-built aggregation exists.
- **`Activity tab` content** — no `account_activities` table; could derive from `events`.
- **`Billing tab` content** — invoices + retainer + breakdown by project/month.
- **`last_activity_at` computed field** — cheap query but bundled into the billable-totals brief for consistency.
- **At-risk health score** · **Project-status mix pie chart** (recharts) · **MRR/retainer model** (needs contract table).

### Verification

- ✓ `npm run build` clean locally.
- ✓ `npx eslint --max-warnings 50 .` clean locally (17 warnings — back to baseline after fixback dropped the unused-const warning).
- ✓ All 7 code-review checklist items considered:
  - PostgREST embed FK disambiguation: RELEVANT — `open_leads_count` uses flat count query against `leads`, sidesteps embed FK issue.
  - PATCH preserves POST invariants: N/A — no PATCH/POST changes.
  - New page components need a route shell: N/A — `/accounts/[id]/page.tsx` pre-existed.
  - `.select()` after insert/update: N/A — no inserts/updates added.
  - Radix Select empty-string sentinel: N/A — new pickers reuse existing Popover patterns.
  - Cross-cutting predicate audits: N/A — no new soft state.
  - Page-padding stacks with shell: RELEVANT — FIXED. Wrapper drops `p-6` + `max-w-4xl`, uses `space-y-4`.

### Files Changed

`src/app/(main)/api/v1/accounts/[id]/route.ts` (+44/-3) · `src/industries/it-agency/features/accounts/pages/account-detail.tsx` (rewrite, 305 LOC vs 471 prior) · 10 new account-detail subcomponents (+938 total) · `src/industries/it-agency/features/time-tracking/components/status-badge.tsx` (+1/-1 export of PROJECT_STATUS_MAP). Brief archived at `docs/archive/features/ACCOUNT-DETAIL-360-BRIEF.md`.

---

## Sidebar nav grouping shipped to stage — Project Management group + Pipeline reposition (2026-05-29 PM)

### What was built

Squash-merged at `b6219b2` from `feat/sidebar-nav-grouping` (Sonnet branch `8dd5d3d`). 4 files, +186 / -53. UI + types only — no DB, no API, no migrations.

**Workflow note**: this brief was drafted and Sonnet ran in parallel before Sadin asked me for an end-of-session resume. By the time I checked branch state, Sonnet had already committed + pushed. The branch was reviewed normally (diff against brief, build + ESLint gates) and squash-merged.

**Schema additions (`src/industries/_types.ts`)**:

- `SidebarPosition` discriminated string union: `"before-pipeline" | "after-pipeline"`.
- `SidebarGroup` type: `kind: "group"` + `id` (stable identifier for React keys + future localStorage persistence) + `label` + `icon` (string, resolved via INDUSTRY_ICONS) + `children: readonly SidebarItem[]` + optional `position`.
- `SidebarEntry = SidebarItem | SidebarGroup` discriminated union, replacing the flat `SidebarItem[]` typing on `IndustryManifest.sidebar`.
- Optional `kind?: "item"` + `position?` added to `SidebarItem` — back-compat: existing manifests with no `kind`/`position` default to flat item + before-pipeline slot.

**Loader update (`src/industries/_loader.ts`)**:

- `getIndustrySidebarItems` now returns `readonly SidebarEntry[]`.
- Filters recursively via `flatMap` — children filtered by `minRoles` + `featureId` registration; **empty groups dropped entirely** when all children get filtered out (e.g. a counselor who can't see Approvals would still see the group because Projects + Time Tracking remain).
- `position` passes through unchanged (consumed by the shell renderer, not the loader).

**Manifest update (`src/industries/it-agency/manifest.ts`)**:

- 3 delivery entries (Projects, Time Tracking, Approvals) now nest under a `SidebarGroup` with `kind: "group"`, `position: "after-pipeline"`, `id: "project-management"`, `icon: "FolderKanban"`.
- Contacts and Accounts stay as flat top-level items (no `position` → default before-pipeline → render in their current slot above Pipeline).

**Shell renderer (`src/components/dashboard/shell.tsx`)**:

- New `SidebarGroupRender` component (inline, ~60 LOC, not extracted to a separate file). Mirrors the existing Public Forms collapsible pattern (lines 204-235): chevron + indent + left border. Adds `aria-expanded` on the toggle button (small a11y improvement vs Public Forms).
- Active-state: parent group highlights (`bg-#ebebeb`) when any child's pathname matches; active child has `bg-#ebebeb` + `font-medium`.
- Default expansion: `useState(true)`. Auto-re-expand via `useEffect` on `hasActiveChild` change (covers the case where user manually collapses and then navigates to a child via URL).
- No localStorage persistence in v1 — manually collapsing resets on reload.
- Render restructured into **5 regions**: UNIVERSAL_NAV_TOP → industry entries with position=before-pipeline → UNIVERSAL_NAV_MIDDLE (Pipeline) → industry entries with position=after-pipeline → UNIVERSAL_NAV_BOTTOM. The two helper functions `renderNavItem` (universal items) and `renderIndustryEntry` (branches on `kind`) keep the JSX readable.
- `FolderKanban` added to `INDUSTRY_ICONS` registry.
- Mobile Sheet sidebar inherits automatically (same `sidebarContent` block).

### Final visible order for IT-agency

Dashboard → All Leads → Contacts → Accounts → **Pipeline** → **Project Management group (Projects · Time Tracking · Approvals)** → Team → Settings → View Public Form.

Pipeline moved up from below the 3 delivery items to between Accounts and the new group. Achieved purely via the `position: "after-pipeline"` on the group — Pipeline itself wasn't moved out of `UNIVERSAL_NAV_MIDDLE`.

### Out of scope (deferred)

- localStorage persistence of user-toggled collapse state. v1 ships with no persistence — manually collapsing resets on reload. Add in v2 if it annoys.
- Nested groups > 1 level deep. The discriminated union shape-wise allows it but the renderer doesn't support it.
- CRM grouping (Contacts + Accounts under a "CRM" parent). Not asked for; not done.
- aria-expanded retrofit on the existing Public Forms toggle. Worth doing in a separate small a11y pass; not in this brief.

### Verification

- ✓ `npm run build` clean locally.
- ✓ `npx eslint --max-warnings 50 .` clean locally (0 errors / 17 warnings — same count as before).
- ✓ All 7 code-review checklist items N/A — UI + types only, no DB / no API / no new page / no Radix Select / no embed / no mutations / no page-padding change.

### Files Changed

`src/industries/_types.ts` (+25 / -3) · `src/industries/_loader.ts` (+13 / -3) · `src/industries/it-agency/manifest.ts` (+28 / -19) · `src/components/dashboard/shell.tsx` (+120 / -28). Brief archived at `docs/archive/features/SIDEBAR-NAV-GROUPING-BRIEF.md`.

---

## `/contacts/[id]` 360° detail page shipped to stage — Lead-detail-v2 parity, CRM-expert reviewed (2026-05-29)

### What was built

Squash-merged at `4890488` from `feat/contact-detail-360` (Sonnet branch `5b40767`). 11 files (1 rewrite + 9 new + 1 API extend), +1,049 / -269. UI restructure + 2 small backend additions; no DB migrations.

**Context**: prior to this brief, `/contacts/[id]` was a single-column form view (Contact Info card + Projects card + optional Notes blob). Functional but reading as a form, not a stakeholder 360°. The user wanted parity with `/leads/[id]`'s 3-column Lead-detail-v2 page.

**Pre-flight CRM-expert consultation** (via the `crm-expert` skill): industry-best-practice review surfaced several things to NOT copy from the Lead page even though we're mirroring its shape:

- No Stage / Convert / Score / AI Insights — Lead-specific concepts that don't translate to a post-conversion stakeholder.
- No Lead-style Checklist on the right column — would create a parallel tasking system competing with project tasks. Defer to v2 only if explicitly requested as "Reminders".
- Right-column ordering: account-first (the umbrella), then projects under it, then related contacts, then lead provenance. (Sadin had proposed "projects + account + real work types"; the expert flipped it.)
- Add lead provenance ("Converted from lead X") — closes a context loop the contact page was missing.
- Add account-siblings card — common day-to-day question is "who else at this org should I cc?".

**Backend (`GET /api/v1/contacts/[id]`)** — extended response with 3 new fields via parallel `Promise.all` queries:

- `source_lead`: `SELECT id, first_name, last_name, created_at FROM leads WHERE converted_contact_id = id AND deleted_at IS NULL LIMIT 1`.
- `account_siblings`: `SELECT id, first_name, last_name, title FROM contacts WHERE account_id = X AND id != self AND deleted_at IS NULL ORDER BY first_name LIMIT 11`. The LIMIT 11 is a Sonnet judgment — detects ">10" cheaply for the "See all" link without a separate `count()` round-trip.
- `account_owner_email`: resolved via `scopedClient.raw().auth.admin.getUserById(owner_id)`. `raw()` is the documented escape hatch from CLAUDE.md for cross-tenant operations like `auth.users` reads (owner_id lives outside tenant-scoped tables).

Also extended the `accounts!contacts_account_id_fkey` embed to include `owner_id` + `primary_contact_id` for the AccountCard and the isPrimary derivation.

**Frontend — 9 new subcomponents under `src/industries/it-agency/features/crm-contacts/components/contact-detail/`**:

- `ContactSummaryCard` (~200 LOC): avatar with initials + name + status badge + email/phone with copy buttons + 5-button action row (Note · Email · Call · Add to Project · More). More dropdown contains Set as Primary Contact (hidden via `!isPrimary` guard), Edit, Delete.
- `ContactKeyInfoSection` (~100 LOC): collapsible "KEY INFORMATION" with Status / Title / Account link / Account Owner / Created / Last Updated. All display-only in v1; editing flows through `ContactForm`.
- `ContactTabs` (~140 LOC): tabs orchestrator. Overview tab wired with Personal Information + Professional Details cards (Pro Details has Edit icon → opens ContactForm). Notes and Activity tabs are `disabled` with `<TooltipContent>Coming soon</TooltipContent>` — no fake content panels.
- `ContactRelatedPanel` (~85 LOC): right-column orchestrator. Renders AccountCard → LinkedProjectsCard → RelatedContactsCard → LeadProvenanceCard.
- `AccountCard` (~50 LOC): account name (link) + owner email + two badges (`{N} projects` + `{N} other contacts`).
- `LinkedProjectsCard` (~165 LOC): relocated from the old page's middle column. Same project-link logic (role pills, change-role dropdown, remove action, Add-to-project button) — just visually re-skinned.
- `RelatedContactsCard` (~80 LOC): up to 10 sibling contacts with avatar + name link + title. Paired with the backend's LIMIT 11: when `siblings.length > 10`, render "See all at {account name} →" link. Empty state: "No other contacts at this account yet."
- `LeadProvenanceCard` (~50 LOC): `if (!sourceLead) return null;` then renders compact card with link to originating lead + creation date. No empty-state card when contact wasn't converted.
- `index.ts` (~10 LOC): barrel.

**Page rewrite (`contact-detail.tsx`, 498 → 367 lines)**: orchestrator pattern — state (contact, loading, dialog flags, project links, etc.) stays here; subcomponents receive props + callbacks. Added `handleSetPrimary` with optimistic update on the account's `primary_contact_id`. `isPrimary` derived inline (`!contact.accounts || contact.accounts.primary_contact_id === contact.id` — the `!contact.accounts` branch treats no-account as "is primary" which correctly hides the action). **Page-padding fix applied preemptively**: dropped the old `<div className="p-6 space-y-6 max-w-3xl">` wrapper for a `<div className="space-y-6">` that lets the dashboard shell's `p-4` (shell.tsx:409) do the inset work. Same pattern as the `/projects` workspace fix from `f9af70d`.

### V2 deferrals (explicit in brief)

- `contact_notes` table + notes timeline composer (today the `notes` blob is edited via ContactForm).
- `contact_activities` audit log (Activity tab is disabled with "Coming soon" hint).
- Last interaction date computed field.
- Log Meeting action with persistence (would need a `meetings` table or a notes-table with type discriminator).
- AI Insights tab (no clear contact-specific signal).
- Reminders / Tasks on contact (CRM-expert flagged as a parallel tasking system; defer unless owner explicitly asks).
- Communications history (HubSpot's killer feature; requires Gmail/calendar integration; v3 territory).

### Verification

- ✓ `npm run build` clean locally.
- ✓ `npx eslint --max-warnings 50 .` clean locally (0 errors / 17 warnings, all pre-existing in unrelated files — no new warnings introduced).
- ✓ All 7 code-review checklist items considered: PostgREST embed FK disambiguation explicit on the new `source_lead` query (uses `contacts_account_id_fkey` correctly); PATCH/POST invariants N/A; route shell pre-exists; no inserts/updates; no Radix Selects added; no cross-cutting predicate; page-padding stacks check addressed via the wrapper rewrite.

### Review notes (non-blocking — not worth a fixback round)

- A few inline `style={{ color: "#0f0f10" }}` instead of the codebase-conventional `text-[#0f0f10]` Tailwind class. Functionally identical.
- Unused `style={{ "--dropdown-hover-overlay": "#0000170b" }}` CSS custom property set on `DropdownMenuContent`. Dead code, harmless (DropdownMenu has its own hover styling).
- The "Note" action button currently opens `ContactForm` without auto-focusing the notes textarea. Brief said "with the notes field focused" as a stretch; Sonnet flagged it as an "acceptable v1 substitute". Could add a `focusField?: "notes"` prop to ContactForm in a follow-up if it bites.

### Files Changed

`src/app/(main)/api/v1/contacts/[id]/route.ts`, `src/industries/it-agency/features/crm-contacts/pages/contact-detail.tsx`, plus 9 new files under `src/industries/it-agency/features/crm-contacts/components/contact-detail/` (account-card, contact-key-info-section, contact-related-panel, contact-summary-card, contact-tabs, index, lead-provenance-card, linked-projects-card, related-contacts-card). Brief archived at `docs/archive/features/CONTACT-DETAIL-360-BRIEF.md`.

---

## Production promotion shipped — /projects pipeline-parity + CI SSH timeout fix (2026-05-28 — late PM)

### What shipped to `lead-crm.zunkireelabs.com`

Non-FF ort merge `f9af70d` of `stage` (HEAD `35359a7`) into `main`. 7 stage commits land on production (3 chore/CI squashes + 4 docs), 11 files, +1400 / -233. Same merge shape as the prior 3 promotions (`c13e594`, `d3cd235`, `f78abcc`) — main had 5 main-only operational commits (4 prior promotion merges + the CI nudge); ort merge clean, zero conflicts.

**Feature bundle:**

- **`/projects` Board chrome — first wave** (`6de03ab`). `FilterDropdown` extended with discriminated-union `multiple` prop (13 single-select call sites unchanged). Project Status chip row collapsed into a multi-select FilterDropdown. `ProjectColumn` restructured with bordered header bar + colored status dot + bordered body + `FolderOpen` empty state. Design-token `isOver` (no blue ring). `STATUS_COLOR` map hardcoded per status.
- **`/projects` Board pipeline-parity — second wave** (`2aa45df`). Toolbar restructured into Pipeline's shape (bordered card with count chip + `h-9` search + active-filters Badge + Clear). LayoutGrid icon dropped from title. Full `ProjectCard` rewrite mirroring `LeadCard` (3-section structure with dividers; Folder icon-square + name Link + 3-dot dropdown; Account/Contacts/Billable/Updated key:value grid; urgency badge + owner avatar footer). Whole-card-clickable via `useRouter`. Columns widened 220→320 with Total/Billable footer. DragOverlay rewired through `<ProjectCard isDragOverlay />`. **Sonnet drive-by fix in the same branch**: dropped `workspace.tsx`'s outer `p-6` which was stacking with shell's own `p-4` to produce 40px-from-edge inset vs `/pipeline`'s 16px.
- **CI: production SSH `command_timeout` bumped to 30m** (`5ce03d2`). Closes the earlier 2026-05-28 PM `f78abcc` 10-minute timeout incident. Matches the value `deploy-staging.yml` has had since setup.

### Verification

- ✓ Pre-flight `git log origin/main..origin/stage` showed exactly 7 expected commits (3 squashes + 4 docs).
- ✓ Pre-flight `git log origin/stage..origin/main` showed 5 expected operational commits (4 prior promotion merges + CI nudge). Non-FF ort merge required; clean.
- ✓ Pre-flight stage deploy state check: both in-flight stage runs (`5ce03d2` CI fix, `35359a7` docs) waited to completion before pushing main, per the new pre-flight discipline.
- ✓ Production deploy `26575044319` completed in ~1m48s. No contention (no concurrent stage deploys); new 30m timeout wasn't tested but is now in place for future incidents.
- ✓ Live smoke: `lead-crm.zunkireelabs.com/login` HTTP 200; `/dashboard` + `/projects` + `/pipeline` + `/contacts` + `/accounts` all HTTP 307 (auth redirects, expected).

### Workflow notes

- **Second production promotion of the day** (`f78abcc` AM/PM design pass first wave, `f9af70d` PM design pass second wave + CI fix). First hit the timeout; this one didn't because we fixed the workflow first per Sadin's "do 4 and then 1" sequencing.
- **The new pre-flight discipline** ("wait for stage deploys to clear before pushing main") was followed for the first time today. Worked cleanly.
- **Two new design briefs archived this promotion**: `PROJECTS-BOARD-CHROME-BRIEF.md` and `PROJECTS-PIPELINE-PARITY-BRIEF.md`. Both at `docs/archive/features/`.

### Files Changed (vs `f78abcc`)

`.github/workflows/deploy.yml` (+1), `docs/SESSION-LOG.md`, `docs/STATUS-BOARD.md`, 2 new files in `docs/archive/features/`, `src/components/ui/filter-dropdown.tsx`, `…/project-card.tsx`, `…/project-column.tsx`, `…/views/board-view.tsx`, `…/workspace-header.tsx`, `…/pages/workspace.tsx`.

---

## CI: bump production SSH `command_timeout` to 30m (2026-05-28 PM)

### What was built

1-line change to `.github/workflows/deploy.yml`: added `command_timeout: 30m` to the production `Deploy via SSH` step. Direct commit on stage as `5ce03d2`.

### Why

The 2026-05-28 PM production promotion (`f78abcc`) timed out at the appleboy/ssh-action's default `command_timeout` of 10m. Root cause: a docs-only stage deploy was running concurrently on the same SSH host; dual `npm ci` + `next build` slowed the prod build to >9m. TypeScript started at 10:59:47 (after ~3.9min of Next.js compile under contention); the SSH session timed out at 11:01:35 — exactly the 10-minute mark.

Diagnosis on review:

- `deploy-staging.yml:54` already had `command_timeout: 30m`. That's why the docs-only stage deploy completed `success` at 15m51s under the same contention — it had 30m of headroom.
- `deploy.yml` had **no `command_timeout` set**, so it inherited the action's default 10m. That was the asymmetry.

### The fix

```yaml
       uses: appleboy/ssh-action@v1
       with:
         host: ${{ secrets.SSH_HOST }}
         username: ${{ secrets.SSH_USERNAME }}
         key: ${{ secrets.SSH_PRIVATE_KEY }}
+        command_timeout: 30m
         script: |
```

One line. Defensive change — only widens the window, never narrows behavior. Recovery via `gh run rerun <id> --failed` still works for unrelated failure modes.

### What this does NOT do

Both workflows still have their own `concurrency:` groups (`deploy-staging` vs `deploy-production`), which means stage and main deploys can still run simultaneously. The dual-deploy contention isn't eliminated — it's just no longer fatal because both timeouts are now wide enough to absorb it.

If we want to fully serialize stage and main against the same host, a second pass could:
- Unify the concurrency group across both files (e.g., `group: deploy-ssh-host`) so stage queues against main and vice versa.
- Trade-off: a stage push during an in-flight prod deploy would wait until prod finishes. Could be 5-15 minutes of explicit queueing.

Not done in this commit — wait-and-see if 30m is enough headroom. If we see another contention timeout, that's the next move.

### Verification

- ✓ `git diff` shows exactly +1 line on `deploy.yml`. No other changes.
- ✓ The change is read from the commit being deployed (GitHub Actions reads workflow files from the ref that triggered the run, not from the default branch), so the **next stage→main promotion will use the new 30m timeout** because the merge commit includes this change.
- ✓ Stage deploy runs normally (its workflow already had 30m; this commit doesn't change its behavior).

### Files Changed

`.github/workflows/deploy.yml` (+1 line).

---

## `/projects` Board pipeline-parity shipped to stage — toolbar + card + column second pass (2026-05-28 PM)

### What was built

Squash-merged at `2aa45df` from `chore/projects-pipeline-parity` (Sonnet branch `fc187d0`). 5 files, +290 / -145. UI-only — no DB, no API, no new pages. All 6 code-review checklist items N/A.

**Context**: After the first chrome brief (`6de03ab`, 3 files), Sadin compared `/projects` Board against `/pipeline` side-by-side and called out 3 remaining gaps — toolbar layout, card structure/density, and column width. This brief closes those with the same Opus-plans / Sonnet-executes workflow.

**Five changes**:

- **`workspace.tsx`**: pass `projectCount` + `onClearFilters` props to `WorkspaceHeader`. Drop the page wrapper's `p-6` entirely (see Sonnet's drive-by fix below).
- **`workspace-header.tsx`**: restructure into Pipeline's toolbar shape — title row (plain "Projects" text, no LayoutGrid icon prefix) + view tabs on the right, then a bordered toolbar card (`bg-card rounded-lg border`) wrapping a top row (count chip "N Projects" + `h-9 w-60` search + spacer) and a filter row (Account / Owner / Status / Show Cancelled + spacer + active-filters Badge + Clear) separated by an internal `h-px bg-border` divider. `hasActiveFilters` + `activeFiltersCount` derived from the same filter fields. Mirrors `PipelineBoard.tsx:552-720` exactly.
- **`project-card.tsx`**: full rewrite mirroring `LeadCard`'s 3-section structure — `rounded-xl border bg-card p-4` chrome (drops the shadcn `<Card>` wrapper); header with Folder icon-square (`h-8 w-8 rounded-lg bg-primary/10`) + name `<Link>` + 3-dot dropdown menu (View Details only, Edit/Log time left as future hooks); `border-t border-border/50 my-3` divider; key:value metadata grid for `Account` / `Contacts` (when >0) / `Billable` (when >0) / `Updated`; divider; footer with urgency badge (Today / Xd, same red 7+/amber 3+/muted thresholds as LeadCard) + owner avatar **moved from the card header to the footer** (LeadCard parity). **Whole-card-clickable** via `useRouter().push()`; inner Link + dropdown buttons `stopPropagation()`. `isDragOverlay` disables listeners + onClick. Drops the inline Building2 + account row (account moves into the metadata grid).
- **`project-column.tsx`**: widen `min-w-[220px] w-[220px]` → `min-w-80 w-80` (320px, matching `PipelineColumn`). Drop the body's `rounded-b-lg` since the footer now caps the bottom. Add Total/Billable column footer mirroring `PipelineColumn.tsx:89-101` chrome (`px-3 py-2 bg-card rounded-b-lg border border-t-0`). `totalBillableHrs` derived inline from `hoursMap`.
- **`board-view.tsx`**: rewire the `<DragOverlay>` content from the inline slim `<Card>` to `<ProjectCard project={draggingProject} teamMap={teamMap} hoursMap={hoursMap} isDragOverlay={true} />` so the floating preview matches the new card design. Wrapper width 220→320. Drop dead imports (`Building2`, `Card`, `CardContent`) — drove ESLint warning count from 18 → 17.

### Sonnet drive-by fix: page-padding stacking with the dashboard shell

After Sadin pasted the brief and Sonnet implemented the 5 files per spec, Sadin smoked the result against `/pipeline` and flagged that `/projects` still felt cramped vs `/pipeline`. Sonnet investigated and found the root cause:

- The dashboard shell at `src/components/dashboard/shell.tsx:409` already provides `p-4 mr-4 mb-4` on the `<main>` container — every dashboard page is rendered inside a 16px-padded container by default.
- `/pipeline` (`src/app/(main)/(dashboard)/pipeline/page.tsx:80`) wraps in `<div className="flex flex-col h-[calc(100vh-90px)]">` — no additional padding. Pipeline relies purely on the shell's `p-4`.
- `/projects` workspace (`src/industries/it-agency/features/project-board/pages/workspace.tsx:77`) previously wrapped in `<div className="flex flex-col gap-4 p-6 h-full">` — adding an extra `p-6` (24px) on top of the shell's `p-4`. Effective inset: 40px from each edge vs Pipeline's 16px.

Sonnet's fix: removed the `p-6` entirely. Final wrapper is `<div className="flex flex-col gap-4 h-full">`, matching Pipeline's pattern of "rely solely on the shell's padding." This is a 1-line change. Verified visually against `/pipeline`. Bundled into the same squash via `git commit --amend` + `git push --force-with-lease` before the Opus review handoff.

**Brief scope note**: the original brief explicitly listed `workspace.tsx` as out-of-scope beyond the prop additions. Sonnet's amendment was technically outside the brief but obviously correct — it's exactly the kind of judgment call the handoff prompt invites. Accepted on review.

### New code-review checklist item: page-padding stacks with the shell

Promoted to the checklist for future styling work:

**When restyling a page, check the page wrapper's padding against the dashboard shell's**. The shell (`src/components/dashboard/shell.tsx:409`) already wraps page content in `p-4 mr-4 mb-4`. Pages that add their own `p-4` / `p-6` / `p-8` on the outer wrapper **stack** that padding on top of the shell's, producing an inset that's 2× or more what was intended. Reference pages that consciously rely on the shell only: `/pipeline` (`page.tsx:80`). Pages that historically added their own padding and now mismatch the shell: `/projects` (fixed in this commit). Same rule applies to top-margin and side-padding on the outermost wrapper — measure twice before adding.

### Verification

- ✓ `npm run build` clean locally.
- ✓ `npx eslint --max-warnings 50 .` clean locally (0 errors / 17 warnings, all pre-existing — and 1 fewer than the prior commit because Sonnet cleaned up dead imports).
- ✓ Stage deploy in progress at the time of this entry. Live smoke pending Sadin's eyeball on `dev-lead-crm.zunkireelabs.com/projects`.
- ✓ All 6 code-review checklist items N/A — UI-only, no DB / no API / no new page / no Radix Select / no embed / no mutations.

### Files Changed

`src/industries/it-agency/features/project-board/components/project-card.tsx` (full rewrite, +170/-95), `…/project-column.tsx` (width + footer, +20/-1), `…/views/board-view.tsx` (DragOverlay rewire + dead-import cleanup, +7/-15), `…/workspace-header.tsx` (toolbar restructure, +148/-70), `…/pages/workspace.tsx` (prop wiring + `p-6` removal, +3/-1). Brief archived at `docs/archive/features/PROJECTS-PIPELINE-PARITY-BRIEF.md`.

---

## `/projects` Board chrome shipped to stage — bordered columns + multi-select Status filter (2026-05-28 PM)

### What was built

Squash-merged at `6de03ab` from `chore/projects-board-chrome` (Sonnet branch `2bdb52f`). 3 files, +157 / -99. UI-only — no DB, no API, no new pages. All 6 code-review checklist items N/A.

**Goal**: bring the IT-agency `/projects` Board view's chrome in line with `/pipeline`'s kanban visual vocabulary. The loudest mismatches were a bright-blue solid-pill row for Project Status filtering, bare kanban column headers (just text + count), and a sparse "No projects" empty state.

**Three changes:**

- **`src/components/ui/filter-dropdown.tsx`** — extended `FilterDropdown` with a discriminated-union `multiple?: boolean` prop. Single-select callers (13 across the repo: `/leads`, `/accounts`, `/contacts`, `/pipeline`, `/projects` Account/Owner/Assignee/Due) compile unchanged because no `multiple` field on their prop sets puts them on the `multiple?: false` branch. Multi-select branch renders square (rounded-sm) checkbox indicators instead of round radios, keeps the dropdown open on toggle, shows count-in-label (`"Status"` → `"Status: Discovery"` → `"Status (3)"`), and adds a Clear button at the bottom of the panel when selections exist. Drive-by fix: `isActive` now also handles the `__all__` sentinel (previously `value !== "all"` only — `__all__` callers were rendering as active at default state).
- **`src/industries/it-agency/features/project-board/components/workspace-header.tsx`** — Row 3 blue status-chip strip removed entirely. `toggleProjectStatus` and `isProjectStatusActive` helpers deleted. New `statusOptions` array derived from `availableChips` (so the Show Cancelled toggle still controls which statuses are options). New `<FilterDropdown multiple label="Status" />` inserted in Row 2 between Owner and Assignee, conditional on `isBoardOrTable`. The cast `next as ProjectStatus[]` is safe — the only option values are valid `ProjectStatus` enum members.
- **`src/industries/it-agency/features/project-board/components/project-column.tsx`** — module-level `STATUS_COLOR: Record<ProjectStatus, string>` map (`planning #3B82F6` blue, `active #F59E0B` amber, `in_review #A855F7` purple, `delivered #10B981` green, `on_hold #9CA3AF` gray, `cancelled #EF4444` red — Tailwind 500-level palette, chosen for legibility at 2.5×2.5 dot size). Column render restructured to mirror `PipelineColumn`: outer flex column → bordered header bar (`bg-card rounded-t-lg border border-b-0 border-gray-200`) with colored dot + `text-[#0f0f10]` name + `bg-gray-100 text-[#787871]` count chip → `h-px bg-gray-200` divider → droppable body (`bg-gray-50/40 rounded-b-lg border border-t-0`) with `isOver` swapped from `ring-2 ring-blue-300 ring-inset` to `border-[#0f0f10] bg-[#0000170b]` → richer empty state with `FolderOpen` icon-in-circle + "No projects" + "Drag projects here to update". Column width unchanged (`min-w-[220px] w-[220px]`) — projects card density is higher than pipeline leads; pipeline's 320px width wasn't needed.

### Out of scope (per brief, deliberately untouched)

- Task status chips on Tasks view — same blue treatment, follow-up brief later if wanted.
- Priority chips on Tasks + Members views — colored variants are intentional hierarchy.
- Project card content (name, account avatar, contact count, billable hours, "Updated Xd ago") — pure chrome work.
- Column footer totals — `/pipeline` has them; for `/projects` Sadin called skip (projects fewer per column, per-card billable already surfaces what matters).
- Column width — kept at 220px not widened to 320px.
- "Show cancelled" checkbox — no Pipeline equivalent.
- View tabs (Board/Table/Tasks/Members) — already on token.

### Verification

- ✓ `npm run build` clean locally before squash-merge.
- ✓ `npx eslint --max-warnings 50 .` clean locally — 0 errors, 18 warnings (all pre-existing in unrelated files).
- ✓ All 6 code-review checklist items N/A — UI-only, no DB / no API / no new page / no Radix Select / no embed / no mutations.
- Stage deploy in progress at the time of this entry. Live smoke pending Sadin's eyeball on `dev-lead-crm.zunkireelabs.com/projects` once the deploy lands.

### Eyeball items to confirm post-deploy

- The `bg-gray-50/40` column body may read nearly identical to the `#fafafa` page chrome. If the columns don't feel distinct enough, the one-line bump is `bg-gray-100/60`. Brief flagged this; Sonnet kept the brief's spec.
- Status FilterDropdown trigger label cycles `"Status"` → `"Status: Discovery"` (1) → `"Status (3)"` (3). Loses at-a-glance multi-state vs the old chip row; mitigated by the row of visible kanban columns still showing exactly what's filtered.
- The 6 hardcoded status colors are picks, not derived from any existing palette. Trivially editable in `project-column.tsx` if Sadin wants different hues.

### Files Changed

`src/components/ui/filter-dropdown.tsx`, `src/industries/it-agency/features/project-board/components/project-column.tsx`, `src/industries/it-agency/features/project-board/components/workspace-header.tsx`. Brief archived at `docs/archive/features/PROJECTS-BOARD-CHROME-BRIEF.md`.

---

## Production promotion shipped — IT agency design pass first wave + Time Approvals nav + SSH-timeout incident (2026-05-28 PM)

### What shipped to `lead-crm.zunkireelabs.com`

Non-FF ort merge `f78abcc` of `stage` (HEAD `a9c681f`) into `main`. 10 stage commits land on production, 22 files changed, ~2,746 insertions / ~284 deletions (most of the line-count is the 6 archived briefs landing on main's `docs/archive/features/`). Same merge shape as the prior 2 promotions (`c13e594`, `d3cd235`) — `main` had 4 commits stage didn't (2 prior promotion merges + Anish's older merge + a CI nudge); ort merge clean with zero conflicts.

**Feature bundle:**

- **Time Approvals nav link + role-gated sidebar items** (`683e85e`). `/time-tracking/approvals` sidebar entry under Time Tracking, gated to owner/admin via the new optional `minRoles` field on `SidebarItem` (filtered in `getIndustrySidebarItems(industryId, role?)`).
- **IT agency design pass first wave** (6 squash commits, all UI-only). `/contacts` chrome aligned to `/leads` (`285b2a8`); avatars + Sort popover + client-side pagination (`0d47bf3`); primary button → near-black + 8px corners + table text bump (`f3ad73d`); table text hierarchy — names `#0f0f10`, secondary `#787871` warm-muted (`8791e66`); FilterDropdown + PipelineSelector retoned, blue accents removed (`aec9cf5`); `/accounts` Card-stack rewritten as a table (`56f6299`). Color tokens established for future briefs — see the design-pass entry below.

### The SSH-timeout incident

First push to `main` (`f78abcc`) triggered Deploy to Production run `26570173859`. The Deploy step uses an SSH action with a default `command_timeout: 10m`. A docs-only `Deploy to Staging` run (`26570080248`) was concurrently running on the same host (started ~2 min earlier). Both jobs ran `npm ci` (which took 194s on prod vs the usual ~60s) followed by `next build` (`✓ Compiled successfully in 3.9min` — also longer than normal). TypeScript began at 10:59:47 and the SSH command timed out 1m48s later at 11:01:35 — exactly the 10-minute mark. Exit 1, deploy failed before flipping the container, so prod stayed at `d3cd235` and served 200s the whole time.

**Recovery sequence:**

1. Inspected job logs → identified `Run Command Timeout` at the 9m31s mark.
2. Confirmed root cause (dual-deploy contention on the same host) by cross-referencing the still-running stage run.
3. Asked Sadin between 3 options (cancel stage / wait for stage / investigate timeout config); he chose wait-for-stage.
4. Stage deploy completed `success` at 11:03:07 — 15m51s total wall time, slow for the same contention reason.
5. `gh run rerun 26570173859 --failed` re-ran only the failed Deploy job (Pre-deploy Checks stayed at its 10:51:10 success).
6. Re-run completed `success` at 11:06:34 — normal time once stage wasn't competing.

**Lesson** (now also in the resume block): before promoting stage→main, wait for the most recent stage deploy to be `completed`. Permanent fix (bump SSH `command_timeout` or add workflow `concurrency:` group) is a separate workflow-tweak branch.

### Verification

- ✓ Pre-flight `git log origin/main..origin/stage` showed exactly the 10 expected commits.
- ✓ Pre-flight `git log origin/stage..origin/main` showed 4 expected operational commits (prior promotion `d3cd235`, prior promotion `c13e594`, Anish merge `e10b97d`, CI nudge `02fe74e`) — non-FF ort merge required; clean.
- ✓ Production Deploy re-run succeeded in normal time.
- ✓ Live smoke: `lead-crm.zunkireelabs.com/login` HTTP 200; `/dashboard` + `/contacts` + `/accounts` + `/leads` + `/time-tracking/approvals` all HTTP 307 (auth redirect, expected).

### Files Changed (vs `d3cd235`)

`docs/FEATURE-CATALOG.md`, `docs/SESSION-LOG.md`, `docs/STATUS-BOARD.md`, 7 new files in `docs/archive/features/` (the 6 design briefs + NAV-APPROVALS-BRIEF.md from the earlier ship), `(main)/(dashboard)/layout.tsx`, `globals.css`, `leads-table.tsx`, `shell.tsx`, `PipelineSelector.tsx`, `button.tsx`, `filter-dropdown.tsx`, `_loader.ts`, `_types.ts`, `accounts-list.tsx`, `contacts-list.tsx`, `it-agency/manifest.ts`.

---

## IT agency design pass — first wave shipped to stage: /contacts + /accounts + design tokens (2026-05-28)

### What shipped

Six squash commits on top of `683e85e` (the Time Approvals nav fix), all UI-only, all IT-agency focused. Sadin pivoted into a dashboard-by-dashboard styling/UX pass: Opus audits → writes a per-page brief → Sonnet implements on a feature branch → Sadin pastes the handoff prompt himself → Opus fetches, reviews diff, runs `npm run build` + `npx eslint --max-warnings 50 .` locally → squash-merges to stage → deletes the feature branch → writes the next brief.

**`285b2a8` — `/contacts` chrome aligned to `/leads` pattern.** Toolbar card with count + search + Add, divider, FilterDropdown chips, active-filter badge + Clear, table card with `bg-gray-50` thead + `divide-y` body + hover rows. File: `contacts-list.tsx`.

**`0d47bf3` — `/contacts` polish.** Avatar initials column, Sort popover (Name / Email / Title / Created × A→Z / Z→A), client-side pagination (10/25/50/100). `safePage = Math.min(currentPage, totalPages)` derivation pattern — React 19's `react-hooks/set-state-in-effect` rule blocks the leads-style `useEffect` recovery, so derive instead of repair. File: `contacts-list.tsx`.

**`f3ad73d` — primary button → near-black + 8px corners + table text bump.** `--primary` CSS var swapped from `#2272B4` (Zunkireelabs blue) to `#171717`. `button.tsx` default variant switched from hardcoded hex to tokens (`bg-primary text-primary-foreground hover:bg-primary/90`). All button sizes: `rounded` → `rounded-lg`. Table data cells in `/leads` + `/contacts`: `text-gray-500 font-light` → `text-gray-700 font-normal`. Dropped unused `--primary-hover` CSS var. Files: `globals.css`, `button.tsx`, `leads-table.tsx`, `contacts-list.tsx`.

**`8791e66` — table text hierarchy refinement.** Name links in `/leads` + `/contacts`: `text-[#2272B4]` (blue) → `text-[#0f0f10]` (near-black). Secondary data cells: `text-gray-700` (cool dark) → `text-[#787871]` (warm-muted). Files: `leads-table.tsx`, `contacts-list.tsx`.

**`aec9cf5` — FilterDropdown + PipelineSelector retoned, blue accents removed.** Hover bg: `bg-gray-50` → `bg-[#0000170b]` (~4% black-with-alpha overlay, Anthropic-style). Selected text drops the blue color treatment (now same `#0f0f10` as unselected). Selected row drops `bg-blue-50` entirely — selection signaled only by the filled radio-circle + check icon (now `#0f0f10`). Search input focus ring: blue → `ring-gray-300`. Pipeline "Default" badge retoned to neutral `bg-gray-100 text-gray-700`. Files: `filter-dropdown.tsx`, `PipelineSelector.tsx`.

**`56f6299` — `/accounts` list rewrite as a table mirroring leads + contacts.** Dropped the Card-stack layout entirely. New columns: avatar initials · Name (`#0f0f10` link) · Contact Email · Projects · Status pill (Active green / Inactive gray) · Actions (Edit + Delete, admin-only). Toolbar with count + search + Sort + New Account; Status FilterDropdown (Active default / Inactive / All); pagination footer. `getInitials` helper handles single-name accounts. File: `accounts-list.tsx`.

### Color tokens established this session

Bake these into any future briefs:

- **Primary action**: `--primary` CSS var, currently `#171717` near-black. Buttons use `bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg`.
- **Primary text** (names, labels): `#0f0f10` (near-black, slightly darker than `--foreground` at `#171717`).
- **Secondary text** (data cells, descriptions): `#787871` (warm-muted gray).
- **Em-dash placeholders**: `text-gray-400`.
- **Hover overlay** (dropdowns only for now): `#0000170b` (~4% black-with-alpha).
- **Table row hover** (still): `bg-gray-50`. Intentional inconsistency vs the dropdown overlay — flagged for a potential future unify branch, not yet decided.
- **Border radius on buttons**: `rounded-lg` (8px) across all sizes.
- **Status pills** (Active / Inactive): `bg-green-50 text-green-700 border-green-200` / `bg-gray-100 text-gray-500 border-gray-200` (matches ContactStatusBadge).
- **Name link** (table cells): `text-sm font-medium text-[#0f0f10] hover:underline`.
- **Data cell** (table cells): `text-sm font-normal text-[#787871]`.

### Verification

- ✓ `npm run build` clean locally on each commit before merge.
- ✓ `npx eslint --max-warnings 50 .` clean locally on each commit before merge (the CI hard gate that ESLint-stripped local builds don't run).
- ✓ Stage deploys green throughout — most recent deploy was the `/accounts` rewrite (`56f6299`).
- ✓ All 6 code-review checklist items N/A across all 6 commits — UI-only, no DB / no API / no new page / no Select / no embed / no mutations. No new items.

### Out of scope (deferred to separate branches)

- `--ring`, `--sidebar-primary`, `--chart-1`, `--sidebar-ring` CSS vars still reference `#2272B4` (separate consolidation branch).
- `button.tsx` link variant keeps `text-[#2272B4]` blue intentionally (link convention; only buttons turned black).
- `tenant.primary_color` fallback in `shell.tsx:342` still `#2272B4` (separate branch).
- `.dark` color block in `globals.css` unchanged (dark mode not deployed).
- `account-detail.tsx`, `contacts-detail.tsx` — follow-up branches if Sadin wants them styled.
- Bulk select / Export / Preview panel — feature work, deferred.

### Eyeball items flagged for Sadin's smoke

None blocking; all post-merge polish judgment:

- Selected row in dropdowns has zero background at rest now — only the radio-circle + check signals selection. Pipeline selector with multiple pipelines is the test surface for "is this hard to spot?"
- Pipeline "Default" badge is now neutral gray — if admins scanning long pipeline lists can't identify the default at a glance, follow-up could give it soft amber (`bg-amber-50 text-amber-700`) or purple.
- Table-row hover (`bg-gray-50`) vs dropdown-option hover (`#0000170b`) is intentionally different right now. Could unify in a follow-up.
- Status filter chip on `/contacts` + `/accounts` always renders "engaged" since the default value `"active"` ≠ `"all"` — FilterDropdown's `isActive` logic counts anything-other-than-`"all"` as active. Not a bug; visual quirk.

### Files Changed

- `285b2a8`: `contacts-list.tsx`
- `0d47bf3`: `contacts-list.tsx`
- `f3ad73d`: `globals.css`, `button.tsx`, `leads-table.tsx`, `contacts-list.tsx`
- `8791e66`: `leads-table.tsx`, `contacts-list.tsx`
- `aec9cf5`: `filter-dropdown.tsx`, `PipelineSelector.tsx`
- `56f6299`: `accounts-list.tsx`

Six briefs from this session archived alongside this entry: `CONTACTS-LIST-CHROME-BRIEF.md`, `CONTACTS-LIST-POLISH-BRIEF.md`, `DESIGN-PRIMARY-BUTTON-BRIEF.md`, `DESIGN-TEXT-HIERARCHY-BRIEF.md`, `DESIGN-DROPDOWN-RETONE-BRIEF.md`, `ACCOUNTS-LIST-REWRITE-BRIEF.md`.

---

## Time Approvals nav link shipped to stage + role-gated sidebar items (2026-05-28)

### What was built

Squash-merged at `683e85e` from `feature/nav-approvals-link` (Sonnet branch `02ef73e`). 5 files, 28 / 3.

**Audit finding before the work**: `/time-tracking/approvals` was a built, prod-deployed admin page with **no sidebar nav entry** — only reachable from a stats card inside `/time-tracking` (`timesheet-stats-cards.tsx:44`). Same audit confirmed it was the ONLY meaningful orphan in the IT agency sidebar — everything else (`/accounts/[id]`, `/contacts/[id]`, `/time-tracking/projects/[id]`, etc.) is a detail subpage that correctly doesn't get its own nav entry; `/forms` and `/check-in` are correctly industry-gated to education_consultancy.

**Fix**:

- `src/industries/_types.ts`: added optional `minRoles?: readonly ("owner" | "admin" | "viewer" | "counselor")[]` to `SidebarItem`. Named `minRoles` (plural) explicit-list-not-ordered because the role hierarchy isn't strictly linear in this codebase.
- `src/industries/_loader.ts`: `getIndustrySidebarItems(industryId, role?)` now filters sidebar items by role when `minRoles` is present. Role param is optional → existing callers without role context still work (just see unfiltered nav).
- `src/app/(main)/(dashboard)/layout.tsx`: passes `tenantData.role` through to the loader (1-line change).
- `src/industries/it-agency/manifest.ts`: new sidebar entry for `/time-tracking/approvals`, label `Approvals`, icon `Stamp`, `minRoles: ["owner", "admin"]`. Reuses `FEATURES.TIME_TRACKING` as the feature gate (sub-pages of a feature don't get their own feature ID).
- `src/components/dashboard/shell.tsx`: registered `Stamp` in `INDUSTRY_ICONS`.

**Page-level role gate verification**: `<ApprovalsQueuePage>` at `approvals-queue.tsx:388` already enforces role with a "no permission" UI state. No route-shell `notFound()` guard added — the sidebar hide + component check are sufficient defense in depth.

### Verification

- ✓ `npm run build` clean locally.
- ✓ `npx eslint --max-warnings 50 .` clean locally (0 errors / 18 pre-existing warnings, all unrelated files).
- ✓ Stage deploy `26563050422` succeeded: Pre-deploy Checks (lint + tsc + build) + Deploy to Staging both green. End-to-end 4m40s.
- ✓ Live smoke: `dev-lead-crm.zunkireelabs.com/login` 200, `/time-tracking/approvals` 307 (auth redirect, expected).
- ✓ All 6 code-review checklist items N/A — UI-only change, no DB / no API / no new page / no Select / no embed / no mutations.

### Workflow

This was a single audit→brief→Sonnet-implement→Opus-review→stage-merge cycle. Brief at `docs/NAV-APPROVALS-BRIEF.md` (now archived at `docs/archive/features/`). Workflow split held: Opus audited, briefed, reviewed, merged; Sonnet wrote all code.

### Pivot context

Sadin pivoted from the post-2026-05-28-promotion smoke plan to a **dashboard-by-dashboard styling/UX pass for IT agency** (then education_consultancy after). The nav fix was the prerequisite — without an Approvals link in the sidebar, the upcoming styling pass would have been working off an incomplete IT agency dashboard. Next step is Sadin picking the first dashboard page for the styling pass.

### Files Changed

- Squash `683e85e`: `_types.ts`, `_loader.ts`, `(main)/(dashboard)/layout.tsx`, `it-agency/manifest.ts`, `shell.tsx`.

---

## Production promotion shipped — Project Workspace v1 + chrome restyle + Orca/Ops tabs + EdgeX wordmark (2026-05-28)

### What shipped to `lead-crm.zunkireelabs.com`

Non-FF ort merge `d3cd235` of `stage` (HEAD `c042e22`) into `main`. 19 stage commits, 41 files changed, 4159 insertions / 133 deletions. Same merge shape as the prior production promotion (`c13e594`) — main had three commits stage didn't (the prior promotion merge `c13e594`, Anish's old `e10b97d` merge from 2026-05-21, and the `02fe74e` CI nudge); ort merge resolved with zero conflicts.

**Feature bundle:**

- **Project Workspace v1** — all 5 phases shipped to prod for the first time: Phase 1 (unified `/projects` shell + Board + Table + lifted URL-encoded filters + admin-only gate); Phase 2 (drag-drop with TOCTOU `expected_status` precondition + card metrics + status chips); Phase 3 (Tasks view with cross-project `GET /api/v1/tasks` + inline edits + log-time-from-row); Phase 4 (Members view with non-N+1 aggregation); Phase 5 (keyboard shortcuts `b`/`t`/`k`/`m`/`/`/`Esc`, empty states with Clear-filters CTAs, comprehensive a11y attributes). Migration 024 added `tasks.assignee_id` + `due_date` + `priority` + `tags TEXT[]` + `projects.owner_id` + `accounts.owner_id` + 6 indexes; migration 023 (`project_board_stages`) for the kanban status enum. Both already live in the shared Supabase DB since stage development.
- **Tag picker fixback** — Notion-style `<TagMultiPicker>` backed by `GET /api/v1/tasks/tags` (tenant-wide tag pool). Replaced the original Phase 3 free-text per-task and per-filter tag inputs with one unified picker (search + autofocus + checkable rows + Create-new fallback).
- **ESLint hotfix** — `tag-multi-picker.tsx:39` `setQuery` wrapped in `setTimeout(0)` to satisfy React 19's `react-hooks/set-state-in-effect`. The earlier failure of this lint rule had blocked the stage deploy pipeline for 6 consecutive pushes before being caught during the Phase 5 ship.
- **Dashboard chrome restyle** — three-tone grey chrome retired in favor of a single `#fafafa` chrome + white inset card. `<main>` becomes a true `#ffffff` card with `1px solid #00001d13` border on all 4 sides, `8px` radius all corners, and `mr-4 mb-4` so the rounded corners breathe. Sidebar hover/active retoned from `#fafafa` to `#ebebeb` (the prior chrome bg now repurposed as the highlight).
- **Orca/Ops sidebar mode switcher** — global tab control at the top of the sidebar, modeled after Claude's Chat/Cowork/Code segmented control. `Ops` (default) shows the existing nav unchanged; `Orca` is a placeholder empty state for future AI-native / AI agents / AI orchestration features. Mode persists in `localStorage["dashboard-nav-mode"]`. Switching tabs does not navigate or change URL — only the sidebar nav swaps. Mobile Sheet sidebar inherits the tab control via the shared `sidebarContent` block.
- **EdgeX brand wordmark** — top-left of sidebar swapped from tenant avatar + tenant name (which was duplicated in the top-right header dropdown) to the constant `EdgeX` product brand wordmark. Tenant identity remains in the top-right.

### Verification (Opus pre-flight + post-flight)

- ✓ Pre-flight `git log origin/main..origin/stage` showed 19 stage commits, all expected (no surprise drift).
- ✓ Pre-flight `git log origin/stage..origin/main` showed 3 main-only operational commits (prior promotion, Anish merge, CI nudge) — same situation as the previous prod push. Non-FF ort merge required; resolved clean.
- ✓ Stage deploy `26518315439` (Orca/Ops tabs) succeeded 3m56s before the promotion ran. Stage was green and current.
- ✓ Production deploy `26518685807` succeeded in 3m57s.
- ✓ Live smoke: `lead-crm.zunkireelabs.com/login` HTTP 200; `/projects` HTTP 307 (auth redirect, expected); `/dashboard` HTTP 307 (auth redirect, expected).

### Visual smoke pending (deferred from stage)

The promotion went out without a separate explicit dev smoke pass — Sadin authorized the merge directly. The visual smoke for tag picker + Members view + Phase 5 keyboard shortcuts + chrome restyle + Orca/Ops tabs + EdgeX wordmark is now a single combined pass on production (or dev — same code). No regression evidence; no blocking concern. If any of Sonnet's three flagged grey-in-white surfaces (`/pipeline`, `/projects`, `/leads`) need repainting after smoke, that's a follow-up stage commit.

### Workflow notes

- This was the 2nd stage→main production promotion in 24 hours (`c13e594` on 2026-05-27 AM; `d3cd235` on 2026-05-28). Both used the same non-FF ort merge shape; both went out clean.
- The "Production-affecting actions require Sadin's explicit go-ahead each time" rule held — Sadin's direct "now push to main as well" was the authorization.
- The 4 dangling already-merged branches (`check-in`, `consultancy-update`, `create-form`, `tags`) and the stale `feature/ai-orchestrate-orca` are still on origin. None blocked the promotion. Naming overlap to track: "Orca" is now both the sidebar mode tab AND the name of the 7-week-old unmerged UI shell branch — the unmerged branch's content is unrelated (a pre-industry-modules orchestrator shell); naming collision is incidental.

---

## Project Workspace Phase 5 shipped — polish, keyboard shortcuts, a11y; CI red-streak reconciled (2026-05-27)

### What was built

Squash-merged at `97e490d` from `feature/project-workspace-phase-5` (Sonnet branch `393484f`). 6 files, 263 insertions / 104 deletions. Closes Project Workspace v1.

- **Keyboard shortcuts** (workspace-header.tsx): `b`/`t`/`k`/`m` switch views; `/` focuses search; `Esc` clears query (or blurs an empty search input). Document-level listener with a ref pattern (`onFilterChangeRef`) so the empty-dep-array effect never closes over a stale callback. Modifier-key guard (`ctrlKey || metaKey || altKey`) plus `role="combobox"` detection prevent text-input hijack and Radix Select interference.
- **Empty states**: all 4 views render icon + helpful copy + Clear-filters CTA when the active filter combo returns zero rows. New `handleClearFilters` in `workspace.tsx` resets all 10 filter fields (`account`, `q`, `owner`, `showCancelled`, `statuses`, `assignee`, `taskStatuses`, `priorities`, `tags`, `due`) — single reset point for every view.
- **Accessibility**: `aria-label` on search input, due-date input, Log-time button; `aria-pressed` on every chip toggle (project status / task status / priority); `aria-sort` on all 11 sortable column headers across Table + Tasks; `aria-expanded` + `aria-label` on Members section toggle. The combined surface should clear Lighthouse a11y ≥ 95 (needs visual confirmation).
- **Phase 4 spec-gap fix bundled**: `workspace-header.tsx` conditionals for Assignee + Priority + Due filters extended to `(isTasksView || isMembersView)` — chips finally visible on Members. `members-view.tsx:116` adds `if (filters.assignee !== "__all__" && member.user_id !== filters.assignee) continue;` to the section-narrowing loop (the resume block claimed the body already applied this — true for priority + due, but assignee specifically was missing).

URL hardening was already in place — `use-workspace-filters.ts:131` is the only `router.replace` in the feature and already uses `{ scroll: false }`. New shortcuts route through the same `onFilterChange` callback, so the scroll-jump-free invariant holds across keyboard nav.

### Stage CI red-streak reconciled

**Discovery during Phase 5 ship**: stage deploy had been failing for 6 consecutive pushes since the tag-multi-picker fixback (`ed7ff15`, 2026-05-27 12:16). Pre-deploy Checks (`npx eslint --max-warnings 50`) was hitting a hard error in `tag-multi-picker.tsx:39` — the new React 19 rule `react-hooks/set-state-in-effect` — because `setQuery("")` ran synchronously inside the `[open]` effect's else branch. Local `npm run build` doesn't run ESLint, so this was invisible until the CI step exited 1 and skipped the container deploy. **Container at `dev-lead-crm.zunkireelabs.com` was frozen at Phase 3 (`867a750`) the entire time.** All "shipped to stage" entries since the tag fixback were technically merged to the `stage` branch but never reached the running container.

**Fix**: hotfix branch `fix/tag-multi-picker-eslint` (Sonnet `89a50a7`), squash-merged at `04d7895`. 1 file, 5 / 1. Wrapped `setQuery` in `setTimeout(0)` mirroring the focus pattern in the if-branch (`Why:` comment added). Behavior preserved: query clears on popover close.

**Deploy after unblock**: 4m4s. Container jumped Phase 3 → tag fixback + Phase 4 + Phase 5 + eslint fix + all docs in one go. Smoke: `/login` 200, `/projects` 307 (auth redirect, expected).

### Smoke reset — all three phases need fresh visual confirmation on dev

Because tag fixback + Phase 4 + Phase 5 never actually ran on `dev-lead-crm` until 2026-05-27 13:18, the prior "tag picker fixback confirmed by Sadin" entry is reconciled — whatever was smoked then could not have been the deployed dev container. Likely a local `npm run dev` or a cached browser tab. No regression evidence, but the visual confirmation MUST re-run on the actual staging URL before prod promotion.

Outstanding on the real dev container:
- **Tag fixback**: Tasks view → tag dropdown shows Notion-style picker (search + autofocus + checkable rows + Create-new fallback). Filter chip works.
- **Phase 4**: Members tab renders, expand/collapse holds, Owner filter narrows section list, click-through navigates to project detail. Counts match DB.
- **Phase 5**: keyboard shortcuts work as specified, empty states show Clear-filters CTA, Lighthouse a11y ≥ 95.

### Verification (Opus review)

- ✓ `npm run build` clean on Phase 5 push.
- ✓ `npx eslint --max-warnings 50 .` clean post-hotfix (0 errors / 18 warnings vs the 50 cap).
- ✓ Phase 5 diff added zero new lint errors — only 7 warnings, all stylistic (unused vars, complex dep arrays).
- ✓ Keyboard handler ref pattern verified — `onFilterChangeRef.current` updates every render via a second `useEffect`, so no stale closure across filter changes.
- ✓ `router.replace({ scroll: false })` remains the single URL mutation point; new shortcuts route through `onFilterChange` → same hook.
- ✓ Stage deploy `26513579125` completed in 4m4s; live smoke green.
- ✓ All 6 standing code-review checklist items N/A — no new DB tables, no new API routes, no PostgREST embeds, no new POST/PATCH, no new page components, no new `<SelectItem>`, no new cross-cutting predicate filters.
- ✓ Phase 5-specific brief item: all `router.replace` calls use `{ scroll: false }`.

### Known minor UX wart (not a blocker)

Keyboard shortcuts (`b`/`t`/`k`/`m`) fire while a Radix Dialog is open if focus is outside the dialog's input fields — view changes under the modal. Acceptable for admin-only polish; future tightening could detect Radix's `body[style*="pointer-events: none"]` mode and skip the shortcut.

### Files Changed

- **Phase 5 squash `97e490d`** (6 files): `workspace.tsx`, `workspace-header.tsx`, `views/board-view.tsx`, `views/members-view.tsx`, `views/table-view.tsx`, `views/tasks-view.tsx`.
- **Eslint hotfix squash `04d7895`** (1 file): `components/tag-multi-picker.tsx`.

### Project Workspace v1 — fully shipped to stage

All 5 phases done: Phase 1 unified workspace + Board + Table + URL state (`44409a8`), Phase 2 drag-drop + card metrics + status chips (`dd20d91`), Phase 3 Tasks view + GET /api/v1/tasks + log-time-from-row (`867a750`), Phase 4 Members view (`29345f3`), Phase 5 polish + a11y (`97e490d`), plus tag-picker fixback (`ed7ff15`) + eslint hotfix (`04d7895`). Brief moved to `docs/archive/features/PROJECT-WORKSPACE-BRIEF.md`. **Production promotion blocked on Sadin's visual smoke pass on Phases 4 + 5 + tag fixback.**

---

## Project Workspace Phase 4 shipped — Members view (2026-05-27)

### What was built

Squash-merged at `29345f3` from `feature/project-workspace-phase-4` (Sonnet branch `af4fa73`). 4 files, 325 insertions / 6 deletions.

- **`<MembersView>`** (306 lines) — fourth and final view of the workspace. One section per team member with ≥1 owned project OR ≥1 assigned open task. Aggregation is non-N+1: `team` + `projects` already loaded by `useProjects` (Phase 1+); single `GET /api/v1/tasks?page_size=200` fetch grouped client-side. **Total ≤3 network requests** to render Members view, regardless of member count.
  - **Grouping**: projects by owner_id (cancelled excluded; account + search filters applied); open tasks by assignee_id (account + search + priority + due filters applied; status === 'done' excluded).
  - **Sort**: open-tasks desc → owned-projects desc → email asc (busiest member first).
  - **Section header**: chevron + 8x8 initials avatar (blue) + email + "Projects (N) · Open tasks (M)". Click to expand/collapse.
  - **Default expand state**: expanded if member has ≥1 open task, collapsed otherwise. Initialized once after first load via `useEffect` guarded by `initialized` flag — user toggles persist across filter changes.
  - **Projects sub-section**: name links to `/time-tracking/projects/[id]`, account name, read-only `<StatusPill>`.
  - **Tasks sub-section**: title links to project detail (no per-task URL exists), project name, read-only `<PriorityPill>`, due date with red `font-medium` when overdue. Sorted by `due_date asc nulls-last`.
  - **Per-member empty hint**: members with owned projects but no open tasks show italic "No open tasks." note in the body.
  - **Workspace empty state**: 8x8 Users icon + "No members have owned projects or assigned tasks yet." + hint "Admins assign owners in the Table view."
- **Workspace header extension**: adds "Members" tab (Users icon). Owner filter visible on Board + Table + **Members** (extended to narrow section list to one member). Search placeholder context-aware: "Search projects & tasks…" on Members view.
- **`useWorkspaceFilters`**: one-line change — `WorkspaceView` union adds `"members"`. URL state carries through.
- **`workspace.tsx`**: routes `filters.view === "members"` to `<MembersView>` passing raw `projects` + `accountMap`. Renders Tasks/Members via nested ternary (the existing pattern).

### Brief-spec gap rolled to Phase 5

Brief's Filter specifications table said Members view should expose **Assignee + Priority + Due** filters in the workspace header. Sonnet extended only the Owner filter conditional; the others stayed `isTasksView`-only. **MembersView code already applies those filters** (lines 103-105 of members-view.tsx), so the gap is purely the header rendering — about 5 lines of conditional. Result today: if a user sets `priority=high` on Tasks view then switches to Members, the filter silently applies but the chip controls aren't visible. Phase 5 will surface them.

### Verification (Opus review)

- ✓ `npm run build` clean.
- ✓ Aggregation requests: ≤3 total (team + projects via Phase-1's `useProjects`, tasks 1 fetch). No N+1 across member count.
- ✓ Owner filter narrows the section list (members-view.tsx:115).
- ✓ No inline edits in Members view — `<StatusPill>` is read-only by component design, `<PriorityPill>` uses `readOnly={true}` explicitly.
- ✓ Collapsed/expanded state initialized once and persists across re-renders (members-view.tsx:141-147).
- ✓ Empty-state copy matches brief.
- ✓ All 6 standing code-review checklist items: no new PostgREST embeds, no new POST/PATCH, no new page components, no new `.select()` after mutation, no Radix Select sentinel needed (uses custom buttons + chevrons), no new cross-cutting predicate filter.
- ✓ Phase 4-specific items per brief: aggregation non-N+1 ✓ · Owner filter behavior ✓ · no inline edits ✓.

### Files Changed (squash commit `29345f3`)

- **New** (1): `views/members-view.tsx` (306 lines).
- **Modified** (3): `workspace-header.tsx` (+ Members tab, + Users icon import, Owner filter conditional extended to include Members, search placeholder branching), `pages/workspace.tsx` (route members view), `hooks/use-workspace-filters.ts` (WorkspaceView union).

### Not yet promoted to `main`

Stays on `c13e594`. Phase 5 (polish + a11y + Members filter completion) is the last phase before the prod promotion observation window.

---

## Project Workspace tag-picker fixback shipped — Notion-style multi-select + tenant-wide pool (2026-05-27)

### Why this was needed

Sadin's visual smoke on Phase 3 caught the tag UX gap: per-task and per-filter tag inputs were both naive free-text — type a word, press Enter. Two real problems:

1. **No tenant-wide pool.** Tag "QC" added to one task didn't surface as a suggestion when tagging another. Users would have to remember and re-type.
2. **Filter slot used the same naive shape.** Couldn't pick from existing tags.

Both surfaces wanted the same Notion-style multi-picker behavior.

### What shipped

Squash-merged at `ed7ff15` from `fix/project-workspace-tag-multi-picker` (Sonnet branch `cabb9d7`). 6 files, 315 insertions / 97 deletions.

- **New endpoint `GET /api/v1/tasks/tags`** (42 lines) — `FEATURES.PROJECT_BOARD` gate, `scopedClient(auth)`, fetches all `tasks.tags` arrays then flattens + dedupes + alphabetic-sorts in app code. No new SQL function. Returns `string[]`. No counselor scoping (read-only pool of strings, non-PII).
- **`<TagMultiPicker>`** (206 lines) — shadcn Popover with autofocus search input, scrollable checkable list, `Create "<query>"` row when query is non-empty AND doesn't case-insensitively match an existing tag AND isn't already selected. Trigger button renders chips when value is non-empty, placeholder + Plus icon when empty. Click-X on a chip removes via `stopPropagation` (doesn't open popover). Two sizes: `sm` (task row) + `md` (filter slot). Case-insensitive duplicate guard against current value when creating.
- **`useTaskTags()` hook** (25 lines) — fetches pool on mount, toast.warning on failure (picker still usable with empty pool), exposes `refetchTags` for the on-PATCH-success propagation.

Integration:
- `workspace.tsx`: wires `useTaskTags`; passes `poolTags` to header and `poolTags + refetchTags` to TasksView.
- `workspace-header.tsx`: filter slot now uses `<TagMultiPicker size="md">`. Removed `<input>` + chip-loop + dead `tagInput` state.
- `tasks-view.tsx`: previous `handleTagAdd` + `handleTagRemove` collapsed into one `handleTagsChange` that optimistically updates → PATCHes → reverts on error + toast → calls `refetchTags()` on success so newly-created tags appear immediately in other rows + the filter. TaskRow tags cell uses `<TagMultiPicker size="sm">`. No more inline `<input>` in the row.

Filter semantics: ANY-match (OR) preserved — existing `.overlaps()` in `GET /api/v1/tasks` unchanged.

### Verification (Opus review)

- ✓ `npm run build` clean; `/api/v1/tasks/tags` registered in route table.
- ✓ All 6 standing code-review checklist items: no PostgREST embeds added (route fetches single column array) · PATCH preserves existing tags invariants · no new page components · `.select()` shape match preserved · no Radix `value=""` (uses checkable buttons inside custom popover content) · no new soft-state filter.
- ✓ Auto-refetch on PATCH success — new tags propagate to other rows + filter without page reload.
- ✓ Case-insensitive guards: `Create "qc"` doesn't appear if pool has "QC"; selecting "qc" when "QC" exists treats them as the same tag.
- ✓ Optimistic update revert on PATCH failure (clean state-rollback to prevTags).
- **Visual smoke after merge** is the next ask — quick test that creating a tag on one task surfaces it on another row + in the filter.

### Files Changed (squash commit `ed7ff15`)

- **New** (3): `api/v1/tasks/tags/route.ts`, `components/tag-multi-picker.tsx`, `hooks/use-task-tags.ts`.
- **Modified** (3): `pages/workspace.tsx` (wires hook), `components/workspace-header.tsx` (replaces filter input), `components/views/tasks-view.tsx` (collapses tag handlers + uses picker in TaskRow).

### Not yet promoted to `main`

Stays on `c13e594`. Phase 4 (Members view) + Phase 5 (polish + a11y) still to come.

---

## Project Workspace Phase 3 shipped — Tasks view + log-time-from-row (2026-05-27)

### What was built

Squash-merged at `867a750` from `feature/project-workspace-phase-3` (Sonnet branch `f72d32d`). 11 files, 1213 insertions / 78 deletions.

- **New endpoint `GET /api/v1/tasks`** — cross-project task list. `FEATURES.PROJECT_BOARD` gate (not ACCOUNTS — new route uses the new gate). `scopedClient(auth)` for tenant isolation. Counselor scoping forces `assignee_id = auth.userId` at line 33-35 even if the URL param differs.
  - Query params: `project_id`, `account_id` (resolved via 2-step query: fetch project IDs in account → `.in("project_id", …)`), `assignee_id`, `status` (csv → `.in()`), `priority` (csv → `.in()`), `tags` (csv → `.overlaps()` ANY-match), `due` (keyword via `dueFilterToDateRange`), `q` (substring with `[,().]` sanitization → `.ilike()`), `page`, `page_size` (max 200).
  - PostgREST nested embed: `*, projects(id, name, account_id, accounts(id, name))`. No reverse-FK ambiguity.
  - Order: `due_date asc nullsFirst:false`, `created_at desc`.
  - Pagination via `.range(from, to)` + `apiPaginated` helper.
- **`PATCH /api/v1/tasks/[id]` extended** — new fields: `assignee_id` (nullable UUID with regex), `due_date` (nullable ISO date `YYYY-MM-DD`), `priority` (enum), `tags` (string array). Validation inline (UUID regex + ISO date regex + array check). Uses `"key" in body` (not `!== undefined`) for assignee_id + due_date so explicit `null` clears the column. Gate kept on ACCOUNTS for legacy compatibility (per brief).
- **`lib/due-keywords.ts`** — `dueFilterToDateRange(keyword)` returns `{ from?, to?, isNull? } | null`. overdue → `{ to: yesterday }` + caller adds `.not("due_date", "is", null)`. today → exact day range. this_week → today + 7. none → `{ isNull: true }`. Unknown / empty → null.
- **`<TasksView>`** (469 lines) — shadcn `<Table>` with 8 columns: Title · Project · Status · Assignee · Priority · Due · Tags · Log time. All sortable except Tags + Log time. Default sort: due_date asc; tiebreakers: priority desc, created_at desc. Inline edits via PATCH per row:
  - Status: shadcn `<Select>` with TaskStatus enum.
  - Assignee: `<AssigneePicker>` (violet variant of OwnerPicker).
  - Priority: `<PriorityPill>` (colored pill doubles as dropdown trigger).
  - Due date: HTML `<input type="date">`, red text + border when overdue (`due_date != null && status !== 'done' && due_date < today`).
  - Tags: chip display + inline `<input>` for adding (Enter key submits). PATCH sends full new array.
  - Log time: `<Timer>` icon button revealed on row hover (opacity transition) → opens `<LogTimeDialog>` with `defaultTaskId` + `defaultProjectId` pre-set.
- **`<AssigneePicker>`** — initials avatar button → dropdown with team list + Check on selected + Clear option. Violet tint distinguishes from OwnerPicker (blue). Click-outside close. Reusable shape.
- **`<PriorityPill>`** — `PRIORITY_CONFIG` maps each priority to label + Tailwind classes (low=gray, normal=blue, high=amber, urgent=red). Has `readOnly` mode for pure-display contexts; doubles as dropdown trigger when `onChange` is set.
- **Workspace header extension** — new "Tasks" tab (ListTodo icon) + task-view-specific filters surfaced when view === "tasks": Assignee dropdown, Task Status chip row, Priority chip row, Tags chip input with current-filter chips + X removers, Due keyword dropdown (overdue/today/this_week/none/all). Owner + Show-cancelled hidden when tasks view active. Project status chips hidden too.
- **`useWorkspaceFilters` extension** — fields `view: "board" | "table" | "tasks"`; new state `assignee`, `taskStatuses`, `priorities`, `tags`, `due`. URL params: `assignee=`, `task_status=`, `priority=`, `tags=`, `due=`. Empty arrays serialize as "no param".
- **`<LogTimeDialog>` + `<TimeEntryAddForm>` extension** — both accept optional `defaultTaskId` + `defaultProjectId` props. TimeEntryAddForm pre-selects task only if it's in the loaded list (defensive — avoids stale state). Existing project-detail caller unchanged (verified by diff: only adds optional props, no behavior shift).

### Verification (Opus review)

- ✓ `npm run build` clean; `/api/v1/tasks` registered.
- ✓ All 6 standing checklist items: PostgREST nested embed unambiguous · PATCH preserves invariants ·  no new route shells needed · `.select()` after PATCH returns plain task; TasksView setState merge preserves projects/accounts join via spread order · no Radix `value=""` (custom pickers used) · no new cross-cutting predicate filters.
- ✓ Phase 3-specific items: `scopedClient(auth)` used · counselor scoping at line 33-35 · `FEATURES.PROJECT_BOARD` gate (not ACCOUNTS) · LogTimeDialog extension is prop-only addition (verified via diff).
- ✓ Counselor scoping defense in depth: even though workspace is admin-only via page-shell gate, the API enforces `assignee_id = auth.userId` if the role is counselor.
- ⚠️ **Sonnet's verification was "code inspection" only this phase** (lighter than Phase 1/2 which ran headless smoke matrices). Inline-edits + tag persistence + log-time pre-fill all need a visual dev smoke. Code reads correctly across all paths reviewed.

### Files Changed (squash commit `867a750`)

- **New** (5): `src/app/(main)/api/v1/tasks/route.ts` (117 lines), `lib/due-keywords.ts` (44 lines), `components/assignee-picker.tsx` (105 lines), `components/priority-pill.tsx` (85 lines), `components/views/tasks-view.tsx` (469 lines).
- **Modified** (6): `api/v1/tasks/[id]/route.ts` (PATCH extension), `time-tracking/components/log-time-dialog.tsx` (+ defaultTaskId/defaultProjectId props), `time-tracking/components/time-entry-add-form.tsx` (pre-select after load), `project-board/hooks/use-workspace-filters.ts` (new fields + URL params), `project-board/components/workspace-header.tsx` (Tasks tab + view-specific filters), `project-board/pages/workspace.tsx` (routes view==="tasks" → TasksView).

### Not yet promoted to `main`

Production stays on `c13e594`. Phases 4 + 5 remaining before the prod promotion observation window.

### Outstanding visual smoke gaps (accumulating across Phases 2+3)

Worth a focused session on `dev-lead-crm.zunkireelabs.com/projects` before more phases stack up. Concretely:

1. **Phase 2**: drag a project card between columns; reload; confirm persistence.
2. **Phase 2**: open same project in two tabs, drag in tab 1, drag in tab 2 → 409 toast + auto-refetch.
3. **Phase 2**: click status chips → board narrows correctly; Clear restores.
4. **Phase 3**: switch to Tasks tab; verify rows render with project + assignee + priority + due.
5. **Phase 3**: change status / assignee / priority / due / tags inline → all persist across reload.
6. **Phase 3**: add a tag via chip input (Enter) and remove a tag via X → both persist.
7. **Phase 3**: click "Log time" on a task row → `<LogTimeDialog>` opens with project + task pre-selected → submit → entry appears on `/time-tracking` timesheet.
8. **Phase 3** (creds-blocked but worth eventually): counselor account hits `/api/v1/tasks` → only own tasks.

---

## Project Workspace Phase 2 shipped — drag-drop, card metrics, status chips, TOCTOU (2026-05-27)

### What was built

Squash-merged at `dd20d91` from `feature/project-workspace-phase-2` (Sonnet branch `a967cec`). 10 files, 461 insertions / 93 deletions.

- **TOCTOU on `PATCH /api/v1/projects/[id]`**: accepts optional `expected_status` field. When present, applies `.eq("status", expected_status)` to the UPDATE; mismatch returns `409 INVALID_STATE` with a message echoing both expected and actual current status. Uses `maybeSingle()` when expected_status is present (returns null on precondition mismatch), `single()` otherwise (back-compat). Edge case handled: empty patch object → no-op fetch + return current row. Validation accepts `expected_status` as a ProjectStatus enum value via `isIn`.
- **Drag-and-drop on Board view**: `<DndContext>` wraps columns with `closestCorners` collision detection + `PointerSensor` (activationConstraint distance: 5). `<useDroppable>` on each `<ProjectColumn>` (visual `isOver` ring); `<useDraggable>` on each `<ProjectCard>`. `<DragOverlay>` renders ghost card while dragging.
- **Optimistic update flow** in `<BoardView>`: uses `originalProjectRef` to preserve original status across async drag-end + `optimisticByStatus` map to override the rendered column map during in-flight PATCH. On 409 → revert optimistic + toast + refetch. On other error → revert + toast. On success → merge updated data into parent state + clear optimistic. Same `contact_count` preservation pattern used in `<ProjectRow>` inline edits.
- **Card metrics**:
  - **Contact count**: `GET /api/v1/projects` select extended with `project_contacts!project_contacts_project_id_fkey(count)` (explicit FK disambiguation, checklist item 1). Parsed in `useProjects` from PostgREST embed shape.
  - **Billable hours**: `useProjects` fetches `/api/v1/time-entries/summary?dimension=project` in parallel; keys by project_id; converts `billable_minutes / 60`. One round-trip for all projects on board load.
  - **Conditional rendering**: card metrics row hidden when both contact_count and billable_hrs are zero — keeps the card visually quiet for new projects.
- **Status multi-chip filter** (rolled forward from Phase 1 spec gap): renders 5 base chips (Discovery / In Progress / Review / Delivered / On Hold) + Cancelled chip when show-cancelled toggle is on. "Empty array = all visible" semantic. Show-cancelled handler removes Cancelled from statuses array when hiding cancelled (prevents zombie filter). Explicit "Clear" button when any chip selected. URL serialization: `status=` comma-separated, no param when empty.
- **`visibleColumns` logic** in `<BoardView>`: combines `showCancelled` toggle (adds Cancelled column) with `statuses` filter (narrows to selected chips). When statuses array is empty, all base columns visible. When non-empty, only chip-selected columns rendered.

### Verification (Opus review)

- ✓ `npm run build` clean, no TS errors.
- ✓ Code-review checklist all 6 items: PostgREST FK disambiguation ✓ · PATCH preserves invariants ✓ · route shells N/A · `.select()` shape match: contact_count preserved across PATCH responses ✓ · Radix Select sentinel not needed for custom button chips · cross-cutting predicate N/A.
- ✓ TOCTOU pattern mirrors time-entries approve `.eq("approval_status", "pending")` shape. 409 response: `{ code: "INVALID_STATE", message: "Expected status 'X' but current status is 'Y'" }`.
- ✓ Back-compat: PATCH without expected_status keeps unconditional behavior (verified by code path inspection — `single()` vs `maybeSingle()` branching).
- ✓ Status chip toggle semantics: empty = all visible; clicking first chip narrows to it; Clear restores empty (= all visible).
- ⚠️ **Drag-and-drop NOT visually verified** in Playwright headless. Known limitation: dnd-kit's PointerSensor activationConstraint doesn't fire reliably under CDP pointer events. Sonnet verified PATCH-level TOCTOU via direct API calls; drag-end code path verified by inspection (DndContext + sensors + dragEnd handler all correctly wired). **Real browser will work** — visual smoke recommended after deploy.

### Files Changed (squash commit `dd20d91`)

- **Modified** (10): `api/v1/projects/[id]/route.ts` (TOCTOU + maybeSingle branching), `api/v1/projects/route.ts` (project_contacts embed), `pages/workspace.tsx` (hoursMap + refetch wiring), `hooks/use-projects.ts` (4th parallel fetch + embed parse), `hooks/use-workspace-filters.ts` (+ statuses field), `components/workspace-header.tsx` (+ status chip row), `components/views/board-view.tsx` (DndContext + optimistic state), `components/project-column.tsx` (useDroppable), `components/project-card.tsx` (useDraggable + DragOverlay support + metrics row), `components/project-row.tsx` (preserve contact_count).
- **DB**: no migration (Phase 1 already covered all schema needs).

### Not yet promoted to `main`

Production stays on `c13e594` until all 5 phases of Project Workspace ship + observation window.

### Open visual-smoke for Sadin

1. Visit `dev-lead-crm.zunkireelabs.com/projects` as Zunkireelabs admin.
2. Drag a card between columns (e.g. "BathroomFort Website" from In Progress → Review). Confirm card moves + persists after reload.
3. Open same project in two tabs. Drag in tab 1 → success. Drag same project in tab 2 (now stale) → expect 409 toast "Project was moved by another user — refreshing" + auto-refetch.
4. Click status chips (Discovery / Review / etc.) → confirm Board narrows to selected columns. Click "Clear" → restore all.
5. Verify card metrics: hover/check contact count + billable hrs match what `/time-tracking/projects/<id>` shows.

If anything fails, report back and we send a fixback to Sonnet. Otherwise, on to Phase 3.

---

## Project Workspace Phase 1 shipped — unified /projects with Board + Table views (2026-05-27)

### What was built

Squash-merged at `44409a8` from `feature/project-workspace-phase-1` (Sonnet branch — 2 raw commits squashed into one). 24 files, 947 insertions / 14 deletions.

- **Migration 024 applied**: `tasks.assignee_id + due_date + priority + tags`; `projects.owner_id`; `accounts.owner_id`; 6 supporting indexes (assignee + due + priority + tags GIN + projects.owner + accounts.owner). Migration 023 (stage enum extension) folded in from the parked branch.
- **Workspace shell** at `src/industries/it-agency/features/project-board/pages/workspace.tsx` — Suspense boundary (Next 16 useSearchParams requirement), fetches projects + accounts + team in parallel via `useProjects`, applies filters client-side, dispatches to active view.
- **Lifted filters** (`workspace-header.tsx`): search input, account `FilterDropdown`, owner `FilterDropdown`, show-cancelled checkbox. View toggle as shadcn `<Tabs>` (Board / Table). All state URL-encoded via `useWorkspaceFilters` hook (sentinel `"__all__"` for "all" selections; `router.replace` with `{ scroll: false }`).
- **Board view** (`views/board-view.tsx`): cherry-picked from the parked Phase 1 work. 5 columns visible by default (Discovery / In Progress / Review / Delivered / On Hold), Cancelled added as 6th when checkbox on. Each column sorted by `updated_at` desc. On Hold styled muted (opacity-60).
- **Table view** (`views/table-view.tsx`): shadcn `<Table>` with 5 sortable columns (Project / Account / Owner / Status / Updated). Default sort updated desc. Inline Status dropdown + inline Owner picker on each row via `<ProjectRow>` + `<OwnerPicker>`. Empty state present.
- **`<OwnerPicker>`** (`components/owner-picker.tsx`): initials avatar button → dropdown with member list + Clear option. Reusable shape ready for `<AssigneePicker>` in Phase 3.
- **`<ProjectCard>`** (Board view) now shows owner initials when `owner_id` is set.
- **API extensions**: `PATCH /api/v1/projects/[id]` accepts `owner_id`; `PATCH /api/v1/accounts/[id]` accepts `owner_id`. `PROJECT_STATUSES` arrays updated in both project routes.
- **Permission gates**: page shell at `/projects/page.tsx` does `getCurrentUserTenant() → redirect(/login)` then `getFeatureAccess(industry_id, PROJECT_BOARD) → notFound()` then admin-only check (`role === "owner" || role === "admin" → notFound()`). Non-admin members within it_agency still see a 404; cross-cutting member self-view is a follow-up brief.
- **Type updates**: `TaskPriority` type, `Task.{assignee_id, due_date, priority, tags}`, `Project.owner_id`, `Account.owner_id`, `ProjectStatus` enum reshaped.

### One brief gap rolled forward to Phase 2

The brief's Phase 1 spec called for a **status multi-chip filter** alongside the show-cancelled toggle. Sonnet shipped show-cancelled only; status chip filter was missed. Real but small gap — Board view already shows all statuses as columns (filter is somewhat redundant there), but Table view currently can't be narrowed to a single status without sorting. Decision: bundle into Phase 2's scope since the filter is most useful once drag-drop makes Board dynamic. Logged in STATUS-BOARD for Phase 2 kickoff.

### Workflow note: Sonnet's pre-emptive correctness on the brief divergence

The brief incorrectly told Sonnet to use `authenticateRequest()` in the page shell. Sonnet noticed every existing page shell uses `getCurrentUserTenant()` and used that instead. Surfaced the divergence in the handoff report rather than silently doing what the brief said. **That's the behavior we want from Sonnet** — judgment over slavish adherence. Brief was updated mid-flight to reflect the correct pattern (already incorporated in `PROJECT-WORKSPACE-BRIEF.md` § "What's already built").

### Verification (Opus review)

- ✓ `npm run build` clean, 53 routes, `/projects` shows.
- ✓ Migration 024 applied; column existence confirmed via `information_schema`.
- ✓ Code-review checklist (all 6 standing items): PostgREST FK N/A · PATCH preserves invariants ✓ · route shell exists in same commit ✓ · `.select()` shape match N/A · Radix Select sentinel ✓ · 'done' grep clean in project-status context ✓.
- ✓ Admin gate: `if (!isAdmin) notFound()` at page.tsx:13-14.
- ✓ Industry gate: `FEATURES.PROJECT_BOARD` via `getFeatureAccess` at page.tsx:10.
- ✓ Filter hook uses `router.replace({ scroll: false })` (Phase 5 checklist already satisfied pre-emptively).
- ✓ Sentinel `"__all__"` consistent across hooks + header.
- ✓ Suspense boundary around `useSearchParams` (Next 16 requirement met).
- **Deferred** (creds rotated, can't verify):
  - As Admizz admin: `/projects` 404, sidebar absent. Verified by code-reading the industry gate at page.tsx:10 + manifest entry under it-agency only.
  - As Zunkireelabs counselor: `/projects` 404, sidebar absent. Verified by code-reading the admin gate at page.tsx:13-14 + counselor role check.

### Files Changed (squash commit `44409a8`)

- **New** (15): `src/app/(main)/(dashboard)/projects/page.tsx` (22 lines), `src/industries/it-agency/features/project-board/pages/workspace.tsx` (86 lines), 11 components under `project-board/components/`, 2 hooks under `project-board/hooks/`, `meta.ts`, migrations 023 + 024.
- **Modified** (9): `src/app/(main)/api/v1/{projects,accounts}/[id]/route.ts` (accept owner_id), `src/app/(main)/api/v1/projects/route.ts` (PROJECT_STATUSES), `src/components/dashboard/shell.tsx` (+ LayoutGrid icon), `src/industries/_registry.ts` (+ PROJECT_BOARD), `src/industries/it-agency/manifest.ts` (+ project-board feature + sidebar entry), `src/industries/it-agency/features/accounts/components/project-form.tsx` (status enum update), `src/industries/it-agency/features/time-tracking/components/status-badge.tsx` (in_review + delivered).
- **DB**: migration 023 (status enum) + 024 (new fields + indexes).

### Branch hygiene

Both spent feature branches deleted from origin: `feature/project-board-phase-1` (Sonnet's parked kanban-only work, superseded by this phase) and `feature/project-workspace-phase-1` (squashed into this commit). Local copies remain as orphan refs; will get GC'd next reflog expiry.

### Not yet promoted to `main`

Production stays on `c13e594` until all 5 phases of Project Workspace ship + observation window.

---

## Production promotion shipped — stage → main, full IT-agency v1 + industry modules live (2026-05-27)

### What shipped

`stage` (`d20cccc`) merged into `main` via a non-FF merge at `c13e594`. Production (`lead-crm.zunkireelabs.com`) is now current with the full Q2 build:

- **Industry modules architecture** — every feature now lives under `src/industries/<id>/features/<feature>/` or the universal `src/app/...` two-homes. `_loader.ts` + `_registry.ts` + per-industry `manifest.ts` give one truth function (`getFeatureAccess`) for sidebar / route / API gating.
- **Accounts** — top-level CRM entity for `it_agency`, `FEATURES.ACCOUNTS` gate, `/accounts/*` URLs.
- **CRM Contacts v1** (Phases A–E) — contacts CRUD, project↔contact junction, lead→contact conversion with TOCTOU safety, cross-cutting `converted_at IS NULL` filters with `?include_converted=1` flag.
- **Time Tracking v1** (Phases 1–5) — accounts/projects/tasks/time-entries hierarchy, approvals queue with atomic status precondition + audit + events, rates plumbing (`tenant_users.default_hourly_rate` + `projects.default_rate` + `resolveEffectiveRate` precedence), atomic `rate_snapshot` on approval, billable totals on project detail + approvals queue + home stats.
- **Anish's lead-tags + contacts page + lead-type toggle + ID generation + phone country-code handling + sidebar ordering fixes**.
- **Doc reorg**: SESSION-LOG / STATUS-BOARD / FEATURE-ROADMAP / FEATURE-CATALOG as 4 living docs; everything else under `docs/archive/<series>/` or `docs/reference/`.

DB migrations 019–022 applied: 019 (lead tags), 020 (time tracking schema + tenant_users.default_hourly_rate + leads.account_id), 021 (contacts + project_contacts + leads conversion columns), 022 (project_contacts RLS hardening).

### Merge mechanics

- Local `main` was 43 commits behind origin/main → fast-forwarded clean to `e10b97d`.
- Fast-forward of stage onto main was NOT possible: main had 2 commits stage didn't (`02fe74e` empty CI redeploy trigger from 2026-05-12 + `e10b97d` Anish's "Merge stage" from 2026-05-21). Both were operational, no application code to preserve, no rebase needed.
- Used `git merge --no-ff stage` → ort strategy, no conflicts, 173 files changed (14,313 insertions / 448 deletions). Merge commit `c13e594` preserves both histories. **Force-pushing main was explicitly not on the table** (CLAUDE.md § CI/CD + the resume prompt's "production-affecting actions confirm first" rule).
- Push to origin/main triggered Deploy-to-Production run `26502204163`. Pre-deploy Checks (lint + tsc + build) + Deploy job both green. 4m22s total (09:13:31Z → 09:17:53Z UTC).

### Live verification

- `lead-crm.zunkireelabs.com` → 307 (redirect to /login, expected unauthenticated).
- `lead-crm.zunkireelabs.com/login` → 200, ~0.6s TTFB.
- `lead-crm.zunkireelabs.com/dashboard` → 200 after redirect-follow.
- Deeper smoke (dashboard render as both Zunkireelabs + Admizz admin, sidebar item visibility per industry) **not** run as part of this entry — visual verification of staging was Sadin's call; staging was current with the same diff. If a regression surfaces, rollback path is `gh workflow run rollback.yml -f commit_sha=e10b97d -f reason="..."`.

### Pre-flight: Anish's work surveyed

Before the merge, surveyed all non-main/stage branches because the resume prompt called out "any Anish PRs in flight that should be bundled." Result: **no in-flight Anish work**. 4 of his branches (`check-in`, `consultancy-update`, `create-form`, `tags`) are zero-commits-ahead of stage — already-merged dangling branches, safe to delete on cleanup. 1 unmerged branch (`feature/ai-orchestrate-orca`) is by Sadin not Anish, 7 weeks old, predates industry modules. No open PRs on GitHub. The "Anish tags/contacts/lead-types" line in STATUS-BOARD referred to work *already on stage*, which this promotion shipped to prod as intended.

### Test residue replicated to prod (known)

Phase E + Phase 5 smoke runs left test data in Zunkireelabs tenant — PhaseE-Smoke-NoRate projects, SmokeConvert leads, smoke contacts. These now live on `lead-crm.zunkireelabs.com`. Cosmetic, harmless, not worth a cleanup migration. Flagged in RESUME block so a future "the prod data looks weird" question has an immediate answer.

### Workflow held

Production-affecting action confirmed with Sadin via AskUserQuestion before the merge. Opus did the merge + push + monitoring + verification + doc updates — all brain/orchestration work. No code written. No Sonnet handoff needed.

---

## Time Tracking Phase 5 shipped — rates + billable totals, feature v1 closed (2026-05-27)

### What was built

Phase 5 closes Time Tracking v1. The IT-agency tenant can now set per-member rates, override per-project, log time, get it approved with the effective rate locked into `rate_snapshot`, and see billable totals on project detail + approvals queue + home stats. Squash-merged at `f50f3ef` from `feature/time-tracking-phase-5` (Sonnet branch `5c91845`).

- **Rate plumbing.** `tenant_users.default_hourly_rate` already existed (migration 020); Phase 5 plumbed it through `/api/v1/team` PATCH (admin-only, validates non-negative number or null) and surfaced an inline rate editor on `/team` for IT-agency tenants. `projects.default_rate` already existed AND the UI input was already in `ProjectForm` from Phase 2 of Time Tracking; Phase 5 refactored `ProjectForm` to use the new shared `RateInput` component.
- **`lib/rates.ts`** with `resolveEffectiveRate(project, member)` — `project?.default_rate ?? member.default_hourly_rate ?? 0`. Single source of truth for "what rate applies to this entry right now."
- **Atomic `rate_snapshot` on approval.** Extended `/api/v1/time-entries/[id]/approve`: fetch entry (now also gets `project_id`, `user_id`) → parallel fetch project + member rates → compute `rate_snapshot = resolveEffectiveRate(...)` in app code → atomic UPDATE writes `approval_status='approved' + approved_by + approved_at + rate_snapshot` all in one query, preserving the existing TOCTOU precondition `.eq("approval_status", "pending")`. Audit log records the snapshot transition.
- **`lib/totals.ts`** with `calculateBillableMinutes` + `calculateBillableAmount`. Both filter `is_billable && approval_status === 'approved'`. `calculateBillableAmount` uses `rate_snapshot` (not effective rate) so historical invoices stay immutable — change a project's `default_rate` tomorrow, yesterday's approved entries don't budge.
- **`RateInput` component** — shared `$`-prefixed numeric input with `min=0 step=0.01`. Used by `ProjectForm` (form-sized) and conceptually by the team page (which uses its own compact inline `<input>` — same shape, different sizing class, acceptable specialization).
- **UI billable surfaces:**
  - **Project detail page** (`time-tracking/pages/project-detail.tsx`): "Billable totals" card above the existing Contacts section. Shows hours + amount, "Approved entries only" caption. Fetches `?approval_status=approved` separately to keep the math clean.
  - **Approvals queue** (`approvals-queue.tsx`): parallel fetch of pending entries + team rates. Each pending row shows projected `$X.XX` + `@$Y/hr` so admin sees what they're approving before clicking.
  - **Timesheet stats home** (`timesheet-stats-cards.tsx`): "Billable $" tile replaces "Entries" tile for both admin and member views.
- **`/api/v1/time-entries/summary`** — new endpoint with `?dimension=member|project|account&from=&to=`. Returns `[{key, label, minutes, billable_minutes, billable_amount}, ...]`. Counselor scoping: non-admins query-filtered to own user_id at line 75-77 of the route; additional belt-and-suspenders filter for `dimension=member` at line 111-113. PostgREST FK disambiguation applied (`projects!time_entries_project_id_fkey`).
- **`/api/v1/time-entries` GET + POST select shape**: added `default_rate` to the projects join. Needed because the approvals queue UI computes `resolveEffectiveRate(entry.projects, ...)` client-side.

### Architecture decision affirmed: team PATCH is not industry-gated

Sonnet flagged this in their handoff report. `tenant_users.default_hourly_rate` lives on a universal table (added by migration 020 along with `leads.account_id`). Gating the WRITE while leaving the READ and the column itself ungated would be inconsistent — and there's no security implication if an Admizz admin sets a rate via API; it stores in their own tenant's data, never read. The frontend gate at `industryId === "it_agency"` (in `team-management.tsx` via `showRates` flag) is the meaningful user-facing gate. Opus reviewed and affirmed: this is the right call.

### Workflow held — first phase with zero fixbacks

Sonnet's initial commit `5c91845` was clean on all 6 items of the code-review checklist on first pass: PostgREST FK explicit in `summary/route.ts`, PATCH preserved the existing route's POST-invariant pattern, no new page components needed shells (existing pages extended), `.select()` after the approve UPDATE returns the join shape the UI consumes, no Radix Select empty-string risk (the validation already uses an enum + 422), and the cross-cutting predicate (the `default_rate` join addition) was applied to ALL 3 places that select from `time_entries` with the projects embed (GET, POST, approve). First phase in this stretch where Opus had no review fixback to route back to Sonnet.

### Review smoke (Opus, 2026-05-27)

Sonnet ran 26/26 of the per-phase matrix and reported clean. Opus's independent re-verification:

- **Code review** of all 14 files in the diff — all key invariants confirmed (atomic UPDATE preserves TOCTOU precondition, scoping correct, audit log records rate change, totals.ts uses `rate_snapshot` not effective rate, FK disambiguation present).
- **Build clean** (`npm run build` 3.0s, `/api/v1/time-entries/summary` in the route table).
- **8 API smoke tests run successfully**: team PATCH rate persistence + negative-rate rejection · approve snapshots project rate (overrides member) · `rate_snapshot` unchanged after project-rate change to 999 · re-approve already-approved → 409 INVALID_STATE · approve falls back to member rate when `project.default_rate` is null · summary `dim=project` shape · summary rejects unknown dimension.
- **3 tests deferred** (counselor scoping on summary, Admizz 403 on summary + approve): Sonnet rotated counselor + Admizz passwords during their verification, and auto-mode correctly blocked Opus from re-rotating them without explicit authorization. Both paths verified by code-reading the relevant route lines (75-77, 111-113 for counselor; 32 for industry gate) + Sonnet's already-completed 26/26 matrix.

### Files Changed (Phase 5 shipping commit `f50f3ef`)

- **New** (4): `src/app/(main)/api/v1/time-entries/summary/route.ts` (137 lines), `src/industries/it-agency/features/time-tracking/components/rate-input.tsx` (38 lines), `lib/rates.ts` (8 lines), `lib/totals.ts` (13 lines).
- **Modified** (10): `src/app/(main)/(dashboard)/team/page.tsx` (pass industryId to TeamManagement), `src/app/(main)/api/v1/team/route.ts` (PATCH handler + GET returns rate), `src/app/(main)/api/v1/time-entries/[id]/approve/route.ts` (atomic rate snapshot), `src/app/(main)/api/v1/time-entries/route.ts` (default_rate in projects join), `src/components/dashboard/team-management.tsx` (inline rate editor, IT-agency-gated), `src/industries/it-agency/features/accounts/components/project-form.tsx` (uses RateInput), `src/industries/it-agency/features/time-tracking/components/timesheet-stats-cards.tsx` (Billable $ tile), `src/industries/it-agency/features/time-tracking/hooks/use-time-entries.ts` (projects type extended with default_rate), `src/industries/it-agency/features/time-tracking/pages/approvals-queue.tsx` (projected billable per row), `src/industries/it-agency/features/time-tracking/pages/project-detail.tsx` (billable totals card).
- **DB**: no changes (migration 020 from Phase 1 had all columns).

### Deferred (not blocking, not in Phase 5 scope)

- **`apiServiceUnavailable` (503) for validation errors in `/api/v1/team`** — pre-existing pattern that Sonnet mirrored. Should be `apiValidationError` (400/422). Cleanup candidate for a future hardening sweep across the team route's GET/DELETE/PATCH; not introducing it now would have required Sonnet to refactor neighbors which is out of scope.
- **Summary endpoint `member` dimension `label` is raw UUID** — would be nicer to resolve to email. No UI consumes summary yet (no reports page in v1); deferred polish.
- **Project-detail billable card has no date-range cap** — loads all approved entries ever for the project. Could slow long-running projects. Brief didn't specify pagination; acceptable v1.

### Not yet promoted to `main`

Hold for explicit Sadin go-ahead on the stage→main production promotion (which will bundle Time Tracking v1 + Accounts + CRM Contacts v1 + industry modules + Anish's tags/contacts/lead-types — a large diff vs the pre-industry-modules production state).

---

## CRM Contacts Phase E shipped — verification + doc sweep, feature v1 closed (2026-05-27)

### What was done

Phase E was the lightweight verification + docs phase that closes CRM Contacts v1. **No application code shipped** — the goal was to drive the 20-step smoke matrix end-to-end against the local dev server (now in sync with `dev-lead-crm.zunkireelabs.com` after the GH Actions suspension lifted), surface any defects, and archive the in-flight brief.

**Smoke matrix coverage:**
- **3 visual steps** (Sadin's screenshots, run in browser): sidebar nav order for Zunkireelabs (`Leads → Contacts → Accounts → Time Tracking`), Admizz `/contacts` shows existing ProspectsView (zero regression on education's filtered-leads view), implicit tenant isolation (Admizz sees 1 lead, Zunkireelabs sees 1000 — no cross-bleed).
- **13 API steps** (Opus-driven custom Node harness, auth as `admin@zunkireelabs.com`): Phase B contacts CRUD (list/create/detail/PATCH invariant/soft-delete-with-primary-unlink/account-side-list), Phase C junction (link with role=primary/409 PRIMARY_TAKEN on second primary/role-change-and-delete), Phase D conversion (existing-account / new_account / double-convert 409), and the Phase D cross-cutting `converted_at IS NULL` filter audit across `/api/v1/leads`, `/api/v1/accounts/[id]/leads`, `/api/v1/pipelines` lead_count shape, and `?include_converted=1` restore.
- **4 API steps** (second harness, auth as counselor `manjila@zunkireelabs.com` + Admizz admin `admizzdotcom2020@gmail.com`): counselor `/leads` list scoped to `assigned_to=self` (count=1, no leak), counselor converts own lead + verified `contact.assigned_to === counselor.userId` in DB, counselor convert on someone else's lead → 403 `FORBIDDEN`, Admizz hits `/contacts` + `/accounts` + `/leads/[id]/convert` → all three return 403 (not 200/404/500).

**One step retired**: Step 18 (Admizz sidebar has no it_agency Contacts) was redundant — Admizz does have a universal `Contacts` sidebar entry that routes to education's ProspectsView. The real check is "the sidebar Contacts doesn't crash and doesn't load the it_agency CRM view," which Step 19 (Admizz `/contacts` renders ProspectsView) already covers. Adjusting the matrix in archive.

**One bonus finding worth flagging** (not a bug, just a misread on my part when writing the matrix): counselor `GET /api/v1/contacts` returns **all** tenant contacts. No `assigned_to` filter. Inspection of `src/app/(main)/api/v1/contacts/route.ts:18-60` confirms this is intentional — counselors are read-only viewers of the contact roster (admin gate on POST/PATCH/DELETE). The actual counselor scoping is on `/api/v1/leads` (auto-overridden `assignedTo=auth.userId` for counselors) and on the convert API (owner check at line 87 of `convert/route.ts`). My matrix Step 15 wording over-specified "only own contacts" — the real invariant is on leads + convert, not the contacts list, and that invariant holds.

### TOCTOU race — what was and wasn't verified

Step 13 verified the **precondition gate** (second POST to convert on an already-converted lead → 409 `INVALID_STATE: "Lead already converted"`), which is the cheap path. The full **TOCTOU race condition** (two parallel converts on the same not-yet-converted lead, expecting exactly-one-wins + orphan contact cleanup on race-loss) was NOT directly exercised — would have needed concurrent calls from two contexts. The code path is identical to the time-entries approve/reject pattern (`.is("converted_at", null)` precondition + `.maybeSingle()` + 0-row → DELETE orphan + 409), which itself was race-tested during Time Tracking Phase 4 in a two-window manual test. Carrying forward as an acceptable residual; revisit if a real bug surfaces.

### GitHub Actions suspension — resolved during the gap

The org-level GitHub Actions suspension first hit during the Phase D deploy on 2026-05-26 (Trust & Safety flag on automated tokens; personal credentials and Actions billing both healthy). Sadin filed a support ticket; GitHub cleared it overnight. Verified by two consecutive green Deploy-to-Staging runs (`6f067fd` 3m46s, `e1579b3` 3m48s) on 2026-05-27 morning. The empty commit `e1579b3` was pushed primarily as a backlog-drainer once the suspension lifted; turned out unnecessary (the previous push had already drained successfully) but harmless and provides a clean marker. `dev-lead-crm.zunkireelabs.com` is now current with all of Phase A–E.

### Smoke harness — disposable artifacts

Built two single-file Node smoke harnesses (`smoke-phase-e.mjs` for admin paths, `smoke-phase-e-2.mjs` for counselor + Admizz) that authenticate via `@supabase/ssr` cookie format (base64-encoded JSON session, name `sb-<project_ref>-auth-token`) and drive the Next.js API routes end-to-end. Removed both files from the project root before committing — they were tooling, not artifacts to preserve. If a future smoke pass needs them, the prior conversation history has the exact contents and they're trivially regenerable.

**Test-data residue**: the smoke runs left a handful of seeded contacts, a "Phase E Test Project" project, and ~3 converted leads in the Zunkireelabs tenant of the staging DB. Harmless in dev; not worth a cleanup migration. Flagged here so future engineers seeing "SmokeConvert" leads or "PhaseE Smoke" contacts know they came from this verification pass.

### Workflow held

No code shipped, so the Opus-plans / Sonnet-executes split was structurally non-applicable — but the spirit held: Opus drove verification + docs (which IS Opus's job per `feedback_opus_plans_sonnet_executes`), no shortcuts taken. The custom smoke harness is verification tooling, NOT product code, and was scoped to live-and-die in /tmp + cleaned up before commit. Consistent with the rule that even small fixbacks go to Sonnet — but verification scripts are a different category and stay with Opus.

### Files Changed (Phase E shipping commit)

- **Modified**: `docs/SESSION-LOG.md` (this entry + new resume block), `docs/STATUS-BOARD.md` (Phase E + GH suspension items → Recently resolved; Time Tracking Phase 5 surfaced as new #1), `docs/FEATURE-CATALOG.md` (CRM_CONTACTS row updated to mark Phase E complete + Last-updated header).
- **Moved**: `docs/CRM-CONTACTS-BRIEF.md` → `docs/archive/features/CRM-CONTACTS-BRIEF.md` via `git mv` (preserves history; precedent: `ACCOUNTS-PROMOTION-BRIEF.md`).
- **Code**: zero changes.
- **DB**: zero changes.

### Deploy state

Phase E shipping commit pushed to `stage` and auto-deployed to `dev-lead-crm.zunkireelabs.com`. Production `main` not yet promoted — waiting on Time Tracking Phase 5 + the bundled stage→main promotion for Contacts v1 + TT v1 + industry modules.

### What comes next

**Time Tracking Phase 5** — the planned-final piece of Time Tracking v1. Per-member rate UI, per-project override, snapshot on approval, billable totals + stats card. DB columns from migration 020 already exist; pure UI + business logic. Spec lives at `docs/TIME-TRACKING-BRIEF.md § Phase 5`. After Phase 5 ships, promote `stage` → `main` to push Contacts v1 + Time Tracking v1 + industry modules + Anish's tags/contacts to production in one coherent release.

### Not yet promoted to `main`

Hold for Time Tracking Phase 5.

---

## CRM Contacts Phase D shipped — Lead → Contact conversion (2026-05-26)

### What was built

Phase D closes the loop on the CRM Contacts feature: leads now have an explicit conversion path to become Contacts at an Account. After this, the funnel/steady-state split is real — converted leads drop out of the prospecting surfaces (kanban, leads list, account leads, dashboard counts) while remaining readable for historical context.

- **`POST /api/v1/leads/[id]/convert`** route. The TOCTOU-safe pattern is identical to time-entries approve/reject (the bug-class precedent from Phase 4):
  1. `authenticateRequest` + `getFeatureAccess(industry, FEATURES.CRM_CONTACTS)` + counselor-can-only-convert-own-lead check.
  2. Fetch lead via scopedClient with `deleted_at IS NULL` + early 409 if `converted_at` already set.
  3. Resolve account: either verify existing-belongs-to-tenant or `INSERT INTO accounts (name)`.
  4. Insert contact with `assigned_to` mirroring the lead's (counselor scoping continuity) and `accounts!contacts_account_id_fkey(id, name)` embed in the select (Phase B fixback #3's FK-disambiguation lesson).
  5. **Atomic UPDATE** with `.eq("id", id).is("converted_at", null)` precondition + `.maybeSingle()`. If 0 rows → race lost → `DELETE` the orphan contact + 409. The COALESCE on `account_id` preserves any existing FK without clobbering.
  6. Audit + emit `lead.converted` event.
  7. Return `{ contact, account_id, lead_id }`.
- **`ConvertLeadDialog`** at `src/industries/it-agency/features/crm-contacts/components/convert-lead-dialog.tsx`. Industry-gated to it_agency. Defaults: "Use existing account" pre-selected when `lead.account_id` is set (with that account preselected in the combobox), "Create new account" pre-selected with name-input focus otherwise. Edit-fields toggle exposes contact-field overrides; defaults inherit from lead. NO_ACCOUNT sentinel (`"__no_account__"`) for the Radix Select placeholder option — empty-string crash avoided per Phase C fixback. 409 path auto-refreshes the lead detail with toast "This lead was just converted by someone else."
- **`lead-detail-v2.tsx` integration**: Convert button in the header (it_agency only, when `converted_contact_id IS NULL`); swaps to "Converted to <name>" link pill that navigates to the new contact when conversion has happened.
- **Cross-cutting filter audit** — every default leads-fetching surface gets `.is("converted_at", null)`:
  - `src/lib/supabase/queries.ts` — `getLeads()`, `getLeadsForPipeline()`, pipeline-lead-counts inside `getPipelines()`.
  - `/api/v1/leads` GET + `/api/v1/accounts/[id]/leads` GET (with optional `?include_converted=1` flag for the future archive view).
  - `/api/v1/leads/bulk` PATCH + DELETE verification reads (so bulk ops can't accidentally re-target a converted lead).
  - `/api/v1/pipelines` GET + `/api/v1/pipelines/[id]` GET — per-pipeline and per-stage lead counts (caught at review; the PipelineSelector + MoveToPipelineModal would otherwise have shown inflated counts that disagree with the kanban).
- **Intentionally NOT filtered** (preserve read-only access to converted leads):
  - `queries.ts → getLead()` and `/api/v1/leads/[id]` GET — single-lead detail still loads converted leads so the "Converted to <contact>" pill works.
  - All child routes (notes, checklists, activities, insights, check-ins) — child mutations on a converted lead are an edge case the UI gates.
  - `/api/public/submit/...` — public form INSERTS leads; no read filter applies.
  - Pipeline DELETE guard and stage DELETE guard — converted leads still hold FK references; counting them as deletion-blockers is correct.
  - `integrations/crm/*` — third-party sync semantics is a separate decision.

### Workflow incident: filter-audit punt caught at review (one fixback)

Sonnet's initial Phase D commit (`e52cbad`) was clean on every spec item — TOCTOU pattern verbatim from the time-entries precedent, FK disambiguation, Radix sentinel, counselor scoping all correct first try. The miss: Sonnet self-flagged in the report that `/api/v1/pipelines` and `/api/v1/pipelines/[id]` had inline leads queries "left unfiltered since the kanban/dashboard feeds through queries.ts." That justification was half-right — the kanban does, but the same endpoints are also consumed by `PipelineSelector.tsx`, `MoveToPipelineModal.tsx`, `PipelineSettingsModal.tsx`, and `email-rules-manager.tsx`, and any of those would have shown converted leads in pipeline counts while the kanban hid them. Inconsistent UI numbers.

Fix landed at `11a3460` via a focused Sonnet fixback prompt (NOT Opus-direct edits — `feedback_opus_plans_sonnet_executes` held). 4-line patch across both pipeline route files: add `.is("converted_at", null)` to the leadCounts queries.

**Lesson**: filter audits for cross-cutting predicates MUST grep `from("TableName")` across the whole repo, not trust a hand-curated targets list. The original Phase D handoff prompt did list pipelines routes implicitly (Sadin's spec said "audit ALL leads-fetching surfaces") but my own targets list didn't enumerate them, leaving Sonnet to guess. Adding as item #6 on the code-review checklist.

### Verification

- Build clean (51 pages; `/api/v1/leads/[id]/convert` appears in the route table).
- Lint 0 errors, 11 pre-existing warnings (baseline unchanged).
- Manual smoke: Sadin running locally at merge time (10-step matrix including TOCTOU two-window race). Confirmation expected this session.

### Files Changed (Phase D + fixback, squash-merged as `35a5394`)

- **New** (2): `src/app/(main)/api/v1/leads/[id]/convert/route.ts` (180 lines), `src/industries/it-agency/features/crm-contacts/components/convert-lead-dialog.tsx` (283 lines).
- **Modified** (7): `src/components/dashboard/lead/lead-detail-v2.tsx` (Convert button + "Converted to" pill + dialog wiring), `src/lib/supabase/queries.ts` (3 leads queries filtered), `src/app/(main)/api/v1/leads/route.ts` (GET filter + `?include_converted=1`), `src/app/(main)/api/v1/accounts/[id]/leads/route.ts` (GET filter + `?include_converted=1`), `src/app/(main)/api/v1/leads/bulk/route.ts` (bulk verification reads filtered), `src/app/(main)/api/v1/pipelines/route.ts` (lead-count filter — fixback), `src/app/(main)/api/v1/pipelines/[id]/route.ts` (per-stage lead-count filter — fixback).
- **DB**: no changes (migration 021 from Phase A already shipped the conversion columns).

### Deploy state

Push `6ba43ee..35a5394` succeeded but did NOT trigger a workflow run — GH Actions degraded-performance incident still suppressing webhook delivery (7 stage commits now backlogged). `dev-lead-crm.zunkireelabs.com` still on `a340230` (Phase B docs).

### Not yet promoted to `main`

Hold for Phase E + Time Tracking Phase 5.

---

## CRM Contacts Phase C shipped — project↔contact junction wiring (2026-05-26)

### What was built

Phase C turned the project_contacts junction (created by migration 021, RLS-hardened by migration 022) into a working UI. The Salesforce/HubSpot pattern is now real: a person at an account can be linked to one or more projects with an optional role (Primary / Technical / Billing / Other), and the project's contact roster reflects this from the project side.

- **2 symmetric API routes** wrapping the same `project_contacts` junction:
  - `POST/PATCH/DELETE /api/v1/contacts/[id]/projects` — manage a contact's project links.
  - `GET/POST/PATCH/DELETE /api/v1/projects/[id]/contacts` — manage a project's contact links.
  - Both: auth + feature gate + admin gate. scopedClient pre-checks BOTH the contact AND the project belong to tenant before any junction operation. Junction itself accessed via `db.raw().from("project_contacts")` because the table has no `tenant_id` column. Defense-in-depth: migration 022's project_contacts RLS still enforces both-side tenant checks, but it's moot here since `db.raw()` uses service role and bypasses RLS — the app-layer pre-check is the actual gate.
  - **23505 → 409 PRIMARY_TAKEN** mapping: the partial unique index `project_contacts_one_primary` from migration 021 fires on the second `INSERT WHERE role='primary'`. Caught by error code + returned as a clean 409 with message "This project already has a primary contact. Demote them first or pick a different role." Surfaced to UI as a toast.
  - **PostgREST FK disambiguation** preemptively applied throughout (Phase B's lesson): every embed between two tables uses the explicit FK name (`projects!project_contacts_project_id_fkey`, `accounts!projects_account_id_fkey`, etc.). Sonnet caught this from the brief without prompting.
  - **Cross-account warn-not-block**: a contractor at one account can be linked to another account's project. Server logs a warn line via pino; not blocked.
- **UI integration on `contact-detail.tsx`**: real Projects-involved section replacing the Phase B placeholder. Each row: project name (linked) + "at <account>" subtitle + role pill + hover-reveal change-role dropdown + remove button (admin only). Inline "Add to project" button at the top.
- **UI integration on `project-detail.tsx`** (the page that lives in time-tracking but increasingly feels like an accounts/contacts concept): new Contacts section above Tasks. Same affordances, mirror shape. Order: primary first (JS-side sort with priority map), then by last_name.
- **Shared `ProjectContactPicker` component** at `crm-contacts/components/project-contact-picker.tsx`. Two modes via prop: `pick-project` (used from contact-detail — picks a project to link) and `pick-contact` (used from project-detail — picks a contact to link). Searchable list, account-scoped by default with a "show all accounts" toggle to widen, role selector. Cross-feature import from time-tracking's project-detail.tsx — same precedent as ProjectForm.

### Workflow incident: Radix Select empty-string crash (fixback)

Sonnet's initial Phase C commit `d8b8c7b` was clean per spec EXCEPT the role-select sentinel: `ROLE_OPTIONS` started with `{ value: "", label: "No role" }`, which Radix UI's `<Select.Item>` forbids — `value=""` is reserved for "clear selection / show placeholder." Clicking "Add to project" crashed at render with the Radix error before the dialog could even be filled out.

**This was a brief-level miss** — I specified "Primary / Technical / Billing / Other / **No role**" without flagging the Radix constraint. Adding to the codebase code-review checklist as the 5th item.

Fix landed at `6dcbe6a` via a focused Sonnet fixback prompt (NOT Opus-direct edits — the updated `feedback_opus_plans_sonnet_executes` memory entry held this time). 5 mechanical edits in `project-contact-picker.tsx`:
- Add `const NO_ROLE = "__none__"` sentinel.
- Use it in `ROLE_OPTIONS` for the no-role item.
- Initial state + reset use `NO_ROLE`.
- State type widened from `ProjectContactRole` to plain `string` (sentinel is outside the union).
- Submit handlers map `role === NO_ROLE ? undefined : role` so the API field is omitted when no role is chosen — matches the existing POST validation which treats role as optional.

The DropdownMenu used for change-role on row hover does NOT have this constraint (Radix DropdownMenu allows any value, the empty-string forbiddance is Select-only) — no edits needed there.

### Why this didn't show up in build/lint

Radix enforces this at runtime via a `throw new Error()` in the SelectItem render path. TypeScript can't catch it because the prop type is `string` and an empty string is a valid string. The only way to catch this class of bug pre-runtime is an integration test that mounts the component — which we don't have for these new UIs. Accepted residual risk; the smoke step exists for exactly this kind of class.

### Verification

- Build clean (50+ pages, both new API routes in route table).
- Lint 0 errors, 11 pre-existing warnings (baseline unchanged through both commits).
- Manual smoke as Zunkireelabs admin (all passed after the fixback):
  - Add Test Contact → BathroomFort Website with role=Primary → green pill on both pages.
  - Second contact + same project + role=Primary → 409 toast.
  - Second contact + same project + role=Technical → succeeds, primary first in list.
  - Technical → Primary on the second contact → 409.
  - Demote first contact (Primary → No role) + promote second to Primary → succeeds.
  - Remove a link → disappears from both pages.
  - Symmetric pick-contact flow from project detail → succeeds.
  - Cross-account link → allowed (no toast error; server-side warn only).
- Admizz 403 on both new routes (code-reviewed; not browser-verified).

### Files Changed (Phase C + fixback)

- **New** (3): 2 API route files (`/api/v1/contacts/[id]/projects`, `/api/v1/projects/[id]/contacts`), ProjectContactPicker component.
- **Modified** (4): `contacts/[id]/route.ts` (nested accounts embed inside the projects join for "at <account>" subtitle), `crm-contacts/pages/contact-detail.tsx` (Projects section + change-role + remove), `time-tracking/pages/project-detail.tsx` (Contacts section — cross-feature touch), `FEATURE-CATALOG.md`.
- **DB**: no changes.

### Not yet promoted to `main`

Hold for Phases D + E + Time Tracking Phase 5.

---

## CRM Contacts Phase B shipped — full CRUD + account-detail integration (2026-05-26)

### What was built

Phase B turned the Phase A scaffolding into a working feature. After this, an it_agency admin can create contacts at any account, browse + filter + search them at `/contacts`, view detail + edit + soft-delete, and set/clear a primary contact pill on each account.

- **Migration `022_project_contacts_rls_hardening.sql`** — closes the Phase A RLS gap on `project_contacts`. Drops + recreates the 3 policies (SELECT/INSERT/DELETE) with both contact-side AND project-side tenant checks (`EXISTS (... contacts c WHERE ... AND ...) AND EXISTS (... projects p WHERE ... AND ...)`). Verified via `pg_policies`.
- **6 API routes** under `/api/v1/`:
  - `contacts/route.ts` GET (list with `account_id` / `status` / `q` / `include_inactive` filters, joined accounts with explicit FK after fixback) + POST (validates first/last/account_id, requires at least email OR phone, scopedClient verifies account belongs to tenant before insert).
  - `contacts/[id]/route.ts` GET (single + joins on accounts + project_contacts→projects) + PATCH (blocks account_id changes, enforces email-or-phone invariant after fixback) + DELETE (soft-delete + clears `accounts.primary_contact_id` references in the same tenant).
  - `accounts/[id]/contacts/route.ts` GET (contacts at an account, optional include_inactive).
  - `accounts/[id]/route.ts` extended: PATCH now accepts `primary_contact_id` with contact-belongs-to-this-account-and-tenant validation.
- **UI components** under `src/industries/it-agency/features/crm-contacts/`:
  - `pages/contacts-list.tsx` — table layout with account/status filters + debounced 250ms search, "Add Contact" dialog, ContactStatusBadge.
  - `pages/contact-detail.tsx` — header with name + title + status, info card (email + phone + linked account), Projects section (Phase C placeholder).
  - `components/contact-form.tsx` — dialog form with account picker, validation (email-or-phone), edit + create modes.
  - `components/contact-status-badge.tsx` — Active/Inactive variant.
- **`account-detail.tsx` integration**:
  - Inline Contacts section above Projects with "Add Contact" inline + count badge.
  - Primary Contact pill in the header (admin only, popover picker showing all account contacts incl. inactive, ✓ marker on current, Clear option).
- **New page shell `src/app/(main)/(dashboard)/contacts/[id]/page.tsx`** (added in fixback #2) — industry-dispatched, only renders for it_agency + `FEATURES.CRM_CONTACTS`.

### Three review-time fixbacks (lessons each)

Phase B had Sonnet's initial commit clean per spec, then 3 fixback rounds:

**Fixback 1 — `324c03e` (caught at Opus diff review)**:
- PATCH allowed clearing both `email` AND `phone`, leaving a contact with no contact info. POST enforced this; PATCH didn't.
- Search `q` parameter was interpolated raw into PostgREST `.or()` — values with commas could break the query parse.
- **Lesson**: spec-side miss — the brief required POST validation but didn't say "preserve invariant on PATCH too." Add this rule for any field-level invariant: if POST enforces it, PATCH must too.

**Fixback 2 — `f03b021` (caught when Sadin smoked the UI)**:
- Clicking a contact 404'd because there is **no Next.js page shell at `/contacts/[id]`** — only the list shell. The detail component existed in the industry module but wasn't wired to a route.
- Same POST endpoint returned the new contact without the `accounts(id, name)` join, so the optimistic add showed `Account: —` on the freshly created row.
- **Lesson**: in Phase A I described `contact-detail.tsx` as "exported but not wired yet" — and then never wired it in Phase B either. New page components MUST get a route-shell line item in their brief. Same review-checklist item: any `select()` after insert/update that's surfaced to the UI needs to match the read-side joins.

**Fixback 3 — `1909203` (caught when Sadin's contact disappeared from /contacts but stayed on the account detail page)**:
- Root cause: PostgREST embed ambiguity. Migration 021 added `accounts.primary_contact_id` (reverse FK), so contacts↔accounts now has TWO FKs. `.select("*, accounts(id, name)")` on contacts can't disambiguate → returns no data. The account-detail-contacts endpoint never hit it because it filters by `account_id` directly with no embed.
- **This was latent the moment migration 021 added the reverse FK** — guaranteed to surface whenever anything joined contacts↔accounts. Fix: explicit FK hint `accounts!contacts_account_id_fkey(id, name)` in all 4 select sites.
- **Lesson**: any time a migration adds a reverse FK between two tables that already have a forward FK, every embed between those tables MUST use the explicit FK name. Add to STATUS-BOARD code-review checklist for future features.

### Workflow violation — and self-correction

All 3 fixbacks were Opus-direct Edit commits, not Sonnet-routed. Sadin pushed back: brain work is Opus, leg work (any code) is Sonnet. The earlier "Accounts promotion commit-missing-edits" recovery was an emergency-recovery context, not a routine review precedent. Memory entry `feedback_opus_plans_sonnet_executes` updated 2026-05-26 with explicit "small fixback trap" guidance: even one-line bug fixes go to Sonnet via a follow-up prompt; only doc edits stay Opus's.

### Verification

- Build clean (50+ pages, `/contacts`, `/contacts/[id]`, 3 API routes including new ones present).
- Lint 0 errors, 11 pre-existing warnings (baseline unchanged) across all fixbacks.
- Migration 022 verified live in staging DB (`pg_policies` shows all 3 `project_contacts` policies reference both contacts AND projects).
- Manual smoke as Zunkireelabs admin: create contact at CarbonSpark → list shows with correct Account column → click into detail → info card shows email + phone + linked account → "Projects — Phase C placeholder" → back to list works → account-detail page shows the contact in its Contacts section with primary-pill picker functioning.
- Admizz zero-regression smoke: `/contacts` still renders the existing ProspectsView (industry dispatch on the shell preserves the education path).
- Stage deploy triggered on push of `1909203`.

### Files Changed (Phase B + 3 fixbacks)

- **New** (7): migration 022, new `/contacts/[id]/page.tsx` shell, 4 API route files (contacts list/create, contacts get/patch/delete, accounts-by-id contacts, account PATCH primary_contact_id extension wasn't new — modification), 2 components (contact-form, contact-status-badge).
- **Modified** (5): `accounts/[id]/route.ts` (primary_contact_id PATCH support), `accounts/pages/account-detail.tsx` (Contacts section + primary pill — 213 lines), `crm-contacts/pages/contacts-list.tsx` (real impl — 212 lines vs Phase A placeholder), `crm-contacts/pages/contact-detail.tsx` (real impl — 259 lines), `FEATURE-CATALOG.md`.
- **DB**: migration 022 applied live.

### Not yet promoted to `main`

Hold for Phases C–E + Time Tracking Phase 5, then promote as one coherent release.

---

## CRM Contacts Phase A shipped — schema + manifest scaffolding for it_agency (2026-05-26)

### What was built

Foundation layer for the it_agency Contacts feature (the people-side counterpart to Accounts). The 5-phase brief lives at `docs/CRM-CONTACTS-BRIEF.md`. Phase A is just the scaffolding — no API or UI yet.

- **Migration 021_contacts.sql** — created 2 tenant-owned tables + 2 ALTERs:
  - `contacts` (id, tenant_id, account_id NOT NULL, first/last/email/phone/title, status CHECK 'active|inactive', assigned_to for counselor inheritance, notes, deleted_at). `updated_at` trigger via the existing `update_updated_at()` function.
  - `project_contacts` junction (project_id, contact_id, role CHECK 'primary|technical|billing|other', PK on the pair). **Partial unique index `project_contacts_one_primary ON project_contacts(project_id) WHERE role='primary'`** enforces "at most one primary contact per project" at DB level.
  - `leads` ALTER: `converted_at TIMESTAMPTZ NULL` + `converted_contact_id UUID NULL` (REFERENCES contacts ON DELETE SET NULL) + partial index for the not-null case.
  - `accounts` ALTER: `primary_contact_id UUID NULL` (REFERENCES contacts ON DELETE SET NULL). `primary_contact_email` text column left in place for backfill compatibility.
  - RLS: 4 policies on contacts (select/insert/update/delete) + 3 on project_contacts (select/insert/delete; no UPDATE — junction rows don't mutate). Sonnet caught that `= ANY(...)` syntax failed on the staging DB and switched to `IN (SELECT get_user_tenant_ids())` to match migration 020's pattern — correct judgment call.
- **Type system** extended in `src/types/database.ts`: new `Contact`, `ProjectContact` interfaces, `ContactStatus = 'active'|'inactive'`, `ProjectContactRole = 'primary'|'technical'|'billing'|'other'`. `Lead` extended with `converted_at`/`converted_contact_id`. `Account` extended with `primary_contact_id`.
- **Industry wiring**: `FEATURES.CRM_CONTACTS = "crm-contacts"` added to `_registry.ts` in the it_agency section. New `meta.ts`. `it-agency/manifest.ts` registers the feature + sidebar entry **above Accounts** (final order: Contacts → Accounts → Time Tracking, matching Salesforce/HubSpot). `shell.tsx` registers the `Contact` lucide icon in `INDUSTRY_ICONS`.
- **Route shell refactor**: `src/app/(main)/(dashboard)/contacts/page.tsx` is now industry-aware. It_agency users hit the new `ContactsListPage` placeholder ("Coming soon — Phase B"); education_consultancy users continue to see the existing ProspectsView with all data-fetching preserved verbatim. Highest-risk change in Phase A (touches shipped education code).
- **Placeholder components**: `pages/contacts-list.tsx` + `pages/contact-detail.tsx` — minimal "Coming soon" cards. Real implementations land in Phase B (list/detail) and Phase B/C (detail wiring).
- **FEATURE-CATALOG** updated with the new CRM_CONTACTS row.

### Workflow incident: RLS gap caught at review

`project_contacts` policies only check the **contact-side** tenant, not the project-side. A malicious admin could insert a junction row linking one of their tenant's contacts to another tenant's project_id — the row would exist in the other tenant's project's contact list as a "ghost link," though the contact's data stays protected by contacts RLS. Data pollution, not data theft.

**Decision**: merge Phase A, fix in Phase B's first task (migration `022_project_contacts_rls_hardening.sql` adding the project-side check to all 3 policies). Vulnerability window in practice is zero — no production code inserts into project_contacts until Phase C ships the link API.

### Verification

- Build clean (50 pages, `/contacts` route present).
- Lint 0 errors, 11 pre-existing warnings (baseline unchanged).
- DB sanity (via psql against staging DB): both tables present, RLS enabled, 5 indexes (incl. partial unique for primary role), `trigger_contacts_updated_at`, all 3 new columns, 7 RLS policies.
- Manual smoke as Zunkireelabs admin: sidebar shows Contacts above Accounts; `/contacts` shows placeholder; `/accounts` + `/time-tracking` unchanged. ✓
- Manual smoke as Admizz: `/contacts` ProspectsView renders identically to before the refactor. ✓
- Stage deploy triggered on push of `b622e5a`.

### Files Changed

- **New** (4): migration 021, `meta.ts`, 2 placeholder pages.
- **Modified** (6): `_registry.ts`, `it-agency/manifest.ts`, `shell.tsx` (icon registration), `types/database.ts`, `/contacts/page.tsx` (industry dispatch), `FEATURE-CATALOG.md`.
- **DB**: migration 021 applied live (verified via psql).

### Not yet promoted to `main`

Same as prior: hold prod promotion until Time Tracking v1 (after Phase 5) + Contacts v1 (after Phase E) so prod gets a coherent release.

---

## Accounts promotion shipped — top-level CRM entity for it_agency (2026-05-26)

### What was built

Accounts moved out from under `/time-tracking/accounts/*` to its own top-level sidebar entry + URL space + feature gate. The framing pivot from "Accounts is a Time Tracking sub-feature" → "Accounts is a CRM entity in its own right, parent to Projects" lands here. Time Tracking now owns only time entries + approvals.

- New feature: `FEATURES.ACCOUNTS = "accounts"` in `_registry.ts`. New folder `src/industries/it-agency/features/accounts/` with `meta.ts` + `pages/` + `components/`.
- Sidebar order on it_agency: Accounts (Building2) → Time Tracking (Clock). Building2 registered in `INDUSTRY_ICONS`.
- 6 `git mv`s preserved history: 2 page shells (`/accounts/page.tsx`, `/accounts/[id]/page.tsx`) + 2 industry pages (`accounts-list`, `account-detail`) + 2 components (`account-form`, `project-form`).
- 7 API routes (accounts + projects + tasks) re-gated from `FEATURES.TIME_TRACKING` → `FEATURES.ACCOUNTS`. Time-entry routes (`/api/v1/time-entries/*` including approve/reject) intentionally stay on `FEATURES.TIME_TRACKING` — time entries are a time-tracking concept, not an accounts concept.
- 2 intentional cross-feature imports introduced (architecturally correct, both documented):
  - `accounts/pages/account-detail.tsx` → imports `ProjectStatusBadge` from `time-tracking/components/status-badge` (badge has 4 other time-tracking consumers; promoting it to `_shared/` is a future cleanup).
  - `time-tracking/pages/project-detail.tsx` (stayed put) → imports `ProjectForm` from the new accounts location. Signals that project-detail is a candidate to migrate into accounts when account_id URL propagation gets sorted.
- 5 hardcoded `/time-tracking/accounts*` links rewritten to `/accounts*` across 3 page files (including project-detail's breadcrumb).
- `docs/FEATURE-CATALOG.md`: new ACCOUNTS row, TIME_TRACKING row corrected to its slimmer scope (3 routes, 5 API routes).
- Tabs work from prior session (`feature/time-tracking-nav-tabs` @ `96fcaae`) deleted — local + remote. The tabs implementation was clean but the framing was the issue, not the implementation.

### Workflow incident: Sonnet's commit was incomplete

Sonnet's initial commit `aefbe01` moved the 6 files and applied the obvious edits (API routes, registry, manifest, shell, FEATURE-CATALOG) but **omitted** the 4 page-file edits that lived on top of the moves (page-shell import paths + `FEATURES.TIME_TRACKING → FEATURES.ACCOUNTS` swap + cross-feature badge import + 3 link rewrites). Those existed as uncommitted working-tree edits.

Verifications passed anyway because Opus ran `npm run build`, `npm run lint`, and the grep checks against the working tree (which had the right content) and the manual smoke ran against the working tree's dev server too. The hole only surfaced at merge time when `git checkout stage` flagged the unstaged edits.

Fixed with an additive commit `13c528e` on the same branch (the project's "fix-back" pattern — same shape as Phase 4 fixback). Avoided amending so we didn't need to force-push a SHA origin already had.

**Lesson for next time**: when reviewing Sonnet's diff, `git status` should be the FIRST check, not just `git diff stage..feature`. If the working tree has uncommitted changes, the diff isn't representative of what's actually committed.

### Verification

- Build clean (`/accounts` + `/accounts/[id]` + 3 API routes present in route table).
- Lint 0 errors, 11 pre-existing warnings (none in touched files).
- Three grep invariants: no `/time-tracking/accounts` strings remain, `FEATURES.TIME_TRACKING` appears only in 4 time-entry routes, no stale `features/time-tracking/pages/account*` or `features/time-tracking/components/{account,project}-form` imports.
- Manual smoke as Zunkireelabs admin: sidebar shows Accounts (Building2), `/accounts` + `/accounts/<id>` work, `/time-tracking/accounts*` 404s, `/time-tracking` + `/time-tracking/projects/<id>` + `/time-tracking/approvals` unchanged. Project-detail back-link goes to `/accounts`. ✓
- Manual smoke as Admizz: no Accounts in sidebar, `/accounts` 404, `/api/v1/accounts` 403. ✓
- Stage deploy triggered on push of `13c528e`.

### Files Changed

- **New**: `src/industries/it-agency/features/accounts/meta.ts`.
- **Moved** (git mv, history preserved): 6 files into `/accounts/*` URL space + `features/accounts/` folder.
- **Modified**: `_registry.ts`, `it-agency/manifest.ts`, `shell.tsx`, 7 API routes, 3 page files (link + import rewrites), 2 page shells, `FEATURE-CATALOG.md`.
- **Deleted**: `feature/time-tracking-nav-tabs` branch (local + remote — commit `96fcaae` still in object DB if ever needed).
- **Archived**: `docs/ACCOUNTS-PROMOTION-BRIEF.md` → `docs/archive/features/`.
- **DB**: no changes.

### Not yet promoted to `main`

Still recommend promoting prod after Phase 5 ships, so Time Tracking lands in prod as a coherent v1.

---

## Time Tracking — Phases 4 + 4.5 shipped, Accounts-as-top-level decision (2026-05-25, evening)

### What was built

Two phases shipped in a single combined stage merge (`d252568`):

#### Phase 4 — Approvals queue + approve/reject API (commits `95bb3d1`, `9da8fe2`)

- Two new POST endpoints: `/api/v1/time-entries/[id]/approve` and `/api/v1/time-entries/[id]/reject`. Both run the full gate chain (auth → industry → `requireAdmin`) and return `INVALID_STATE` (409) if the entry isn't pending. Reject requires `{ reason: string, max 500 chars }`. Both emit audit logs + events.
- New `ApprovalsQueuePage` at `/time-tracking/approvals` with role gate, member/date grouping tabs, single-row approve/reject, bulk approve/bulk reject via `Promise.allSettled`, char-counted reject reason dialog.
- `TimeEntryRow` updated with `ApprovalStatusBadge` + tooltip on rejected entries' badges (shows reason on hover) + edit/delete hidden when `approval_status !== "pending"`.

#### Phase 4 fixback (commit `9da8fe2`) — Opus review found 3 issues

- **TOCTOU race**: approve/reject endpoints fetched status then updated only by `id`, so two admins could race. Fix: added `.eq("approval_status", "pending")` to the UPDATE chain + switched to `.maybeSingle()` — atomic precondition, 409 if 0 rows match.
- **Timezone bug regression**: approvals-queue.tsx used `.toISOString().split("T")[0]` in `fourWeeksAgo()` and `startOfWeek()` — same pattern that caused the Phase 3 bug. Fix: use `toLocalDateString()` from `@/lib/date`. The "This week: N pending" badge was off by a day in UTC+5:45.
- **Edit-lock UX**: home page's `entryCanEdit` was `if (isAdmin) return true`, meaning admins saw pencil/trash on approved/rejected entries. Sadin's call: "hide for everyone when locked" — `entryCanEdit = entry.approval_status === "pending"`.

#### Phase 4.5 — Role-aware team timesheet table (commit `d252568`)

- Replaced single-user card-list `/time-tracking` home with a role-aware **team timesheet**. Admin sees all members in one date-grouped table with Member column, filters (date range presets Today/This Week/This Month/Last 4w, Member admin-only, Account, Project, Status), per-row Approve/Reject inline buttons, and CSV export. Member sees own entries with no Member column and the existing inline `+ Log time` form pattern.
- Extended `/api/v1/time-entries` GET + POST select + the `[id]` GET/PATCH + approve + reject to nest `accounts(id, name)` under `projects(...)` — one round-trip resolves account names. `TimeEntryWithJoins` type updated.
- 7 new files: `pages/timesheet.tsx`, 5 components (`timesheet-filters`, `timesheet-stats-cards`, `timesheet-table`, `timesheet-row`, `log-time-dialog`), 1 shared hook (`use-approve-reject` extracted from approvals-queue so both surfaces share the same approve/reject + 409 handling).
- `approvals-queue.tsx` refactored to consume the shared hook for single approve/reject. Bulk operations kept as raw `Promise.allSettled` loops (Sonnet's judgment call — no benefit to routing them through the hook).
- Filter state synced to URL search params for shareable links + refresh survival.
- Route shell wrapped in `<Suspense>` (Next.js 16 requirement for `useSearchParams`).
- Member display: `email.split("@")[0]` (Phase 4 had `userId.slice(0, 8)` — resolved here).
- CSV export adapted from `leads-table.tsx` `exportCSV()` pattern. Headers + Member column conditional on role.

### Merge mechanics

- Branch `feature/time-tracking-phase-4` accumulated 3 commits (Phase 4, fixback, Phase 4.5).
- Stage moved forward to `f7430c2` while we were working (Anish's PR #10 — contacts page + lead types + tags-restricted-to-education). Required a rebase before ff-merge.
- Rebase was clean — stage and phase-4 touched no overlapping files in practice. Force-pushed with `--force-with-lease`.
- One coordination hiccup mid-session: Opus did a hard reset on local feature/time-tracking-phase-4 (back to origin) WITHOUT knowing Sonnet had a local-only commit. That orphaned Sonnet's `24efdda`. Recovered via `git reset --hard <orphaned-sha>` — commit object was still in the object DB so nothing was lost. Lesson: always verify origin has the latest before hard-reset.

### Accounts IA pivot (decision recorded — code not yet written)

After 4.5 shipped, Sadin flagged that **Accounts** (the entity, not just the page) was unreachable from the sidebar. Opus initially proposed Option A: add tabs under Time Tracking (Timesheet | Accounts | Approvals). Sonnet built it (`feature/time-tracking-nav-tabs` @ `96fcaae`) — clean implementation, faithful to spec.

**Sadin pushed back before merge**: "Accounts is a CRM-level entity, not a Time Tracking sub-feature. In every CRM (Salesforce, HubSpot, Pipedrive, Zoho) it's top-level. Why am I burying it?" Opus agreed — the original framing was wrong. The URL `/time-tracking/accounts` was already a tell.

**Decision locked**:
- Discard the tabs branch (not merging)
- Promote Accounts to top-level sidebar (it-agency only, since other industries don't model B2B accounts today)
- Move pages from `/time-tracking/accounts/*` to `/accounts/*`
- Introduce `FEATURES.ACCOUNTS = "accounts"` — separate from `FEATURES.TIME_TRACKING`
- Re-gate all accounts/projects/tasks API routes via `FEATURES.ACCOUNTS`
- Reorganize industry module: `src/industries/it-agency/features/accounts/` (separate from `time-tracking/`)
- `/time-tracking` becomes a single page (no tabs); Approvals stays at `/time-tracking/approvals` reached via the Pending stat tile (already linked)
- Project detail page stays at `/time-tracking/projects/[id]` for now (a future refactor could nest it under accounts but that needs account_id URL propagation — defer)

This is the next thing to ship before Phase 5.

### Verification done in-session

- Phase 4 fixback: build clean, lint unchanged, admin smoke verified single approve + single reject + char counter + tooltip + edit-lock + timezone-fix "This week" count. **Not** verified: bulk approve/reject, non-admin permission gate, Admizz 404/403, TOCTOU race two-window.
- Phase 4.5: build clean, lint unchanged, admin smoke verified the team table renders with all expected columns (Time/Member/Account/Project/Task/Notes/Status/Actions), account name resolves via nested join, member shows as email-prefix, status badges + edit-lock both render correctly. **Not** verified: non-admin member view, Admizz 404 on /time-tracking, CSV export contents.
- Tabs branch: build clean, lint unchanged. Not smoke-tested visually (decided to discard before merge).

### Files Changed (Phases 4 + 4.5)

- **New (Phase 4)**: 2 API route files (`time-entries/[id]/approve`, `/reject`), full real implementation of `approvals-queue.tsx`.
- **New (Phase 4.5)**: `pages/timesheet.tsx` + 5 components (`timesheet-{filters,stats-cards,table,row}`, `log-time-dialog`) + 1 hook (`use-approve-reject`).
- **Modified**: 4 time-entries API routes (extended select for accounts join), `use-time-entries.ts` type, `app/(main)/(dashboard)/time-tracking/page.tsx` (Suspense wrapper + new component import), `approvals-queue.tsx` (consume shared hook).
- **Deleted**: `pages/time-tracking-home.tsx` (replaced by `timesheet.tsx`).
- **DB**: no changes (schema from Phase 1 covers everything).

### Not yet promoted to `main`

`main` (production) is still on the pre-everything version. The right time to promote is after the Accounts refactor lands + Phase 5 (rates + billable) ships, giving production a coherent Time Tracking v1. Until then everything sits on staging.

---

## Time Tracking — Phases 1–3 shipped via Opus/Sonnet split (2026-05-25, afternoon)

### What Was Built

The first `it_agency`-scoped feature shipped, in three deployable phases. **Workflow split: Opus planned + reviewed + pushed to stage; Sonnet executed feature code on per-phase feature branches.** Each phase ended with: Sonnet pushes feature branch → Opus reviews diff → Opus runs build/lint → Sadin verifies locally on dev server → Opus merges ff-only into stage + pushes + deletes feature branch + watches deploy.

Brief: `docs/TIME-TRACKING-BRIEF.md` (370+ lines; locked the data model, API surface, UI surface, 5-phase plan, verification).

### Phase 1 — Schema + manifest scaffolding (commits `bea578c`, `5153087`)

- **Migration 020_time_tracking.sql** — created 4 tenant-owned tables (`accounts`, `projects`, `tasks`, `time_entries`), extended `tenant_users.default_hourly_rate` and `leads.account_id`. RLS policies per the brief: admin-only mutations on accounts/projects/tasks; time_entries is the exception (members SELECT all-in-tenant + INSERT/UPDATE own-pending; admins update any; DELETE admin-only at DB layer). Indexes (partial + composite) per brief. Applied to staging DB live via psql.
- **Trigger fix-back** (Opus caught it on review): Sonnet's initial migration missed `updated_at` triggers — every other tenant-owned table in the codebase has `trigger_<table>_updated_at BEFORE UPDATE ... EXECUTE FUNCTION update_updated_at()`. Sonnet amended the migration on the same branch (`5153087`). The `update_updated_at()` function already exists in the DB (verified pre-commit).
- **Manifest wiring**: `FEATURES.TIME_TRACKING = "time-tracking"` added to `_registry.ts`. `industries/it-agency/manifest.ts` populated with `timeTrackingMeta` + sidebar entry. `INDUSTRY_ICONS["Clock"]` registered in `shell.tsx`.
- **Five thin route shells** under `src/app/(main)/(dashboard)/time-tracking/{page.tsx, accounts/{page.tsx, [id]/page.tsx}, projects/[id]/page.tsx, approvals/page.tsx}` — each calls `getCurrentUserTenant → redirect/login → getFeatureAccess → notFound → delegate to industry page component`. Placeholder components rendered "Coming soon — Phase N".
- **Type system** extended in `src/types/database.ts` with `Account`, `Project`, `Task`, `TimeEntry`, `ProjectStatus`, `TaskStatus`, `ApprovalStatus` + `Lead.account_id` + `TenantUser.default_hourly_rate`.

### Phase 2 — Accounts + Projects + Tasks CRUD (commit `32b4615`)

- **7 API routes** under `src/app/(main)/api/v1/{accounts, projects, tasks}/...` — full CRUD for the three entity types. All routes: industry gate → admin gate (for mutations) → `scopedClient(auth)` → `validate()` body checks → audit log + event emission. `.update()` / `.delete()` chains `.eq("id", id)` per the wrapper's discipline rule. Project POST verifies the account belongs to this tenant via scopedClient before linking.
- **`AccountsListPage`** (`accounts-list.tsx`) — Card list with active/inactive indicator, project-count rollup batched via `.raw().in("account_id", [...])`. Empty state + admin gate on Create/Edit/Delete buttons.
- **`AccountDetailPage`** — account header, linked lead-contacts read-only list, projects list with inline create-project form.
- **`ProjectDetailPage`** — project header, tasks list with inline create + `TaskRow` edit-in-dialog + delete-with-confirm + hover-reveal action icons.
- **Components**: `AccountForm`, `ProjectForm`, `TaskRow`, `StatusBadge` (Project + Task + Approval variants). All shadcn-based.
- **Tenant isolation verified**: as Admizz, `/time-tracking/accounts*` → 404 and `/api/v1/accounts` etc. → 403. As Zunkireelabs IT, full CRUD works end-to-end.

### Phase 3 — Time entries log + list + edit + timezone fix (commits `b989d05`, `5dc4410`)

- **2 API routes** under `src/app/(main)/api/v1/time-entries/{route.ts, [id]/route.ts}`:
  - `GET /time-entries`: non-admins auto-scoped to own entries (`userIdParam = isAdmin ? param : auth.userId`). Filters: `project_id`, `approval_status`, `from`/`to` date range with regex validation. Returns entries with `projects(id, name, account_id), tasks(id, title)` joins.
  - `POST /time-entries`: server-side `user_id = auth.userId` (no impersonation). Verifies project belongs to tenant; if task_id given, verifies task belongs to project. `is_billable` denormalized from task (else project) at create time. `approval_status: 'pending'`, `rate_snapshot: null`.
  - `PATCH/DELETE /time-entries/[id]`: `canEdit(auth, entry)` helper — admin OR (own + pending). PATCH supports `entry_date`, `minutes`, `notes`, `project_id`, `task_id` (with cross-table validation when project/task changes).
- **`TimeTrackingHomePage`** (replaces the Phase 1 placeholder): "This week" total in header. Inline add form (not dialog — better UX for high-frequency use). Week-grouped → day-grouped → entries list with per-day totals. Collapsible Filters bar with Project / Date-range / Team-member (admin only) controls. Default 4-week window.
- **`TimeEntryAddForm`** — cascading Project → Tasks dropdown, single-project auto-select, minutes→hours live preview ("= 1h 30m"). Form resets keep project + date for quick repeat logging.
- **`TimeEntryRow`** — hover-reveal edit/delete icons; edit dialog allows minutes + notes only.
- **`use-time-entries` hook** — ISO-week grouping, optimistic CRUD callbacks, `JSON.stringify(filters)` dep stability.

**Timezone bug caught + fixed (commit `5dc4410`)**: Original code used `d.toISOString().split("T")[0]` for date-string conversion. In UTC+5:45 (Nepal), local midnight = 18:15 UTC the previous day → date strings shifted back by 1 → week labels read "WEEK OF MAY 17 – MAY 22" while containing Sunday May 24. **Fix**: new shared helper `src/lib/date.ts → toLocalDateString(d)` using `getFullYear/getMonth/getDate`; applied across `use-time-entries.ts`, `time-entry-add-form.tsx`, `time-tracking-home.tsx`. Data was always correct (DB stores `entry_date` as DATE; grouping was consistent across the bug); only the human-readable label was off.

### Verification per phase

Each phase: build clean → lint 0 errors → 3 successful staging deploys (`5153087` Phase 1, `32b4615` Phase 2, `5dc4410` Phase 3 with fix), all returning HTTP 200 on healthcheck. Manual UI: Sadin verified both as Zunkireelabs (IT) and Admizz (Education) for each phase. Tenant isolation confirmed at sidebar, route, and API level on every check.

### Workflow discipline that emerged

- **Branch sync precondition**: Sonnet branches from latest `stage` for each phase.
- **`scopedClient` discipline**: every new authenticated route uses `scopedClient(auth)`. The wrapper auto-injects tenant_id and strips it from update/insert payloads.
- **Local-verify-before-push** (added mid-Phase-1, formalized in Phase 2): Opus runs the dev server, Sadin verifies in browser, **then** Opus merges + pushes. Caught the timezone bug before it hit staging.
- **Fix-back loop**: when Opus catches an issue, Sonnet amends on the same feature branch (don't open a new branch per fix).
- **No Sonnet → stage**: Sonnet pushes feature branches only. Stage merge is Opus's gate.

### Files Changed (Phases 1–3 total)

- **New**: `supabase/migrations/020_time_tracking.sql`, `src/lib/date.ts` + `src/industries/it-agency/features/time-tracking/{meta.ts, pages/* (5), components/* (7), hooks/use-time-entries.ts}` + 9 API route files under `src/app/(main)/api/v1/{accounts, projects, tasks, time-entries}/...` + 5 thin page shells under `src/app/(main)/(dashboard)/time-tracking/`.
- **Modified**: `src/industries/_registry.ts` (add `TIME_TRACKING`), `src/industries/it-agency/manifest.ts` (populate features + sidebar), `src/components/dashboard/shell.tsx` (Clock icon registry), `src/types/database.ts` (Account/Project/Task/TimeEntry types + Lead.account_id + TenantUser.default_hourly_rate), `docs/FEATURE-CATALOG.md` (TIME_TRACKING row).
- **DB**: migration 020 applied live (4 tables + 4 triggers + 2 ALTERs + 7 indexes verified via psql).

### Open for Phase 4 (Sonnet currently working)

- 2 new endpoints (approve + reject)
- Real `ApprovalsQueuePage`
- Status badges on `TimeEntryRow`
- Hide edit/delete on locked entries
- Bulk-approve via `Promise.allSettled`

ETA ~0.5 day. Same review pattern.

### Open for Phase 5

Per-member default rates + per-project override + rate snapshot on approval + billable totals. The brief has the full spec. ~1 day estimate.

---

## Industry Modules — Hardening, Onboarding, First External Adaptation (2026-05-25)

### What Was Built

Continuation of the previous day's industry-module foundation work. Three distinct slices, all shipped to `origin/stage` and verified on staging.

#### 1. Code-review-driven hardening (commits `a4bfc81`, `8d9d438`)

Internal code review surfaced 15 findings on yesterday's foundation work. The most severe got fixed in this round; the rest documented for ongoing follow-up.

- **`a4bfc81` (RSC boundary fix)**: `SidebarItem.icon` was typed as `LucideIcon` (a React component). Server Components cannot pass non-serializable values to Client Components → dashboard crashed for education tenants. Changed to `icon: string` (name), with `INDUSTRY_ICONS` registry in `shell.tsx` resolving names to components on the client side.
- **`8d9d438` (security + correctness)**:
  - `scopedClient.update()` / `.insert()` now strip caller-supplied `tenant_id` via `stripTenantId()` helper — closes a cross-tenant-escape hole where a malicious or buggy caller could `update({ tenant_id: 'OTHER' })` to move rows between tenants.
  - `scopedClient.select()` accepts the `(columns, options)` overload so `count: "exact"` / `head: true` queries don't have to drop to `db.raw()` and lose tenant scoping.
  - New `db.fromGlobal(table)` escape for tables without `tenant_id` (auth.users, system tables).
  - `authenticateRequest()` now defensively handles both array and object shapes for the `tenants(industry_id)` embed — prevents a silent site-wide `industryId: null` if PostgREST's schema cache flips or the FK relationship is renamed.
  - `getManifest(null)` now falls back to `general` instead of returning null — legacy NULL-industry tenants are no longer locked out of every feature.
  - `getFeatureAccess()` / `getFeatureConfig()` `featureId` param tightened from `string` to `FeatureId` union — typos caught at compile time. Defense in depth: gate now also verifies `meta.industries.includes(industryId)` so a feature accidentally registered in the wrong manifest is rejected.
  - `getIndustrySidebarItems()` filters out items whose featureId isn't in the manifest's `features` array — catches sidebar/features drift inside a manifest.
  - Re-migrated notifications unread-count back through scopedClient (via the new options overload). Migrated team `DELETE` handler to scopedClient.
  - Documented `scopedClient.update()/.delete()` discipline rule loudly: caller MUST chain at least one additional filter, or the operation targets every row in the tenant.

Remaining ~33 legacy routes still on raw `createServiceClient()` + manual `.eq("tenant_id", ...)` — tracked on STATUS-BOARD as ongoing hardening.

#### 2. Onboarding & developer-facing docs (commits `38be5fe`, `4368244`)

- **`38be5fe` (migration playbook)**: new subsection in CLAUDE.md § Industry Scoping Rules — "Migrating an existing flat-pattern feature into the new structure." 10-step checklist covering branch sync, file moves, meta creation, manifest registration, replacing inline guards with the loader pattern, `scopedClient` adoption, and verification. Plus two "common pitfalls" callouts (icon-as-string for RSC boundary, scopedClient delete/update filter requirement).
- **`4368244` (architecture explainer)**: new `docs/reference/01-ARCHITECTURE-INDUSTRY-MODULES.md` — visual ASCII diagrams comparing the old flat `src/features/<f>/` pattern vs the new `src/industries/<id>/features/<f>/` pattern. Covers directory layout, the 3-places gating problem the old pattern had, parallel-work merge conflicts on `shell.tsx`, the three feature categories (universal / industry-scoped / shared), the decision tree, and the scaling story at 2 / 5 / 20 industries. Linked from CLAUDE.md in two places (the top of Industry Scoping Rules + the "Read first, every session" list) so any new dev (human or Claude) lands on it before touching `src/industries/`.

The combined effect: a fresh Claude session on a clone gets `CLAUDE.md` auto-loaded → points to the architecture doc → which explains the *why* → and the rules section has the *what to do*. No tribal knowledge required.

#### 3. First external adaptation: Anish's `view-details` branch (commits `c64936e`, `b865cf0`, `41bddae`, `dccdb18`)

Anish pushed `origin/view-details` with 3 commits built against the OLD flat pattern (branched from `a627103`, before the industry-module work). Test of the migration playbook in practice.

- **Strategy**: created `adapt/view-details` off latest `origin/stage`, cherry-picked Anish's 3 commits, let git's rename detection port `src/components/dashboard/check-in-page.tsx` → `src/industries/education-consultancy/features/check-in/ui.tsx` automatically.
- **All 3 cherry-picks landed clean** — git auto-detected the rename and applied each diff to the new file location with zero manual conflict resolution. The migration playbook's claim (rename detection usually handles the move) was validated.
- **Features adapted**: View Details panel on check-in page (right-side panel with lead details + Check In button), Student/Parent tag system on leads (table column + filter + CSV export + API + check-in flow tag selector).
- **Schema drift caught and closed (commit `dccdb18`)**: Anish's "tags" feature added a `tags TEXT[]` column to `leads` directly via Supabase MCP without committing the migration file. Backfilled as `supabase/migrations/019_lead_tags.sql` with `IF NOT EXISTS` guards (no-op against the live DB but ensures fresh installs get the same schema).
- **Scope decision recorded**: Student/Parent labels are hardcoded education-specific for v1. Tag column on leads is universal infrastructure; if/when a 2nd industry wants tags, the tag UI promotes to `_shared/` with per-industry config (labels, colors). Not blocking — STATUS-BOARD follow-up.
- **Workflow**: adapter branch fast-forwarded into `stage`, branches cleaned up locally + remote (`adapt/view-details` and Anish's `view-details` both deleted).
- **Onboarding prompt for Anish** drafted in session — when he pulls `stage`, he reads `CLAUDE.md` + the architecture doc + the migration playbook before starting his next feature. His Claude gets the same context if he pastes the prompt as his first turn.

### Verification

All three slices landed via the same flow: build clean → push to stage → GitHub Actions auto-deploy → `https://dev-lead-crm.zunkireelabs.com/login` returned HTTP 200 each time. Three successful staging deploys today.

### Files Changed (high level)

- **Modified**: `CLAUDE.md` (migration playbook + architecture doc links), `src/lib/api/auth.ts` (defensive embed), `src/lib/supabase/scoped.ts` (security hardening + options overload + fromGlobal), `src/industries/_loader.ts` (general fallback + type tightening + sidebar filter), `src/components/dashboard/shell.tsx` (icon registry), `src/industries/_types.ts` (icon: string), `src/industries/education-consultancy/manifest.ts` (icon: string), `src/components/dashboard/leads-table.tsx` (tag column + filter + CSV), `src/types/database.ts` (Lead.tags), three leads API routes (accept tags), public submit route (default tag).
- **New (Anish's work, adapted)**: View Details panel + Student/Parent tag UI in `src/industries/education-consultancy/features/check-in/ui.tsx`.
- **New (infra/docs)**: `docs/reference/01-ARCHITECTURE-INDUSTRY-MODULES.md`, `supabase/migrations/019_lead_tags.sql`.

### Carried Over to Production (`main`) — NOT yet

All of today's work is on `stage` only. Production deploy requires the standard `git checkout main && git merge stage && git push origin main` flow once staging verification is complete.

---

## Industry Modules — Path C Foundation + Hardening Rails (2026-05-24)

### What Was Built

The first-class industry module system. `industry_id` graduated from "decorative column that relabels things" to "architectural concept that gates features, drives sidebar, and reserves AI hook points." Anish's form-builder and the previously-universal student check-in were both migrated into the new `src/industries/education-consultancy/features/` home.

### Architecture (Path C)

```
src/
├── app/(main)/(dashboard)/          ← Universal features stay here (leads, pipeline, team, settings, dashboard)
├── components/dashboard/             ← Universal components
└── industries/                       ← NEW first-class concept
    ├── _registry.ts                    type-safe FEATURES + INDUSTRIES ID constants
    ├── _types.ts                       IndustryManifest, FeatureMeta, SidebarItem types
    ├── _loader.ts                      manifest reader + getFeatureAccess (the gate truth)
    ├── _shared/                        cross-industry shared features (empty stub today)
    ├── education-consultancy/
    │   ├── manifest.ts                  features + sidebar + AI config
    │   ├── features/
    │   │   ├── check-in/                MOVED from src/components/dashboard/check-in-page.tsx
    │   │   └── form-builder/            MOVED from src/features/form-builder/ (was Anish's flat-pattern home)
    │   └── ai/agent.ts                  AI config stub
    ├── it-agency/manifest.ts            empty stub (Sadin's territory)
    └── {construction,real-estate,healthcare,recruitment,general}/manifest.ts  empty stubs
```

### Decisions locked in during planning

- **Tenant model = A**: one tenant = one industry. Hybrid orgs run multiple tenants. Not multi-industry-per-tenant.
- **Path C**: industry modules for industry-scoped code; universal stays in `src/app/` and `src/components/dashboard/`. Two homes.
- **Gate strength = hide entirely**: sidebar item hidden, route 404, API 403. No upsell messaging for mismatched industry.
- **Refactor Anish's form-builder**: yes, brought into new structure as second inhabitant of `education-consultancy/features/`. Lead architect's call.
- **Promote, don't copy**: shared features move to `_shared/`; never copy-paste between industry folders.
- **Hardening = ongoing**: introduce `scopedClient(auth)` wrapper + migrate 2 routes as proof; ~35 legacy routes tracked for future migration on STATUS-BOARD.

### Files: new (15)

- `src/industries/_types.ts`
- `src/industries/_registry.ts`
- `src/industries/_loader.ts`
- `src/industries/_shared/README.md`
- `src/industries/education-consultancy/manifest.ts`
- `src/industries/education-consultancy/ai/agent.ts`
- `src/industries/education-consultancy/features/check-in/meta.ts`
- `src/industries/education-consultancy/features/form-builder/meta.ts`
- `src/industries/{it-agency,construction,real-estate,healthcare,recruitment,general}/manifest.ts` (6 stubs)
- `src/lib/industries/gate.ts` — `requireIndustry()` helper
- `src/lib/supabase/scoped.ts` — `scopedClient(auth)` wrapper
- `docs/INDUSTRY-MODULES-BRIEF.md` (in-flight; archived after this ships)
- `docs/FEATURE-CATALOG.md` — human-readable feature/industry catalogue

### Files: moved (with `git mv`, history preserved)

- 17 files from `src/features/form-builder/**` → `src/industries/education-consultancy/features/form-builder/**`
- `src/components/dashboard/check-in-page.tsx` → `src/industries/education-consultancy/features/check-in/ui.tsx`
- `src/components/dashboard/check-in-detail-page.tsx` → `src/industries/education-consultancy/features/check-in/detail-ui.tsx`

### Files: modified

- `CLAUDE.md` — major restructure. Replaced "Industry Feature Development" section with comprehensive Industry Scoping Rules. Added Tenant Isolation Rules + new feature checklist. Added scopedClient to Supabase Client Usage. Updated form-builder path. Updated Known Issues.
- `src/lib/api/auth.ts` — added `industryId: string | null` to `AuthContext`; `authenticateRequest()` now joins `tenants.industry_id`.
- `src/components/dashboard/shell.tsx` — dropped `BASE_NAV_ITEMS`/`EDUCATION_NAV_ITEMS` ternary; sidebar now reads `industrySidebarItems` prop merged with universal top/bottom items.
- `src/app/(main)/(dashboard)/layout.tsx` — threads `industrySidebarItems` from `getIndustrySidebarItems(industry_id)` into the shell.
- `src/app/(main)/(dashboard)/check-in/page.tsx` + `[id]/page.tsx` — thin shells: `getFeatureAccess()` → `notFound()`, delegate to UI in industry folder.
- `src/app/(main)/(dashboard)/forms/page.tsx`, `new/page.tsx`, `[id]/page.tsx` — same pattern; inline industry guards replaced with loader gate.
- 4 check-in API routes (`/api/v1/check-ins`, `/leads/check-in`, `/leads/[id]/check-in`, `/leads/[id]/check-ins`) — added `getFeatureAccess()` guard. Previously had **no industry gate at all** — IT-agency tenants could hit them.
- 3 form-config API routes (`/api/v1/form-configs`, `[id]`, `[id]/duplicate`) — added `getFeatureAccess()` guard. Page-level guard was already present; API-level was not.
- `src/app/(main)/api/v1/team/route.ts` (GET handler), `src/app/(main)/api/v1/notifications/route.ts` — migrated to `scopedClient(auth)` as proof of the hardening pattern.

### Why it matters

1. **Parallel multi-developer multi-industry work**: Sadin on `industries/it-agency/`, Anish on `industries/education-consultancy/` — zero shared-file conflicts. The old ternary in `shell.tsx` was the merge-conflict point of the previous pattern.
2. **Cross-industry feature sharing without duplication**: when a 2nd industry wants a feature, promote via `_shared/`, opt-in per manifest with per-industry config. The decision tree lives in CLAUDE.md.
3. **Single enforcement point**: `getFeatureAccess()` in `_loader.ts` is the truth. Change it once, sidebar/route/API all respect it.
4. **AI per-industry has a home now**: `industries/<id>/ai/agent.ts` slots are reserved. Future per-industry prompts/tools land there.
5. **Hardening: cross-tenant leaks one less risk**: `scopedClient(auth)` makes the tenant filter automatic. Two routes migrated, ~35 legacy routes documented for migration. Future routes default to the safe pattern.

### Verification

- `npm run build` — clean compile, all 43 routes generated, no errors.
- `npm run lint` — 8 warnings (all pre-existing or in unused-import line that was already present); 0 errors.

### Open items (now on STATUS-BOARD)

- Migrate remaining ~35 authenticated routes to `scopedClient(auth)`.
- Build actual per-industry AI prompts/tools (currently `agent.ts` stubs are empty).
- Wire `events` → webhook dispatcher (separate concern, not part of this work).
- First real industry-scoped feature for `it-agency` to validate the parallel-work claim end-to-end.

---

## Post-Phase 2A — Shipped Work Backfill (March–May 2026)

> **Discipline gap acknowledged**: between Phase 2A (Feb 21) and the doc reorg (May 24), shipped work landed without SESSION-LOG entries. This is a lightweight backfill written 2026-05-24 by reading PRs and commits — git log has the *what*, this entry captures the *why* before it decays. Detail is deliberately shallower than dedicated entries.

Shipped via PRs #4–#8 and direct-to-`stage` commits `f728ca8` → `b890c35`. Migrations `009`–`018` all landed in this window.

### Cluster 1 — Phase 2B-equivalent UI work (PRs #4–#7, April 9–10)

- **PR #4** (`3d08808`): User assignment UI on top of the Phase 2A backend. Four phases in one PR — invite flow with registration + token validation, bulk assign API + assign button + horizontal-scroll fix on the leads table, in-app notification dropdown with real-time polling, and Resend email notifications for invites and assignments (single + bulk).
- **PR #5** (`cf908aa`): Dashboard UI brought in line with the Zunkireelabs design system (the "agentic-commerce" reference). Table corners, pagination placement, per-page dropdown, sidebar/header polish.
- **PR #6** (`336dddc`): Truncated table cells with conditional tooltip (tooltip only fires when content is actually truncated, not always).
- **PR #7** (`7280831`): Bulk-action bar redesign with motion.

**Why**: The "Phase 2B" backlog from the Phase 2A entry (assignment UI, counselor-scoped view, invites UI) is now satisfied via these PRs. Treat that backlog as done unless you find a missing item in the lead-detail UI — `lead-detail.tsx` is the canonical place to check.

**Migrations from this window**: `015_notifications.sql` (in-app notification storage), plus design-system-driven schema tweaks `010`–`012`.

### Cluster 2 — Multi-pipeline + pipeline management (PR #8, April 12)

- **PR #8** (`a3e0ed2`, migration `016_multi_pipeline.sql`): Replaces the single-pipeline-per-tenant assumption from Phase 2A. New `pipelines` table; `pipeline_id` added to both `pipeline_stages` and `leads`; `terminal_type` (`won`/`lost`) on stages to distinguish conversion outcomes. New UI: `PipelineSelector` (pill dropdown), `PipelineSettingsModal`, `CreatePipelineModal` (default / copy / empty templates), `StageEditor` with drag-drop reorder. Selected pipeline persisted to `localStorage`.

**Why**: Phase 2A modeled pipeline as a flat list of stages per tenant. Multiple lead types (e.g., undergrad vs. post-grad consultancy flows) needed distinct stage sets — hence a `pipelines` layer above stages. **Anyone touching `pipeline_stages`, `stage_id` on leads, or the Kanban board must include `pipeline_id` in the model now.** Read migration 016 and `PipelineSelector.tsx` before editing.

Other migrations in adjacent commits: `009_multi_form_support` (multiple forms per tenant), `013_lead_insights` (AI insight scaffolding from the research dir — partial), `014_lead_activities` (timeline data model).

### Cluster 3 — Move-to-pipeline + email auto-forward + Gmail (`f728ca8`, May 4)

- `MoveToPipelineModal.tsx` (447 LOC) — drag-or-modal-driven moves between pipelines.
- Gmail OAuth per-tenant via `/api/v1/settings/email-accounts/gmail/auth` + `callback`; connected accounts stored in migration `018_connected_email_accounts.sql`.
- Email auto-forward rules (migration `017_email_forward_rules.sql`): tenant-defined rules that turn inbound emails into leads or routed messages. Manager UI: `email-rules-manager.tsx` (537 LOC). Send via `smtp-sender.ts`, forwarding logic in `email-forward.ts`.
- AI chat route stub `/api/v1/ai/chat` — entry point for the AI orchestration work the `archive/research/ai-insight-*` docs sketched.
- **Route group restructure**: API routes moved under `src/app/(main)/api/...` to share a `(main)` layout with dashboard pages. **If a route 404s after this commit, check whether it should live under `(main)/`.**

**Why**: Email is the second inbound channel for leads after public forms — particularly for education consultancies that already field inquiries via Gmail. The Gmail connection is per-tenant (OAuth), not app-level. The AI chat route was scaffolded here but its real implementation is downstream.

### Cluster 4 — Student check-in system (`974d1b0`, May 5)

- New top-level dashboard route `/check-in` with search, history list, and per-student detail page.
- API: `/api/v1/check-ins` (list), `/api/v1/leads/[id]/check-in[s]` (record + list per lead).
- Components: `check-in-page.tsx` (696 LOC), `check-in-detail-page.tsx`, sidebar link in `shell.tsx`.

**Why**: First vertical-specific feature — education consultancies running physical events / counselling sessions need to mark that a lead showed up, with timestamp + history. **Not gated by tenant type**, so it shows for every tenant. If onboarding a non-education vertical, consider a feature flag.

### Cluster 5 — Phone country-code work (`38aa1b9`, `816153e`, `3d7386f`, `b890c35`, May 13–18)

- New `phone-input.tsx` (country-code selector + number input) used on public form, add-lead sheet, lead detail, and check-in flows.
- New libs: `country-codes.ts` (dial code table), `phone-utils.ts` (parse/format helpers — `formatPhoneWithCountryCode()` is the canonical formatter).
- Two follow-up fixes (`3d7386f`, `b890c35`): country code kept getting dropped on partial form submissions and on API-created leads — fixed in form component and in the leads POST handler.
- Side feature (`816153e`): lead source column now visible in leads table + CSV export.

**Why**: International applicants — Indian consultancies handling leads from multiple countries needed country code as part of identity, not cosmetics. The two fixes show how easy it is to lose the country code along submission paths: **always route phone fields through `formatPhoneWithCountryCode()` in `phone-utils.ts` rather than concatenating raw strings.**

### What this entry deliberately does NOT cover

- Per-migration deep-dives for `009`–`018` — read the SQL directly if working on schema. The clusters above name the migrations relevant to each.
- **PR #9** ("form builder for education consultancy", merged 2026-05-21, commit `7afa0e7`) — landed *after* the window above and is not yet on `stage`'s 7-commit lag. Needs its own entry once current state is verified.
- The 3 unmerged local-only commits — minor ci + style fixes; will resolve on next push/rebase.

### Files Changed (summary)

PRs #4–#8 + direct commits `f728ca8` → `b890c35`. Highlights:
- **New components**: `MoveToPipelineModal`, `email-rules-manager`, `check-in-page`, `check-in-detail-page`, `phone-input`, `PipelineSelector`, `PipelineSettingsModal`, `CreatePipelineModal`, `StageEditor`, bulk action bar
- **New libs**: `email-forward`, `smtp-sender`, `country-codes`, `phone-utils`
- **New API routes**: `pipelines/*`, `pipelines/[id]/stages/*`, `ai/chat`, `settings/email-accounts/*`, `settings/email-rules/*`, `check-ins/*`, `leads/[id]/check-in[s]`, bulk-assign, invites accept/registration
- **Migrations**: `009_multi_form_support` → `018_connected_email_accounts` (10 migrations)

---

## Phase 2A — SaaS Operational Layer (February 21, 2026)

### What Was Built

Built the full operational layer: lead assignment, counselor role, dual-mode pipeline stages, invite system, checklists, and intake tracking. All backend/API — no UI changes (that's Phase 2B).

#### 1. Database Migration (`003_phase2a_saas_ops.sql`)
- **`stage_id`** on leads — FK to `pipeline_stages`, backfilled from `status` slug for all 10 existing leads
- **`assigned_to`** on leads — FK to `auth.users`, indexed where `deleted_at IS NULL`
- **Intake fields** — `intake_source`, `intake_medium`, `intake_campaign`, `preferred_contact_method`
- **Counselor role** — expanded `tenant_users` check constraint to include `'counselor'`
- **`invite_tokens` table** — email, role, token, expiry, RLS for admin-only SELECT
- **`lead_checklists` table** — per-lead checklist items with position, completion tracking, RLS for tenant members
- **`get_user_tenant_role()`** — SECURITY DEFINER helper function

#### 2. Type System Updates (`src/types/database.ts`)
- `UserRole` union: added `"counselor"`
- `Lead.status`: changed from `LeadStatus` to `string` (pipeline stages are dynamic)
- `Lead` interface: added `stage_id`, `assigned_to`, intake fields
- New interfaces: `InviteToken`, `LeadChecklist`
- `LeadStatus` type kept for backward compat (dashboard color maps)

#### 3. Auth Layer (`src/lib/api/auth.ts`)
- **`authenticateUser()`** — lightweight JWT-only auth, no tenant required (for invite accept flow)
- **`requireLeadAccess(auth, lead)`** — admin OR (counselor AND assigned_to match)
- **`isCounselorOrAbove(auth)`** — owner, admin, or counselor (distinguishes from viewer)

#### 4. Validation (`src/lib/api/validation.ts`)
- **`optionalMaxLength(n)`** — returns null if empty, else checks length

#### 5. Queries (`src/lib/supabase/queries.ts`)
- `getCurrentUserTenant()` — now returns `userId` alongside tenant/role
- `getLeads()` — accepts optional `{ role, userId }` for counselor scoping
- `getLead()` — same counselor scoping
- `getLeadChecklists()` — new, ordered by position

#### 6. Updated Leads API (`src/app/api/v1/leads/`)

**GET /api/v1/leads**:
- `assigned_to` query param filter
- Counselor auto-scoping: forces `assigned_to = auth.userId`

**POST /api/v1/leads**:
- Accepts intake fields
- Always resolves `stage_id` from status slug — rejects 422 if no matching stage
- No lead can be created with `stage_id = NULL`

**GET /api/v1/leads/[id]**:
- Counselor scoping: 404 if not assigned

**PATCH /api/v1/leads/[id]**:
- Access: `requireLeadAccess()` replaces `requireAdmin()`
- `ADMIN_ONLY_FIELDS = ["assigned_to"]` — counselor submitting → 403
- Dual-mode stage resolution:
  - `status` only → resolves `stage_id` from pipeline_stages
  - `stage_id` only → resolves `status` slug from pipeline_stages
  - Both → 422
- `assigned_to` validation: must be tenant member, checked on every PATCH
- Emits `lead.assigned` event on assignment change

**DELETE**: unchanged (admin only)

#### 7. Invite API (`src/app/api/v1/invites/`)

**POST /api/v1/invites** (admin only):
- Creates invite with 7-day expiry, crypto.randomUUID() token
- Checks: no existing member, no pending invite for same email

**GET /api/v1/invites** (admin only):
- Returns pending (unaccepted, unexpired) invites

**POST /api/v1/invites/accept** (authenticated, no tenant required):
- Uses `authenticateUser()` — user may not have a tenant yet
- Validates: token exists, not expired, email matches JWT, not already member
- Creates `tenant_users` record, marks invite accepted

**DELETE /api/v1/invites/[id]** (admin only):
- Hard deletes invite

#### 8. Checklist API (`src/app/api/v1/leads/[id]/checklists/`)

**GET** (lead-access scoped):
- Returns checklists ordered by position
- 404 if lead is soft-deleted

**POST** (admin only):
- Creates checklist item with title, position

**PATCH /checklists/[checklistId]** (lead-access scoped):
- Counselor: can only toggle `is_completed`
- Admin: can also update `title`, `position`
- Auto-sets `completed_at`/`completed_by` on completion, clears on uncompletion

**DELETE** (admin only):
- Hard deletes checklist item

#### 9. Dashboard Pages
- `dashboard/page.tsx`, `leads/page.tsx`, `leads/[id]/page.tsx` — pass `role`/`userId` for counselor scoping
- `lead-detail.tsx`, `leads-table.tsx` — fixed `statusColors` typing from `Record<LeadStatus, string>` to `Record<string, string>` for dynamic stages

### Verification Results — 39/39 PASS

| Section | Tests | Result |
|---------|-------|--------|
| Migration | 7 | ✅ All pass — backfill, tables, RLS, constraints, function |
| Counselor Isolation | 5 | ✅ All pass — B can't see/get/patch A's leads, A can, admin sees all |
| Assignment Validation | 3 | ✅ All pass — non-member→422, viewer→allowed, counselor reassign→403 |
| Invite Flow | 5 | ✅ All pass — create, accept, re-accept→422, expired→422, existing member→409 |
| Checklist Security | 7 | ✅ All pass — admin create, counselor toggle, counselor can't edit title, viewer blocked, soft-delete→404 |
| Stage Integrity | 5 | ✅ All pass — invalid stage→422, invalid slug→422, both→422, 5 transitions consistent, stage_id→status |
| Regression | 5 | ✅ All pass — public form, rate limiting, audit logs, events, intake fields |
| Build | 3 | ✅ All pass — npm build, no TS warnings, Docker build |

### Files Changed

**New (7):**
- `supabase/migrations/003_phase2a_saas_ops.sql`
- `src/app/api/v1/invites/route.ts`
- `src/app/api/v1/invites/accept/route.ts`
- `src/app/api/v1/invites/[id]/route.ts`
- `src/app/api/v1/leads/[id]/checklists/route.ts`
- `src/app/api/v1/leads/[id]/checklists/[checklistId]/route.ts`
- `scripts/verify-phase2a.sh` (test script)

**Modified (9):**
- `src/types/database.ts`
- `src/lib/api/auth.ts`
- `src/lib/api/validation.ts`
- `src/lib/supabase/queries.ts`
- `src/app/api/v1/leads/route.ts`
- `src/app/api/v1/leads/[id]/route.ts`
- `src/app/(dashboard)/dashboard/page.tsx`
- `src/app/(dashboard)/leads/page.tsx`
- `src/app/(dashboard)/leads/[id]/page.tsx`
- `src/components/dashboard/lead-detail.tsx`
- `src/components/dashboard/leads-table.tsx`

### Design Decisions

1. **`assigned_to` allows any tenant member (including viewer)** — assignment is informational tracking, not access control. A viewer assigned to a lead can see it but can't modify it.
2. **Counselor gets 403 on PATCH (not 404)** when trying to update non-assigned lead fields — the lead exists (they passed access check for the lead itself), but the specific field is admin-only.
3. **`authenticateUser()` is separate from `authenticateRequest()`** — invite accept flow needs JWT validation without tenant membership (user has no tenant yet).
4. **Hard delete for invites and checklists** — these are operational data, not business records. No soft-delete needed.
5. **`stage_id` always resolved on POST** — enforces pipeline integrity from day one. No NULL `stage_id` on any new lead.

---

## Phase 1.5 — API-First Architecture (February 20–21, 2026)

### What Was Built
- RESTful API routes at `/api/v1/leads` and `/api/v1/leads/[id]` with full CRUD
- Pagination, search, status filter on GET
- Idempotency key support on POST (prevents duplicate leads)
- Soft deletes (`deleted_at` column) instead of hard deletes
- Audit trail (`audit_logs` table) — logs all mutations with changes diff
- Event system (`events` table) — emits `lead.created`, `lead.updated`, `lead.status_changed`, `lead.deleted`
- Pipeline stages (`pipeline_stages` table) — configurable per tenant, seeded with 5 defaults
- Status validation against pipeline stages (PATCH rejects invalid status slugs)
- Rate limiting on public form POST (in-memory, per tenant+IP)
- Structured logging via pino
- API response helpers (apiSuccess, apiError, apiPaginated, etc.)
- Request authentication via Supabase SSR cookies

### Migration: `002_phase1_5_foundation.sql`
- Added `deleted_at`, `idempotency_key` to leads
- Created `audit_logs`, `events`, `pipeline_stages` tables
- Seeded 5 default stages per tenant: new, partial, contacted, enrolled, rejected
- RLS on all new tables

---

## Phase 1 — Initial Build (February 20, 2026)

### What Was Built
Converted the single-client RKU scholarship lead system into a scalable multi-tenant SaaS product.

### Source Project
- **Location**: `/home/zunkireelabs/devprojects/hardik-dev-space/rku-dev/rku-form-prep/`
- **What it was**: Static HTML/JS scholarship form + admin dashboard for RK University
- **Backend**: Supabase (project ref: `ldsgsdjixzsljgkcktqu`)
- **Dashboard**: `leads-admin.zunkireelabs.com` (still running on Docker)

### Architecture
- Next.js 16 (App Router) + TypeScript + Tailwind v4 + shadcn/ui
- Supabase (PostgreSQL + Auth + Storage)
- Docker + Traefik deployment
- 5 tables with RLS using SECURITY DEFINER functions
- Dynamic multi-step public forms rendered from JSONB config
- Dashboard with stats, leads table, lead detail, settings

### Issues Fixed
1. **Docker SIGBUS** — .dockerignore + Node 22 + increased memory
2. **DNS mismatch** — `lead-crm` vs `leads-crm`
3. **Healthcheck** — `wget` to `127.0.0.1` instead of `localhost`
4. **RLS infinite recursion** — SECURITY DEFINER functions
5. **Public form 404** — anon SELECT policy on tenants
6. **Dashboard redirect loop** — show error instead of redirect

---

## What's NOT Built Yet

### Phase 2B (Next — UI for Phase 2A features)
- [ ] Invite management UI in Settings
- [ ] Lead assignment UI (dropdown in lead detail)
- [ ] Counselor-scoped dashboard view
- [ ] Checklist UI in lead detail
- [ ] Pipeline stage editor UI
- [ ] Intake source display in lead detail

### Future Phases
- [ ] User registration page
- [ ] Form field editor in Settings UI
- [ ] Tenant creation UI
- [ ] User management page
- [ ] Lead pagination / infinite scroll
- [ ] Lead sorting by column
- [ ] Lead import (CSV upload)
- [ ] Email notifications on new lead
- [ ] Webhook integrations
- [ ] Dark mode toggle
- [ ] Multi-form support per tenant
- [ ] Form analytics / conversion tracking

### Technical Debt
- [ ] Next.js 16 middleware → proxy migration (deprecation warning)
- [ ] Better error boundaries
- [ ] Loading skeletons
- [ ] Unit tests
- [ ] E2E tests (Playwright)
- [ ] CI/CD pipeline
- [ ] CSRF protection review

---

## File Reference

### Key Files to Read First
1. `CLAUDE.md` — project overview (loaded into system prompt)
2. `src/types/database.ts` — all TypeScript types
3. `supabase/migrations/001_initial_schema.sql` — base schema + RLS
4. `supabase/migrations/002_phase1_5_foundation.sql` — audit, events, pipeline
5. `supabase/migrations/003_phase2a_saas_ops.sql` — assignment, invites, checklists
6. `src/lib/api/auth.ts` — authentication + authorization helpers
7. `src/lib/supabase/queries.ts` — server-side data fetching
8. `src/app/api/v1/leads/route.ts` — leads API
9. `src/components/form/public-form.tsx` — dynamic form renderer
10. `docker-compose.yml` — deployment config

### Config Files
- `.env.local` — Supabase URL, keys, app URL (DO NOT COMMIT)
- `.mcp.json` — Supabase MCP connection string (DO NOT COMMIT)
- `next.config.ts` — standalone output, Supabase image domains
- `docker-compose.yml` — Traefik labels for `lead-crm.zunkireelabs.com`

---

## Deployment Steps

```bash
cd /home/zunkireelabs/devprojects/lead-gen-crm

# Rebuild and restart
docker compose up -d --build

# Check status
docker ps --filter name=leads-crm
docker logs leads-crm

# Run migration (if DB changes)
PGPASSWORD='H2a0r0d0ik#' psql "postgresql://postgres.pirhnklvtjjpuvbvibxf@aws-1-ap-south-1.pooler.supabase.com:5432/postgres" -f supabase/migrations/003_phase2a_saas_ops.sql
```

---

## Adding a New Client (Tenant)

```sql
-- 1. Create tenant
INSERT INTO tenants (name, slug, primary_color, config)
VALUES ('Client Name', 'client-slug', '#1a73e8', '{}');

-- 2. Create Supabase auth user (via API or dashboard)
-- Then link them:
INSERT INTO tenant_users (tenant_id, user_id, role)
VALUES ('<tenant-id>', '<auth-user-id>', 'owner');

-- 3. Create form config
INSERT INTO form_configs (tenant_id, name, is_active, branding, steps)
VALUES ('<tenant-id>', 'Lead Form', true,
  '{"title": "Apply Now", "primary_color": "#1a73e8"}'::jsonb,
  '[{"title": "Contact Info", "fields": [...]}]'::jsonb
);

-- 4. Pipeline stages auto-seeded (trigger in 002 migration)
-- 5. Form is live at: https://lead-crm.zunkireelabs.com/form/client-slug
```

### Adding a User via Invite (Phase 2A)

```bash
# Admin creates invite via API
curl -X POST https://lead-crm.zunkireelabs.com/api/v1/invites \
  -H "Content-Type: application/json" \
  -H "Cookie: <admin-session-cookie>" \
  -d '{"email":"user@example.com","role":"counselor"}'

# Response includes token — share with user
# User signs up in Supabase, then accepts:
curl -X POST https://lead-crm.zunkireelabs.com/api/v1/invites/accept \
  -H "Content-Type: application/json" \
  -H "Cookie: <user-session-cookie>" \
  -d '{"token":"<invite-token>"}'
```
