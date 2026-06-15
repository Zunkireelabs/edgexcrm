# Feature Roadmap

> Forward-looking pipeline of features by state. Companions:
> - **`docs/FEATURE-CATALOG.md`** — features that already exist in code (current state).
> - **`docs/SESSION-LOG.md`** — session-by-session history of what shipped and when.
> - **`docs/STATUS-BOARD.md`** — open user-side decisions / blockers (not features per se).
>
> Move entries between sections as their state changes. Cross-reference shipped features to their SESSION-LOG entry and commit SHA, then keep them in `## ✅ Shipped` here only briefly before relying on FEATURE-CATALOG as the source of truth.

Last updated: 2026-06-10 (NEW INDUSTRY `travel_agency` shipped to branch + roadmap captured — see Approved for dev. Prior: 2026-06-05 AI-Native Knowledge Layer blueprint.)

---

## 💡 Ideas (raw — not yet approved)

Cheap to add, cheap to drop. One-line per idea. If an idea matures, promote it to "Approved for dev" with a paragraph of intent.

_(empty — add items here as they come up)_

---

## 🟢 Approved for dev (intent captured, awaiting pickup)

Sadin signed off on building this. Has at least a paragraph of intent. Ready for planning when picked up.

### IT-agency industry (`it_agency`)

Four first-round candidates for the IT-agency manifest. All are industry-scoped (live under `src/industries/it-agency/features/<feature>/`). Approved 2026-05-25.

- **Service catalog / packages**
  - Define service packages (name, description, hours, price). Listed on `/services` page; potentially used as templates for quotes.
  - Could reuse the existing `tenant_entities` table with IT-flavored UI, or get its own table — design decision at planning time.

- **Proposal / SOW generator**
  - Template-based proposal builder; IT-agency analog to the education form-builder.
  - Edit templates, fill placeholders, output as shareable link.
  - Bigger / more ambitious — best as a v2 once the other three have set the pattern.

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

### Other industries

_(no approved features yet)_

---

## 📋 Planned / next up (brief written, top of queue)

Has a brief in `docs/<FEATURE>-BRIEF.md` or a detailed section here. Acceptance criteria, scope, key files identified. Ready for the next build session.

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

- **Campaigns (prediction leaderboard)** — industry-scoped `education_consultancy` (Admizz); **Phase 1 IN PROGRESS — Sonnet building, handed off 2026-06-15.** Call sign **`CAMPAIGN-KICKOFF`**. Brief: **`docs/CAMPAIGNS-BRIEF.md`**. Owner: Sonnet (code) → Opus review → Sadin smoke. New "Campaigns" nav; first campaign = FIFA World Cup 2026 "Predict & Win" leaderboard on the existing `worldcup-predict-win` form (441 deduped predictions, 147 people, 14 matches). Auto-fetches results from ESPN + scores + ranks (most-correct) on view; admin-only; ESPN auto-fill with stored/locked results + (Phase 2) manual override. Data-driven so campaign #2 + other industries plug in later. **Next gate: Opus reviews Sonnet's Phase 1 diff before anything touches stage.**

- **Unified Inbox (omnichannel)** — universal/Global; **Phases 1+2+3a on `stage` (`0279241`); real WhatsApp LIVE end-to-end on `dev-lead-crm`; NOT on prod.** Full detail + dev wiring + prod checklist: **`docs/UNIFIED-INBOX-BRIEF.md`**.
  - **Live now:** 3-pane UI · channel-agnostic tables (mig 044) · sandbox + **WhatsApp Cloud API** channels · inbound (Meta webhook → route by phone_number_id → queue) + outbound + **read receipts** · connect-a-channel Settings UI · **AES-256-GCM token encryption** · enforced 24h-window guard · notifications-on-inbound + deep-link · counselor scoping · realtime · AI seams (4 declared tools). Dev auto-drain cron `*/1`; permanent System User token.
  - **Next: Phase 3b** = near-instant inbound (inline-process after fast-ack; brief `docs/UNIFIED-INBOX-PHASE-3B-BRIEF.md`) — today inbound lags up to ~60s on dev (1-min cron). Then **prod promotion** (env vars on prod + prod-URL drain + privacy page + real business number). **Phase 4** = Messenger + Instagram (adapters still stubs). **Phase 5** = AI agent runtime over the 4 tools.

---

## ✅ Recently shipped (last 30 days)

Cross-reference only. The authoritative current state lives in `docs/FEATURE-CATALOG.md`. Sessions live in `docs/SESSION-LOG.md`.

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
