# Feature Roadmap

> Forward-looking pipeline of features by state. Companions:
> - **`docs/FEATURE-CATALOG.md`** — features that already exist in code (current state).
> - **`docs/SESSION-LOG.md`** — session-by-session history of what shipped and when.
> - **`docs/STATUS-BOARD.md`** — open user-side decisions / blockers (not features per se).
>
> Move entries between sections as their state changes. Cross-reference shipped features to their SESSION-LOG entry and commit SHA, then keep them in `## ✅ Shipped` here only briefly before relying on FEATURE-CATALOG as the source of truth.

Last updated: **2026-07-23** (Outreach AI-drafting Stage 2 merged to stage — PR #282, mig 178. Reconciled after ~2 weeks of drift: Inngest COMPLETE on prod; outreach sequencing Stage 1 on prod + Stage 2 on stage; AI-native Phases 1–3 on stage; email-productionization Path A on stage. Prior real update: 2026-07-10.)

---

## ⛔ The dominant constraint right now: the D5 privacy gate

A large share of in-flight work is **AI-native** (the "Orca" track), and several features are **built and live on `stage` but cannot promote to prod** until **ADR-001 Decision 5 (D5)** is signed. D5 is the **privacy sign-off** allowing lead PII to egress to a third-party LLM in production; it rests on (a) a signed DPA / zero-retention posture with the AI provider and (b) per-tenant client consent recorded as `tenants.ai_enabled` (mig 174). Every AI feature is double-gated (`env flag AND tenants.ai_enabled`) and ships stage-only until D5. **D5 is a business/legal decision from Sadin, not a code task** — signing it unblocks the whole AI column at once. Refs: `docs/reference/02-ARCHITECTURE-AI-KNOWLEDGE-LAYER.md`, `docs/ai-native-efforts/`.

Items marked **`[D5-blocked]`** below are done-on-stage, waiting only on this gate.

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

The 2026-05-25 first-round candidates. **✓ Both delivered** as part of **Bucket C** (Proposals / Service Catalog / Deals v2 / view-tracking + sectioned sidebar) — **on STAGE, pending a consolidated prod promotion** (⚠️ prod split-brain risk, migs 102–109 must promote as one batch). See Recently shipped + memory `project_it_agency_bucket_c`.

- ~~**Service catalog / packages**~~ — ✓ shipped to stage (Service Catalog in Bucket C).
- ~~**Proposal / SOW generator**~~ — ✓ shipped to stage (Proposals in Bucket C; e-sign accept step 3b still ON HOLD, 3 open decisions).

### IT-agency Delivery backlog (Tiers 2–4 — from pm/coo gap analysis 2026-07-09)

The near-term delivery work (Tier 0 correctness + Tier 1 handoff + AI-synth vision UI) is in **Planned / next up** above. These are the deeper items — approved as *direction*, sequenced after the handoff feeds them clean signal. Source: `/pm-it-agency` + `/coo-it-agency` gap backlogs. **Keystone findings:** the shipped health/reconciliation engine is *starved* (no task-estimate UI — Tier 0 fixes it); the sales↔delivery machines don't talk at the handoff (Tier 1); the **billing → margin → retention** third of the value chain is absent (Tier 2 below).

- **Tier 2 — See the money. ✓ BOTH ON STAGE** (PR #160, 2026-07-10). (a) **Cost rate → gross-margin** (`tenant_users.cost_rate` + `time_entries.cost_rate_snapshot`, admin-only Cost/Margin tiles; mig 132). (b) **Milestone-triggered invoicing spine** (`invoices` + `invoice_line_items` + INV-#### numbering + `invoiced_at` double-bill guard; mig 133).
- **Tier 3 — Structure + retention. ✓ BOTH ON STAGE** (PR #160). (a) **Structured status-report sections** (Accomplishments/In-progress/Risks/Asks/Client-message + period-diff; mig 130). (b) **Client status share** via public token (`(widget)/reports/share/[token]`, no internal hours; mig 131).
- **Tier 4 — Methodology depth.** ✓ **ON STAGE** (PR #160): **unified approvals inbox** (timesheets + milestones + CRs, one queue); **milestone lifecycle transitions** (Start/Submit/Reopen/Pull-back state machine — feeds the inbox; no mig); **task start/stop timer → timesheet** (`active_timers` + `time_entries.source`; mig 135; net-new, not in the original list); **"who hasn't logged" timesheet compliance** (admin view, weekend/holiday/leave-aware; no mig). — **STILL OPEN:** **Risk register / RAID "R" (M) ← next pick**, Sprints/cycles + burndown/velocity (L), milestone↔task phases (M), allocation date-bounds + over-allocation conflict (M), engagement-typed project templates (M), timesheet *submission* half (M), portfolio / cross-project health roll-up (M), task dependencies / blocked-by (M–L), structured retro + project close/archive (S–M), delivery notifications/reminders (M), unified-approvals live count badge (touches universal `attention-summary.tsx`), full client-facing read-only portal (L).

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

Deferred follow-ups surfaced while planning **Lead Lists** (2026-06-20). All confirmed by Sadin as "later" — captured so they're not lost. Lead Lists itself has **shipped** (stage + mig 111 on prod) — see Recently shipped.

- **Class Bookings** (Test Prep deal track) — a 2nd deal object parallel to Applications (one student → many bookings). From Admizz's `Test Classes_Bookings` sheet: fields = Test Prep type (IELTS/PTE/…), Joining Date, Fee Paid Amount, Test Booked, Amount Paid for Test Booking. Build mirrors the Applications feature (board + booking object + per-lead rail). The Lead Lists "qualify" step routes a student into Application and/or Class track.
- **Spreadsheet → CRM importer** — one-off mapped import of Admizz's 3 real workbooks (`temp_ss/cus-admizz-docs/`: Prospects_Leads, Applications, Test Classes_Bookings; ~3,000+ rows) into leads / applications / class-bookings. Own carefully-reviewed task on the shared DB; explicitly **not** part of Lead Lists. (A general import feature is the bigger sibling.)
- **Processing Fee + Consent Form in prospect/application context** — these are operational flags that belong once a lead is a Prospect / has an Application, NOT on lead capture. Surface them on the prospect detail / Application object.
- **Centralized per-position list-access in Positions Manager** — Lead Lists v1 stores access **on each list** (per-list, by position). Later, mirror the `nav`/`pipelines`/`widgets` allow-list pattern in `PositionPermissions` so list access is also configurable from Settings ▸ Positions.
- **Multi-membership "segments"** — optional cross-cutting buckets (e.g. "2026 scholarship applicants") layered on top of the single-membership lifecycle lists. Deliberately deferred to keep v1 simple.
- **Migrate education `lead_type` reads → `list_id`** — Lead Lists Phase 1 mirrors `lead_type` from list moves to avoid breaking existing `lead_type==="prospect"` UI branches. Fast-follow: migrate those reads to `list_id` and retire the mirror.

### Other industries

- **CRE / `real_estate`** — industry scaffolded on stage (migs 164–167: industry + offerings + investor commitments + offering documents); `/coo-real-estate` advisory skill covers the investor-raise + IR workflow. Feature build not yet sequenced.

---

## 📋 Planned / next up (brief written, top of queue)

Has a brief in `docs/<FEATURE>-BRIEF.md` or a detailed section here. Acceptance criteria, scope, key files identified. Ready for the next build session.

- **it_agency Delivery — Tier 0 "make the shipped engine truthful"** (industry-scoped `it_agency`) — **✓ ON STAGE (PR #160, 2026-07-10, migs 128–135).** Three small correctness fixes on the just-shipped cockpit: (1) **task-level `estimated_minutes` capture in the cockpit UI** — the shipped health / %-complete / est-vs-actual reconciliation engine is *starved* because no screen lets a PM enter per-task estimates (silently degrades to done-count ratios + blank variance); (2) **utilization period-scoping fix** — currently divides all-time billable hours by one week's capacity; (3) **board-card HealthDot accuracy** — uses a billable-minutes proxy + drops the due-date clause, so it disagrees with the cockpit's authoritative health. All S. Enriches the structured signal a future AI-synth reads.

- **it_agency Delivery — Tier 1 Deal/Proposal → Project handoff** (industry-scoped `it_agency`) — **✓ ON STAGE (PR #160, mig 134).** `convert-to-project` drops the accepted proposal's line-item hours / total / rate / scope narrative + the deal's billing contact, forcing the PM to re-key the baseline from memory at the Qualify gate ("estimate amnesia"). Seed the project brief / baseline-estimate / budget / rate and copy contacts from the won deal + proposal; stamp baseline provenance into `project_events`. Likely needs a proposal→project link migration. Size M.

- **it_agency Delivery — AI-synth VISION UI (preview only)** (industry-scoped `it_agency`) — **✓ ON STAGE (PR #160, flag-gated preview, Zunkiree admin only).** Flag-gated, non-functional preview of AI-assisted delivery (a "✨ Draft with AI" affordance on status reports + a "Project pulse" card), *sample content only* — NO LLM / keys / deps / writes / migration. Purpose: make the direction visible and pre-shape the seam before the real AI foundation exists. Zunkiree admin only; graduates into the real surface when the AI-native foundation lands (`docs/ai-native-efforts/`).

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

- **AI-Native / Orca track — Knowledge Layer + agent write-tools** (universal; Orca-ready) — **`[D5-blocked]` for prod.**
  - **Blueprint / decision record**: `docs/reference/02-ARCHITECTURE-AI-KNOWLEDGE-LAYER.md` + ADR-001 (ACCEPTED: Orca-inside, agents-as-employees, AI SDK + Inngest + Langfuse + pgvector). Master plan in `docs/ai-native-efforts/`.
  - **On STAGE now**: **Phases 1–3** (#227, migs 164–170) — AI assistant foundation, `knowledge_chunks` + pgvector hybrid search/retrieval. Read-only assistant + retrieval work on stage behind `AI_ASSISTANT_ENABLED` + `tenants.ai_enabled`.
  - **Built, unmerged**: **Phase 4A/4B/4C write-actions** on `feature/ai-phase-4-writes` (migs 173/175 scaffolding on stage; 4C reviewed + fixed) behind a **9-item decision queue**.
  - **Next Opus deliverable**: resolve the decision queue → stage the write-tools behind the flag. **All prod promotion blocked on D5.**

- **Email Automation — Phase 1.2** (universal; spec'd 2026-06-08 night, **PARKED — not a blocker**)
  - **Spine**: `docs/EMAIL-AUTOMATION-ARCHITECTURE-BRIEF.md` (§2 sender decision + §5 Phase 1.2). Phase 1.1 + 1.1b already shipped to prod (RESEND key live; rules fire on lead creation).
  - **Key decision (don't re-litigate)**: **two lanes by purpose** — automations/notifications → **Resend** (`no-reply@` + tenant `from_name`); human 1:1 conversation → **Gmail OAuth** (threaded). Automations are NOT routed through Gmail (a Gmail send goes out *as the connected person's address*, can't be `no-reply@`, clutters their Sent, hits send limits). Maps onto the Phase 2 `send_email` action `channel` field for Orca.
  - **Scope (backend-only, reduced)**: (a) `automation_email_log` table (migration 039, tenant_id FK + RLS) — one row per send attempt incl. failures/skips, kills silent fire-and-forget; (b) mirror each automation send into the lead's email timeline as a system/outbound record (CRM visibility, no Gmail); (c) Resend stays the sender. Log = visibility-only (no re-fire guard — would break catalogue re-download).
  - **Status**: spec + decision locked; Sonnet brief NOT yet written (deferred — working it_agency first). Pick up by writing the handoff brief from the brief's §5 Phase 1.2 bullet.

_(Project Workspace moved to Recently shipped — it_agency `/projects` workspace, all 5 phases, is live on prod. See FEATURE-CATALOG `project-board` row.)_

---

## 🔨 In progress (WIP)

Someone is actively building it. Each entry includes: owner, ETA, branch link, brief link.

- **Outreach email sequencing + AI-drafting** (industry-scoped `it_agency`) — **sequencing LIVE ON PROD (migs 176/177); AI-drafting Stage 2 on STAGE (`[D5-blocked]` for prod).**
  - **Shipped**: cadence engine + manual-send model (#267), then the cadence timeline / needs-attention surfaces / draft-due bell (#270) — sequencing Stage 1 is on prod (migs 176/177). Build a multi-step sequence → enroll a lead → per-step template draft → rep copies/sends from their own inbox → logs to `lead_activities` → auto-advances.
  - **Stage 2 — AI-drafting** merged to STAGE (**PR #282, `a566448b`, mig 178**): optional AI drafter — template-first default, on-demand "Draft with AI", admin save-as-template (genericization confirm), optional per-step auto-AI. Two-part D5 gate; gate-off degrades to template with zero model calls. **Next**: stage soak → prod promotion **after D5**. EdgeX-native send waits on the email-productionization ladder.

- **Email productionization (Path A, send-only)** (universal, all 8 industries) — **MERGED TO STAGE 2026-07-20 (PR #264, `e8032b0b`); prod NOT promoted.**
  - Connected Inboxes + compose promoted to all industries; Path A = drop `gmail.readonly` (Restricted/CASA), keep `gmail.send` (Sensitive, $0); reply-sync dormant behind `EMAIL_REPLY_SYNC_ENABLED`; send rate-limit 50/5min. Runbook: `docs/email-productionization/`.
  - **Ladder**: (1) sequencing + AI-draft with interim human-copy-send ✅ built; (2) **new EdgeX domain + verify → EdgeX-native send** ← next; (3) Path B (CASA + autonomous send agents).

- **it_agency — Leads split into two funnels** (industry-scoped `it_agency`) — **WIP on `feature/it-agency-two-funnels`; PR #199 OPEN to stage, CI green. DO NOT MERGE until Sadin says final** (then request Anish approval). Splits "All Leads" into **Lead Processing** + **Sales Leads** with a 3-tier Funnel/Stage/Status model (mig 154).

- **Unified Inbox (omnichannel)** — universal/Global; **Phases 1+2+3a on `stage` (`0279241`); real WhatsApp LIVE end-to-end on `dev-lead-crm`; NOT on prod.** Full detail + dev wiring + prod checklist: **`docs/UNIFIED-INBOX-BRIEF.md`**.
  - **Live now:** 3-pane UI · channel-agnostic tables (mig 044) · sandbox + **WhatsApp Cloud API** channels · inbound (Meta webhook → route by phone_number_id → queue) + outbound + **read receipts** · connect-a-channel Settings UI · **AES-256-GCM token encryption** · enforced 24h-window guard · notifications-on-inbound + deep-link · counselor scoping · realtime · AI seams (4 declared tools). Dev auto-drain cron `*/1`; permanent System User token.
  - **Next: Phase 3b** = near-instant inbound (inline-process after fast-ack; brief `docs/UNIFIED-INBOX-PHASE-3B-BRIEF.md`) — today inbound lags up to ~60s on dev (1-min cron). Then **prod promotion** (env vars on prod + prod-URL drain + privacy page + real business number). **Phase 4** = Messenger + Instagram (adapters still stubs). **Phase 5** = AI agent runtime over the 4 tools.

---

## ✅ Recently shipped (last ~45 days)

Cross-reference only. The authoritative current state lives in `docs/FEATURE-CATALOG.md`. Sessions live in `docs/SESSION-LOG.md`.

- **Inngest background-jobs migration** — **COMPLETE, all 4 phases on PROD** (PRs #272/#273/#274/#275; promotes #279/#280). GH-Actions `schedule:` cron fully decommissioned; Inngest is the sole scheduler (reminders scan, inbox-process, email-poll + heartbeat). Runbook: `docs/reference/03-INNGEST-BACKGROUND-JOBS.md`.
- **HRMS — Phase 1 (People & Resourcing) + Phase 2 (Leave & Attendance)** — **SHIPPED TO PROD 2026-07-07** (universal HR core + it_agency edge; employee = `tenant_users` + `employee_profiles`; migs 112–123 staged per-batch). Later phases (payroll/performance/ESS) not yet built.
- **Lead Lists — lifecycle segmentation** (education_consultancy) — lifecycle lists (Pre-qualified → Qualified → Prospects → Applications → Archived), called "Stage" in the UI. Shipped to stage (#103); **mig 111 shipped to PROD 2026-07-07** (resolved a live split-brain — the UI was live but dataless).
- **Email productionization (Path A)** + **Outreach sequencing Stage 1** — see In progress above (email Path A on stage; sequencing on prod). Listed there to keep the AI/email ladder in one place.
- **Dev-workflow + deployment hardening** — branch protection (main+stage), migration ledger (`schema_migrations`) + auto-migration runner in the deploy pipelines, rollback fix, CODEOWNERS, Migration/Promotion guards, blocking CI test gate (Vitest). See `docs/dev-collab/`.
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
