# Feature Roadmap

> Forward-looking pipeline of features by state. Companions:
> - **`docs/FEATURE-CATALOG.md`** — features that already exist in code (current state).
> - **`docs/SESSION-LOG.md`** — session-by-session history of what shipped and when.
> - **`docs/STATUS-BOARD.md`** — open user-side decisions / blockers (not features per se).
>
> Move entries between sections as their state changes. Cross-reference shipped features to their SESSION-LOG entry and commit SHA, then keep them in `## ✅ Shipped` here only briefly before relying on FEATURE-CATALOG as the source of truth.

Last updated: 2026-07-10 (it_agency Delivery **Tiers 0–4 batch BUILT ON BRANCH** `feature/it-agency-delivery-tier0` — 12 commits, migs 129–135 local-only, PR #160 held at the merge gate; **all pending merge to stage.** Per-tier record in memory `project_it_agency_delivery_workflow`. Prior: 2026-07-09 Phase 1+1.5 shipped to stage.)

---

## 💡 Ideas (raw — not yet approved)

Cheap to add, cheap to drop. One-line per idea. If an idea matures, promote it to "Approved for dev" with a paragraph of intent.

_(empty — add items here as they come up)_

---

## 🟢 Approved for dev (intent captured, awaiting pickup)

Sadin signed off on building this. Has at least a paragraph of intent. Ready for planning when picked up.

### Dashboards as a "Business OS" — IA + data-gap backlog (approved as direction 2026-07-12)

**Vision:** dashboards are the **bird's-eye cockpit of a business operating system** — a CEO/owner opens the dashboard view and sees every movement in the business (demand → sales → delivery → people → money) in one place, to plan/execute/run the company on data. Umbrella plan: `~/.claude/plans/you-had-given-me-magical-sparrow.md`. Built on the `_shared` insights engine so the IA templates across industries.

**Target IA (per industry):** 🏠 Home = personal "My Work" strip · **Company Overview** (exec bubble-up tiles) · **Sales & Outreach** (CRM funnel) · **Delivery/Ops** (delivery cockpit). Rule: every dashboard is company-scope, never `userId`-scoped; personal widgets live only on Home.

**Build phases (it_agency first, then Education):** Phase 0 clean Delivery + personal→Home · Phase 1 Sales & Outreach · Phase 2 Delivery controls · Phase 3 Company Overview · Phase 4 Education replication · Phase 5 = close the gaps below.

**🔒 Data-gap backlog (Phase 5 — widgets we can't render until the plumbing exists):**
- **G1 — Stage history / cohort conversion / days-in-stage.** Leads store only current `stage_id`; no stage-entered/exited timestamps. Need `lead_stage_history` (or typed stage-change rows in `lead_activities`). Unlocks true funnel conversion, per-stage dwell, velocity-by-stage.
- **G2 — Pipeline coverage vs target.** No sales quota/target exists. Need a per-period target table. Unlocks Pipeline Coverage + attainment %.
- **G3 — Lost-reason analytics.** `deals` has no `lost_reason`/`lost_at`. Unlocks win/loss *quality* analysis.
- **G4 — Valuing the lead funnel.** Leads carry no value (value lives on `deals`); need a guaranteed lead↔deal link + rollup.
- **G5 — Time-to-first-contact fidelity.** Depends on `lead_activities` reliably logging a first-contact event type — verify/augment.
- **G6 — Velocity / cycle-time / throughput trend.** `tasks` has no `done_at`/status-history (only noisy `updated_at`). Need task status-history or `done_at`. Unlocks tasks-done-per-week, cycle & lead time. *(Interim: Logged-Hours Trend from `time_entries.entry_date`.)*
- **G7 — True realization %.** Need standard-rate vs actually-billed + write-offs; requires billing/collections wired. *(Interim: "billable value" proxy = approved billable minutes × `rate_snapshot`.)*
- **G8 — On-time % trend / schedule variance / burndown.** No baseline snapshots, no `actual_end_date`, no sprint/cycle model. *(Interim: point-in-time "past due" only.)*
- **G9 — Per-industry widget-component registry.** `dashboard-renderer.tsx` hardcodes `industryId === "it_agency"` (code flags it as future cleanup). A real registry lets each industry plug its own widget pack — prerequisite for clean Education (Phase 4) and future industries.
- **G10 — Per-widget role/position gating.** Company dashboards show admin-scope widgets (approvals, aggregates) to all roles; `dashboards.granted_position_ids` gates a whole dashboard, but per-*widget* gating may be needed. (Parked open-decision.)
- **P1 — Money formatting is hardcoded USD.** `formatCurrency` (`src/lib/format-billable-delta.ts`) hardcodes `currency: "USD"`, so every it_agency money display (cost/margin tiles, billable value, My Time) shows `$` even for NPR tenants (Zunkiree bills ₨). No `currency` column on `tenants` today. Fix app-wide (add a tenant currency + thread it through, or standardize it_agency on NPR) so no single widget shows a different symbol than the rest. Small; approved 2026-07-12.
- **P2 — Due-date keyword filters are off-by-one in UTC+ timezones (real bug, not dashboard-scoped).** `dueFilterToDateRange` / `toISODate` in `src/industries/it-agency/features/project-board/lib/due-keywords.ts` builds a **local-midnight** `Date` then formats it with `toISOString()` (UTC) — in a UTC+ timezone (e.g. Asia/Kathmandu, UTC+5:45, the primary market) `toISODate(today)` returns **yesterday's** calendar date, shifting `today`/`this_week`/`overdue` back a day. Empirically: on Mon 2026-07-13, `overdue` resolved to `due_date <= 2026-07-11`, wrongly excluding tasks due 07-12. Affects the **project-board task filters (shipped, daily-use)** and the Phase-2 `delivery-overdue-tasks` widget (undercounts overdue). Fix `toISODate` to format in local/tenant tz (or compute the date parts without a UTC round-trip) + test both surfaces. Found 2026-07-13. **Higher priority than the dashboard backlog — it degrades a live feature.**
- **P3 — Insights RPCs don't honor branch-manager `leadScope:"team"` (latent scope gap).** Surfaced by code-review of the it_agency Sales/Delivery dashboards (2026-07-13). The `sales_*`/delivery RPCs take a single `p_assigned_to UUID` and `shouldRestrictToSelf` only self-restricts counselors (`leadScope:"self"`); a **branch manager** (`leadScope:"team"`) granted an insights dashboard would see **tenant-wide** data instead of their branch's — unlike `/api/v1/leads`' `leadQueryScope()`. **Latent, not live-exploitable today:** seeded dashboards are `granted_position_ids = '{}'` → owners/admins only, who are meant to see tenant-wide. Triggers only once an admin grants a BM position an insights dashboard. Fix requires widening the RPC signature (`p_assigned_to UUID` → `UUID[]`/branch-member set), so it's a real design change — do it before/with enabling BM insights grants. Overlaps the Branches "Phase 3 branch-scoped Insights" separate brief.
- **P4 — `sales/proposals` intentionally skips self-restriction (no owner column).** The proposals RPC has no per-user owner dimension, so it can't self-restrict and returns tenant-wide counts. Fine while access is admins-only (empty grant); revisit if proposals ever get an owner and non-admin positions are granted. Signed off 2026-07-13.

### IT-agency industry (`it_agency`)

Four first-round candidates for the IT-agency manifest. All are industry-scoped (live under `src/industries/it-agency/features/<feature>/`). Approved 2026-05-25.

- **Service catalog / packages**
  - Define service packages (name, description, hours, price). Listed on `/services` page; potentially used as templates for quotes.
  - Could reuse the existing `tenant_entities` table with IT-flavored UI, or get its own table — design decision at planning time.

- **Proposal / SOW generator**
  - Template-based proposal builder; IT-agency analog to the education form-builder.
  - Edit templates, fill placeholders, output as shareable link.
  - Bigger / more ambitious — best as a v2 once the other three have set the pattern.

### IT-agency Delivery backlog (Tiers 2–4 — from pm/coo gap analysis 2026-07-09)

The near-term delivery work (Tier 0 correctness + Tier 1 handoff + AI-synth vision UI) is in **Planned / next up** above. These are the deeper items — approved as *direction*, sequenced after the handoff feeds them clean signal. Source: `/pm-it-agency` + `/coo-it-agency` gap backlogs. **Keystone findings:** the shipped health/reconciliation engine is *starved* (no task-estimate UI — Tier 0 fixes it); the sales↔delivery machines don't talk at the handoff (Tier 1); the **billing → margin → retention** third of the value chain is absent (Tier 2 below).

- **Tier 2 — See the money. ✓ BOTH BUILT (branch, pending merge).** (a) **Cost rate → gross-margin** (`tenant_users.cost_rate` + `time_entries.cost_rate_snapshot`, admin-only Cost/Margin tiles; mig 132). (b) **Milestone-triggered invoicing spine** (`invoices` + `invoice_line_items` + INV-#### numbering + `invoiced_at` double-bill guard; mig 133).
- **Tier 3 — Structure + retention. ✓ BOTH BUILT (branch, pending merge).** (a) **Structured status-report sections** (Accomplishments/In-progress/Risks/Asks/Client-message + period-diff; mig 130). (b) **Client status share** via public token (`(widget)/reports/share/[token]`, no internal hours; mig 131).
- **Tier 4 — Methodology depth.** ✓ **BUILT (branch, pending merge):** **unified approvals inbox** (timesheets + milestones + CRs, one queue); **milestone lifecycle transitions** (Start/Submit/Reopen/Pull-back state machine — feeds the inbox; no mig); **task start/stop timer → timesheet** (`active_timers` + `time_entries.source`; mig 135; net-new, not in the original list); **"who hasn't logged" timesheet compliance** (admin view, weekend/holiday/leave-aware; no mig). — **STILL OPEN:** **Risk register / RAID "R" (M) ← next pick**, Sprints/cycles + burndown/velocity (L), milestone↔task phases (M), allocation date-bounds + over-allocation conflict (M), engagement-typed project templates (M), timesheet *submission* half (M), portfolio / cross-project health roll-up (M), task dependencies / blocked-by (M–L), structured retro + project close/archive (S–M), delivery notifications/reminders (M), unified-approvals live count badge (touches universal `attention-summary.tsx`), full client-facing read-only portal (L).

### Travel-agency industry (`travel_agency`)

New industry shipped to branch 2026-06-10 (first tenant **Arya Travels**): itinerary/quote builder, Trip Inquiry panel, Packages catalog, Itineraries list — see FEATURE-CATALOG `itinerary` row. Roadmap below is the world-class travel-agency workflow (crm-expert analysis); intent approved 2026-06-10. Guiding model: **Package = reusable template, Itinerary = customized instance; track the *deal* (sales pipeline) separately from the *trip* (the operated product); margin is the business; LTV is repeat + referral.**

- **Package-of-interest on leads** — *building now (2026-06-10), brief in `docs/TRAVEL-AGENCY-BRIEF.md`.*
  - Attach each lead to a Package via the existing `lead.entity_id` (no new column). Selector on the Trip Inquiry panel + a Package column on the leads table; back-filled on Arya's seeded leads.
  - Unlocks the "leads & revenue **by package**" report every travel owner asks for first (LeadSquared leads its travel pitch with it) and package-based routing to specialists.

- **Package templates → auto-fill itinerary** (the headline next feature)
  - Packages carry a base day-by-day itinerary + price template; picking a package on a lead **pre-fills the itinerary builder** (days + line items), agent then tweaks. Biggest time-saver; the itinerary builder already makes this a small lift.

- **Margin tracking (cost vs sell)**
  - Itinerary line items gain a **cost price** alongside the sell price → margin per quote + a margin report. The number the agency owner actually watches; what separates a tour operator's tooling from a generic CRM.

- **Booking / operations back office**
  - Convert a won lead into a **booking** (a distinct "trip" object from the sales lead): deposit/installment tracking, supplier vouchers, payments & receivables, multi-currency. The tour-operator ops layer.

- **Post-trip repeat & referral automation**
  - Post-travel feedback/review capture + re-engagement nurture for past travellers. Travel revenue compounds on repeat + word-of-mouth — this is the LTV engine, not an afterthought.

- **Channel & capture**
  - WhatsApp-first messaging (travel's dominant channel) + OTA-portal lead capture (MakeMyTrip / Booking.com style inbound).

### Education-consultancy (`education_consultancy`)

Deferred follow-ups surfaced while planning **Lead Lists** (2026-06-20). All confirmed by Sadin as "later" — captured so they're not lost. Lead Lists itself is in **In progress** below.

- **Class Bookings** (Test Prep deal track) — a 2nd deal object parallel to Applications (one student → many bookings). From Admizz's `Test Classes_Bookings` sheet: fields = Test Prep type (IELTS/PTE/…), Joining Date, Fee Paid Amount, Test Booked, Amount Paid for Test Booking. Build mirrors the Applications feature (board + booking object + per-lead rail). The Lead Lists "qualify" step routes a student into Application and/or Class track.
- **Spreadsheet → CRM importer** — one-off mapped import of Admizz's 3 real workbooks (`temp_ss/cus-admizz-docs/`: Prospects_Leads, Applications, Test Classes_Bookings; ~3,000+ rows) into leads / applications / class-bookings. Own carefully-reviewed task on the shared DB; explicitly **not** part of Lead Lists. (A general import feature is the bigger sibling.)
- **Processing Fee + Consent Form in prospect/application context** — these are operational flags that belong once a lead is a Prospect / has an Application, NOT on lead capture. Surface them on the prospect detail / Application object.
- **Centralized per-position list-access in Positions Manager** — Lead Lists v1 stores access **on each list** (per-list, by position). Later, mirror the `nav`/`pipelines`/`widgets` allow-list pattern in `PositionPermissions` so list access is also configurable from Settings ▸ Positions.
- **Multi-membership "segments"** — optional cross-cutting buckets (e.g. "2026 scholarship applicants") layered on top of the single-membership lifecycle lists. Deliberately deferred to keep v1 simple.
- **Migrate education `lead_type` reads → `list_id`** — Lead Lists Phase 1 mirrors `lead_type` from list moves to avoid breaking existing `lead_type==="prospect"` UI branches. Fast-follow: migrate those reads to `list_id` and retire the mirror.

### AI-native track (Orca agents)

- **DECISION NEEDED: two AI scoring paths exist, with opposite governance** (universal) — **found 2026-07-27 while scoping Phase-6 slice 6.1.** `leads.ai_score` / `ai_priority` / `ai_score_updated_at` are a **live, surfaced feature**: `/api/v1/leads/[id]/insights` computes a score and **writes it straight onto the lead with no approval gate at all**, surfaced in the lead-detail **AI Insights tab** and as an `ai_score` column in the leads table. Separately, Lead Triage's `propose_score` produces a score suggestion that **nothing can act on** — accepting it only flips `agent_outputs.status`. So the same product has one ungoverned AI write and one governed-but-inert AI proposal, neither aware of the other.
  - **Do not "fix" this by adding a `set_lead_score` write tool** — that makes it three paths. The decision is which one owns lead scoring: fold `propose_score` into the insights feature, put the insights route behind the Phase-5 approval spine, or keep them separate with an explicit reason.
  - **Why it matters:** the insights route is the older, ungoverned path and it is the one actually writing customer data today. Size M (design first). Deliberately left out of slice 6.1's scope.

- **✅ RESOLVED 2026-07-27 (PR #303) — the duplicate half. ⚠️ The middle bands remain unreliable, see the sub-bullet at the end.** Verified on stage after deploy: a genuine near-duplicate (same name, `ash.wilmot@cbre.com` vs `.co.uk`) scored **20** with correct reasoning, and a unique lead scored 81 with *"no duplicate found"* — so the fix works **and** did not over-correct into duplicate-blindness, which was the main risk of 6.3's self-exclusion. Original entry retained below for the diagnosis.
- **BUG: the Lead Triage score is systematically wrong for duplicates** (universal) — **five live stage observations 2026-07-27, pattern confirmed.** `leadTriageAgent`'s `systemPrompt` (`src/lib/ai/agents/registry.ts`) asks for "a 0-100 fit/quality score" with **no rubric** for what high or low means, so the model scores **its own confidence in its analysis**, not the lead's quality.
  - **The evidence, in order observed:** *"identical to an existing lead … possible duplicate"* → **100/100**. *"no duplicates found"* → 100/100. *"unique name … absence of email and phone"* → 90/100. *"no duplicates found"* → 100/100. *"is a duplicate as it exactly matches an existing lead by name and email"* → **100/100**. The two defensible scores were both no-duplicate cases where 100 happened to be right; **every duplicate it correctly identified still scored 100.**
  - **Why this is worse than a cosmetic wart:** `leads.ai_score` is a real, surfaced column (leads-table column + lead-detail AI Insights tab). Anyone sorting or filtering on it gets duplicates ranked as the *best* leads. The prose is consistently correct — only the number is inverted — so it reads as trustworthy.
  - **⚠️ STILL OPEN — the middle bands are noise in BOTH directions, not a downward collapse.** The 4-band rubric shipped in #303 says a lead with one contact method but not both scores `51-80`. Measured: an email-only lead scored **21** on local (two bands too low) and an email-only lead scored **81** on stage (one band too high, with self-contradicting reasoning — *"It has both an email and phone number, but the phone is missing"*). The duplicate-vs-not distinction is solid and that was the harmful part; the gradations between are not trustworthy and nothing should filter or sort on fine-grained `ai_score` differences yet. Given the assignee-invention result below, **do not expect another prompt iteration to fix this** — if band precision matters, compute it in code from the lead's actual fields and let the model supply only the duplicate judgement. Size S-M.
  - **Fix (shipped in #303):** give the prompt an explicit rubric (what a confirmed duplicate, a missing contact method, and a strong lead should each score) and require the number to follow the reasoning. Prompt-only, no schema. Size S. Interacts with the scoring-path decision above — fix the rubric even if `propose_score` later folds into the insights feature, since the same model call is doing the scoring either way.

- **BUG: Lead Triage intermittently invents a task assignee** (universal) — **observed on live stage 2026-07-27.** `create_task`'s input schema says verbatim *"Omit unless the user explicitly names someone else — never invent an assignee"*; the agent supplied `ffffffff-ffff-ffff-ffff-ffffffffffff` anyway on one proposal, while other proposals correctly resolved to "You". **Caught and refused** — `createTaskCore` validates tenant membership, so the approved write failed closed with `Validation failed: {"assignee_id":["Not a member of this tenant"]}`, no task created, `ai_write_actions` recorded `failed`. **No data risk; the governance worked exactly as designed.** The cost is a wasted human approval cycle and an opaque failure at the point of approval, which trains users to distrust the queue. **UPDATE 2026-07-27, post-6.2: the prompt fix was tried and FAILED — the rate got worse, not better.** 6.2 added *"Never pass an assigneeId — omit it every time"* to `leadTriageAgent`'s prompt. Measured on stage across every `write_action_proposal` ever produced: **before the fix 1 of 3 invented an assignee; after it, 2 of 2** (`ffffffff-ffff-ffff-ffff-ffffffffffff` at 12:13, then a plausible-looking fabricated `00cfb61c-…` at 12:32 — deploy completed 12:09:26, so both runs had the new prompt). Likely mechanism: naming the field prominently raises its salience, and negated instructions are weak ("don't think of an elephant"). **Do not attempt another prompt iteration.**
  - **Fix must be structural — strip the field, don't ask.** An agent run has no basis for choosing an assignee, so `assigneeId` should never survive from model output into an agent-originated `create_task` proposal. Suggested shape: a per-tool declaration (e.g. `agentSuppressedInputFields: ["assigneeId"]` on the `AgentTool`) that `proposeAgentWrite` strips before persisting the payload. Must be **per-tool, not global** — `assign_lead`'s assignee is legitimately model-chosen, that being the entire purpose of the tool, and the interactive chat path must keep `create_task`'s parameter so a user can still say "assign it to Bob".
  - **This is the third instance of the same lesson today**: every durable fix in this track has been structural (subject ids taken from the trigger, `search_leads` self-exclusion in the query, agents resolving at member tier), and every attempt to instruct the model into correctness has been unreliable. Treat "add an instruction to the prompt" as a mitigation, never a fix, for anything with a correctness consequence. Size S.

- **GAP: `create_task` agent writes cannot be undone** (universal) — **confirmed against source 2026-07-27 during the 6.1 review.** `UNDOABLE_TOOL_IDS` (`src/lib/ai/tools/universal/lib/lead-patch-result.ts:18`) is `["update_lead_stage", "assign_lead"]` only. Undo is built entirely on `applyLeadPatch` restoring **previous field values**, and `create_task` is an INSERT with no previous value to restore. This is correct-by-construction today — the undo route rejects it (`agent-writes/[id]/undo/route.ts:76`) and the drawer correctly hides the button — so nothing is broken or misleading. But it means the Phase-5 "every agent write is undoable" guarantee is **partial**, and slice 6.1 makes Lead Triage the main producer of exactly this un-undoable write. Fix would be a delete-the-created-row reversal path distinct from the patch-restore one. Size M. Not urgent: an unwanted task is low-stakes and manually deletable.

- **BUG: the `daily_digest` agent's `pipeline_summary` tool has never worked** (universal) — **confirmed against source 2026-07-27 during the Phase-5 slice 5.5 review.** `dailyDigestAgent` declares `pipeline_summary` in its `toolIds` (`src/lib/ai/agents/registry.ts:73`), but `src/lib/ai/tools/universal/pipeline-summary.ts:23` calls `assertUserAuth(auth)` unconditionally, which throws for **any** `AgentAuthContext`. The throw is swallowed by the tool adapter's catch into a generic "Something went wrong running pipeline_summary" result, so it fails **silently**: the digest agent has never once read per-stage lead counts, and has been writing digests without the very numbers it exists to report. Not a security issue — fail-closed, no data leak, no wrong write.
  - **Fix options:** (a) make `pipeline_summary` agent-safe — drop `assertUserAuth` and scope lead visibility the way `get_lead` / `search_leads` already do under agent auth (both are explicitly agent-proven); or (b) drop it from `dailyDigestAgent.toolIds` and let the digest rely on `search_leads`. **(a) is the real fix** — stage counts are the digest's entire job.
  - **Provenance:** surfaced by 5.5's D9 tool-exposure verification, which excluded `pipeline_summary` from the `mcp-client` definition for exactly this reason. A regression guard already asserts the throw (`src/lib/ai/agents/mcp-client-exposure.test.ts`), so whichever fix is chosen must update that test. Size S.

### Other industries

_(no approved features yet)_

---

## 📋 Planned / next up (brief written, top of queue)

Has a brief in `docs/<FEATURE>-BRIEF.md` or a detailed section here. Acceptance criteria, scope, key files identified. Ready for the next build session.

- **it_agency Delivery — Tier 0 "make the shipped engine truthful"** (industry-scoped `it_agency`) — **✓ BUILT ON BRANCH 2026-07-10 (`feature/it-agency-delivery-tier0`, pending merge).** Three small correctness fixes on the just-shipped cockpit: (1) **task-level `estimated_minutes` capture in the cockpit UI** — the shipped health / %-complete / est-vs-actual reconciliation engine is *starved* because no screen lets a PM enter per-task estimates (silently degrades to done-count ratios + blank variance); (2) **utilization period-scoping fix** — currently divides all-time billable hours by one week's capacity; (3) **board-card HealthDot accuracy** — uses a billable-minutes proxy + drops the due-date clause, so it disagrees with the cockpit's authoritative health. All S. Enriches the structured signal a future AI-synth reads.

- **it_agency Delivery — Tier 1 Deal/Proposal → Project handoff** (industry-scoped `it_agency`) — **✓ BUILT ON BRANCH 2026-07-10 (mig 134, renamed from 129 at rebase onto stage; pending merge).** `convert-to-project` drops the accepted proposal's line-item hours / total / rate / scope narrative + the deal's billing contact, forcing the PM to re-key the baseline from memory at the Qualify gate ("estimate amnesia"). Seed the project brief / baseline-estimate / budget / rate and copy contacts from the won deal + proposal; stamp baseline provenance into `project_events`. Likely needs a proposal→project link migration. Size M.

- **it_agency Delivery — AI-synth VISION UI (preview only)** (industry-scoped `it_agency`) — **✓ BUILT ON BRANCH 2026-07-10 (flag-gated preview, Zunkiree admin only; pending merge).** Flag-gated, non-functional preview of AI-assisted delivery (a "✨ Draft with AI" affordance on status reports + a "Project pulse" card), *sample content only* — NO LLM / keys / deps / writes / migration. Purpose: make the direction visible and pre-shape the seam before the real AI foundation exists. Zunkiree admin only; graduates into the real surface when the AI-native foundation lands (`docs/ai-native-efforts/`).

- **Insights → "Admin Dashboard" funnel widget** (education_consultancy) — **requested by Admizz's client 2026-06-13; blocked on 2 decisions before build.**
  - **Brief**: `docs/INSIGHTS-DASHBOARDS-BRIEF.md` §16. A new `funnel` widget for the Insights catalog: 4-phase education funnel (Leads → Prospects → Applications → Conversion), each with Total / New / active / Lost; lands in a 2nd dashboard "Admin Dashboard" (owner/admin only via empty grant).
  - **Blocking decisions**: (1) stage→phase mapping for the messy 32-stage Admizz pipeline (draft in the brief, needs client approval); (2) per-phase "Lost" is not computable from current lead state — needs `events` (`lead.stage_changed`) history = bigger lift → **lean v1** (Total+New+active + single Conversion Success/Lost) vs **full spec**.
  - **Status**: spec captured; awaiting Sadin/client on the two decisions, then Sonnet brief.

- **Leads Column Manager — "Edit columns"** (universal; all industries) — **brief written + approved 2026-06-09, top of queue for Sonnet.**
  - **Brief**: `docs/LEADS-COLUMN-MANAGER-BRIEF.md`. HubSpot-style "Choose which columns you see" dialog on the `/leads` data table: pick which lead fields are columns, reorder via drag (@dnd-kit), toggle visibility.
  - **Decisions locked**: localStorage persistence (per tenant+user) · custom fields discovered from loaded data · frozen columns deferred to v2 · leads table only · export follows visible columns · Name/Actions/select are fixed anchors · industry-gated columns (it_agency Company/Designation/Prospect Industry/etc.).
  - **Phasing**: Phase 1 = column-registry + refactor `leads-table.tsx` to render from config with ZERO behavior change (de-risks the 1,200-line refactor); Phase 2 = dialog + button + persistence + industry gating + custom-field discovery. Opus gates each phase before stage.
  - **Open default-columns call (Sadin)**: defaults currently = today's set; consider making it_agency default-show Company/Designation/Prospect Industry now that they're populated.
  - **Status**: approved; awaiting Sonnet pickup for Phase 1.

- **AI-Native Knowledge Layer** (universal; Orca-ready RAG over the KB)
  - **Blueprint / decision record**: `docs/reference/02-ARCHITECTURE-AI-KNOWLEDGE-LAYER.md` (written 2026-06-05, approved). Four layers: StorageProvider seam → ingestion pipeline → pgvector retrieval → Orca agent tools. Tool picks (OpenAI embeddings, Claude/GPT vision OCR, pgvector, R2 as the storage target), privacy stance, and "when to switch tools" thresholds all captured there.
  - **Phasing** (each gets its own brief referencing the blueprint): **Phase 1** = StorageProvider seam (consolidate the duplicated KB + `lead-documents` signed-URL logic onto one `S3Client`-based interface; R2-ready; no new vendors — cheap/safe, the natural next build). **Phase 2** = ingestion + `knowledge_chunks` pgvector + `retrieve()` module (new table, parser, embeddings, cron worker, new secrets). **Phase 3** = Orca agent tools (gated on Orca's agent framework being real).
  - **Open decisions** (in the blueprint): confirm embedding vendor (OpenAI vs Voyage), OCR approach (vision-reuse vs Mistral vs defer), DPA/student-PII sign-off owner.
  - **Status**: blueprint approved; Phase 1 brief is the next Opus deliverable when Sadin picks it up.

- **Email Automation — Phase 1.2** (universal; spec'd 2026-06-08 night, **PARKED — not a blocker**)
  - **Spine**: `docs/EMAIL-AUTOMATION-ARCHITECTURE-BRIEF.md` (§2 sender decision + §5 Phase 1.2). Phase 1.1 + 1.1b already shipped to prod (RESEND key live; rules fire on lead creation).
  - **Key decision (don't re-litigate)**: **two lanes by purpose** — automations/notifications → **Resend** (`no-reply@` + tenant `from_name`); human 1:1 conversation → **Gmail OAuth** (threaded). Automations are NOT routed through Gmail (a Gmail send goes out *as the connected person's address*, can't be `no-reply@`, clutters their Sent, hits send limits). Maps onto the Phase 2 `send_email` action `channel` field for Orca.
  - **Scope (backend-only, reduced)**: (a) `automation_email_log` table (migration 039, tenant_id FK + RLS) — one row per send attempt incl. failures/skips, kills silent fire-and-forget; (b) mirror each automation send into the lead's email timeline as a system/outbound record (CRM visibility, no Gmail); (c) Resend stays the sender. Log = visibility-only (no re-fire guard — would break catalogue re-download).
  - **Status**: spec + decision locked; Sonnet brief NOT yet written (deferred — working it_agency first). Pick up by writing the handoff brief from the brief's §5 Phase 1.2 bullet.

_(Project Workspace moved to Recently shipped — it_agency `/projects` workspace, all 5 phases, is live on prod. See FEATURE-CATALOG `project-board` row.)_

---

## 🔨 In progress (WIP)

Someone is actively building it. Each entry includes: owner, ETA, branch link, brief link.

- **Email Sequencing (Outreach) — Stage 1** (industry-scoped `it_agency`) — headless spine in build via Sonnet (stop-at-review) on `feature/outreach-sequencing` (off `origin/stage`); awaiting Opus review, not merged.
  - Cadence engine with an interim manual-send model: build a multi-step sequence → enroll a lead → per-step template draft → rep reviews/edits/copies/sends from their own Gmail → logs it in EdgeX (`lead_activities`) → auto-advances to the next step. Migration 176 (`email_sequences`/`email_sequence_steps`/`sequence_enrollments`/`sequence_step_drafts`). `draft_source`/`sent_via` seam columns so AI-drafting and EdgeX-native send can swap in later with no schema rework.
  - Stage 1 ships headless: gated placeholder page only, no cockpit UI. **Stage 2 (Brief 2 of 2, not started):** sequencing cockpit (build/edit sequences) + lead-detail tab (enroll, see enrollment status, worklist of due drafts).

- **Lead Lists — lifecycle segmentation** (industry-scoped `education_consultancy`) — **plan approved 2026-06-20; Phase 1 in build via Sonnet (stop-at-review) on `feature/lead-lists` (off `origin/stage @ 4b23916`).** Brief: `docs/LEAD-LISTS-BRIEF.md`; design/rationale: `~/.claude/plans/now-what-we-need-enchanted-parrot.md`.
  - Single-membership lifecycle lists (Pre-qualified → Qualified → Prospects → Archived + admin "+ add list") replacing the confusing `lead_type` lead/prospect split. "All Leads" master + nested lists in nav; standalone Contacts nav removed for education (Prospects replaces it). Per-list access by position; counselor own-scoping preserved.
  - **Phase 1 (in build):** `lead_lists` table + additive `leads` columns (`list_id`/`destinations`/`field_of_study`/`degree_level`/`archive_reason`) + RLS; nav group; list filter; move-to-list (mirrors `lead_type`; archive captures Drop Reason). **Migration file only — NOT applied** (shared DB needs Sadin GO). **Phase 2:** lean Create-Lead fields (Destination multi / Field of Study / Degree Level, seeded taxonomies) + qualify flow + list-management UI. **Phase 3:** new-tenant list provisioning + counsellor data cleanup + docs.
  - Deferred (logged under Approved ▸ Education-consultancy): Class Bookings, spreadsheet importer, Processing Fee/Consent in prospect context, centralized list-access, multi-membership segments, `lead_type`→`list_id` migration.

- **Outreach real send (education_consultancy) — Phase 1: email blast surface** — PR #436 (`feature/email-blast` → `stage`), Opus-reviewed (code sound), held for local test-proof + screenshots + docs (this pass) then 1 human stage approval; not yet merged.
  - One-shot email blast composer (audience filter → recipient preview → send-confirm with §6 cap-shortfall warning → send → live throttle/resume status), gated behind `EMAIL_OUTBOUND_ENABLED` + per-tenant `bulk_email_enabled` (both unset — ships dark). Built on Phase 0's send spine (below). Migration 212 (`email_blasts`).
  - **Next after merge:** Phase 2 (drip-sends + auto-send) — explicitly not started until Phase 1 merges and gets a second Opus sign-off; the consent basis for actually blasting Admizz's real leads is a separate open question for Sadin.

- **Unified Inbox (omnichannel)** — universal/Global; **Phases 1+2+3a on `stage` (`0279241`); real WhatsApp LIVE end-to-end on `dev-lead-crm`; NOT on prod.** Full detail + dev wiring + prod checklist: **`docs/UNIFIED-INBOX-BRIEF.md`**.
  - **Live now:** 3-pane UI · channel-agnostic tables (mig 044) · sandbox + **WhatsApp Cloud API** channels · inbound (Meta webhook → route by phone_number_id → queue) + outbound + **read receipts** · connect-a-channel Settings UI · **AES-256-GCM token encryption** · enforced 24h-window guard · notifications-on-inbound + deep-link · counselor scoping · realtime · AI seams (4 declared tools). Dev auto-drain cron `*/1`; permanent System User token.
  - **Next: Phase 3b** = near-instant inbound (inline-process after fast-ack; brief `docs/UNIFIED-INBOX-PHASE-3B-BRIEF.md`) — today inbound lags up to ~60s on dev (1-min cron). Then **prod promotion** (env vars on prod + prod-URL drain + privacy page + real business number). **Phase 4** = Messenger + Instagram (adapters still stubs). **Phase 5** = AI agent runtime over the 4 tools.

---

## ✅ Recently shipped (last 30 days)

Cross-reference only. The authoritative current state lives in `docs/FEATURE-CATALOG.md`. Sessions live in `docs/SESSION-LOG.md`.

- **Outreach real send — Phase 0: outbound send spine + compliance** (`education_consultancy`, dark) — **SHIPPED TO STAGE 2026-08-23 (PR #434, mig 211).** Foundation for all real outbound email (blasts, sequences, campaigns): `email_messages`/`email_suppressions`/`email_unsubscribe_tokens`, `sendQueuedEmailBatch` (suppression checks, stranded-row reclaim), public unsubscribe route + Resend bounce/complaint webhook. Ships dark behind `EMAIL_OUTBOUND_ENABLED` (unset everywhere). Authoritative detail: FEATURE-CATALOG email-outbound row; brief `docs/OUTREACH-PHASE0-BRIEF.md`.
- **Native email Phase 2 slice A (BCC dropbox)** (`FEATURES.EMAIL`, Global) — **SHIPPED TO STAGE 2026-07-29 (PR #314, mig 192).** Each rep gets a stable, revocable BCC address on their own Gmail; EdgeX logs the message against the right lead as first-class outbound email — zero OAuth, zero restricted scopes, no CASA. **Owed: live stage smoke, then prod promotion (192 rides the `production-db` gate).** Authoritative detail: FEATURE-CATALOG `FEATURES.EMAIL` row.
- **AI-native Phase 5 (agent spine + MCP server)** (`agent-spine` / `mcp-server`, Global) — **feature-complete + integration-passed on `feature/ai-phase5-agent-spine` 2026-07-27** (rebased onto latest `origin/stage`; migs renumbered 179–184 → 185–190; all 4 gates green). Background/autonomous agents (Lead Triage, Daily Digest, education Follow-up Drafter), the write-tool automation matrix + approval queue + undo, and an external MCP server at `/api/mcp`. **Not yet merged** — staged for a `stage` PR next, no promotion until Sadin reviews. Authoritative detail: FEATURE-CATALOG `agent-spine`/`mcp-server` rows; open bug tracked separately below (`daily_digest`'s `pipeline_summary` tool).
- **it_agency Delivery cockpit — Phase 1 + 1.5** (`project-board`, industry-scoped `it_agency`) — **SHIPPED TO STAGE 2026-07-09** (PR #159, migration 128; dogfood on Zunkiree Labs). Project cockpit `/projects/[id]`: **Brief → Qualify** gate (immutable baseline estimate + DoD + engagement model + dates + budget), **control layer** (health RAG, %-complete, budget), **milestones / issues / change-requests / status-reports**, and the **`project_events` append-only decision ledger** (the institutional-memory seam). Phase 1.5 unified the project home (folded Billable/Contacts/Tasks into cockpit Overview, repointed 12 links `/time-tracking/projects/[id]` → `/projects/[id]`, old route → redirect, non-admin view-vs-mutate role split). Briefs: `docs/IT-AGENCY-DELIVERY-PHASE1-BRIEF.md` + `docs/IT-AGENCY-DELIVERY-PHASE1.5-UNIFY-BRIEF.md`. **Owed:** Sadin stage click-through; prod promotion (128 → prod at promote-time via the `production-db` gate). Near-term follow-ups (Tier 0/1) in **Planned** above; deeper backlog in **Approved ▸ IT-agency Delivery**.
- **Branches (multi-office)** (`branches`, **Global — plan-gated Enterprise only, NOT industry-scoped**) — **SHIPPED TO PROD 2026-06-17** (`main` @ `fdd715f`; `stage` @ `98027f2`). Call sign `BRANCHES`. Branch/office layer for multi-office tenants (launch customer Admizz; KTM/Birgunj/Janakpur). Branch is orthogonal to Position (one reusable "Branch Manager" position + `tenant_users.branch_id`), inert when single-branch (NULL = pre-feature behavior, no backfill), gated on `entitlements.maxBranches > 1`. P0 entitlements seam (mig `051`) → P1a backend (migs `052`/`053`, `leadScope:"team"` + §4.1/§4.2 guards + branches API) → P1b UI (Settings manager, per-user picker, leads column + bulk assign) → P2 global header switcher (`edgex_branch` cookie, all-scope only) across dashboard/leads/pipeline. Migs `051`/`052`/`053` already on shared DB; Admizz seeded enterprise. Phase 3 (per-form default branch, round-robin, branch-scoped Insights) = separate brief. Authoritative detail: FEATURE-CATALOG `branches` row; brief archived at `docs/archive/features/BRANCHES-BRIEF.md`.
- **Campaigns (prediction leaderboard)** (`campaigns`, industry-scoped `education_consultancy`) — **FEATURE COMPLETE: Phase 1 + 1.5 + 1.6 (2026-06-15) + Phase 2 (2026-06-16) all on prod.** Call sign `CAMPAIGN-KICKOFF`. Admizz "Campaigns" nav + FIFA WC 2026 "Predict & Win" leaderboard (ESPN auto-fetch/score/rank) + public masked API + gear Agent-prompt handoff. Phase 2 (`7e6133c`, code-only): admin manual result-override + Revert-to-ESPN, admin-only integrity-flag overlay (shared phone/name clusters), config-driven Study Abroad Interest column. Authoritative detail: FEATURE-CATALOG `campaigns` row; brief `docs/CAMPAIGNS-BRIEF.md` (safe to archive).
- **Insights → Dashboards** (`insights`, industry-scoped `education_consultancy`) — named, position-scoped dashboards replacing the universal Dashboard nav for education tenants; admin/owner build dashboards over a fixed widget catalog + grant to positions; Pipeline-style switcher; data scoped by viewer's `leadScope`. Shipped to **stage** 2026-06-13 (mig 048 applied to shared DB). Follow-up funnel widget in Planned above. Brief: `docs/INSIGHTS-DASHBOARDS-BRIEF.md`.
- **Project Workspace** (`project-board`, industry-scoped `it_agency`) — unified `/projects` workspace, all 5 phases (Board / Table / Tasks / Members + lifted filters + log-time-from-row + a11y). Live on prod; squash-merged from the `feature/project-workspace-phase-*` branches (since deleted). Authoritative detail: FEATURE-CATALOG `project-board` row; brief archived at `docs/archive/features/PROJECT-WORKSPACE-BRIEF.md`.
- 2026-05-25 — **Student/Parent tags + View Details panel** (education_consultancy, by Anish via `view-details` branch adapted to industry-module pattern). See SESSION-LOG entry for 2026-05-25.
- 2026-05-24 — **Industry module foundation** + student check-in and form-builder migrated. See SESSION-LOG entry for 2026-05-24.

---

## How this board works

- **Ideas** → cheap parking lot. Drop items here without ceremony.
- **Approved for dev** → Sadin has said "yes, build this" but it's not the immediate next thing. Has a paragraph of intent so the next person to pick it up doesn't start from zero.
- **Planned / next up** → has a brief; ready to start. At most 1–2 items here at a time.
- **In progress** → being built right now. Limit 1 per developer to avoid context fragmentation.
- **Recently shipped** → short-lived; gets pruned into FEATURE-CATALOG + SESSION-LOG within a month.

Big features that warrant a discussion before committing to "Approved" get a `docs/<CONTEXT>-BRIEF.md` written first, then promoted to "Approved" once Sadin signs off.
