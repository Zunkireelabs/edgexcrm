# Feature Roadmap

> Forward-looking pipeline of features by state. Companions:
> - **`docs/FEATURE-CATALOG.md`** — features that already exist in code (current state).
> - **`docs/SESSION-LOG.md`** — session-by-session history of what shipped and when.
> - **`docs/STATUS-BOARD.md`** — open user-side decisions / blockers (not features per se).
>
> Move entries between sections as their state changes. Cross-reference shipped features to their SESSION-LOG entry and commit SHA, then keep them in `## ✅ Shipped` here only briefly before relying on FEATURE-CATALOG as the source of truth.

Last updated: 2026-05-25

---

## 💡 Ideas (raw — not yet approved)

Cheap to add, cheap to drop. One-line per idea. If an idea matures, promote it to "Approved for dev" with a paragraph of intent.

_(empty — add items here as they come up)_

---

## 🟢 Approved for dev (intent captured, awaiting pickup)

Sadin signed off on building this. Has at least a paragraph of intent. Ready for planning when picked up.

### IT-agency industry (`it_agency`)

Four first-round candidates for the IT-agency manifest. All are industry-scoped (live under `src/industries/it-agency/features/<feature>/`). Approved 2026-05-25.

- **Project board (client deliverables)**
  - Kanban-style board for active client projects, separate from the leads pipeline.
  - Stages like Discovery / In Progress / Review / Delivered.
  - Reuses dnd-kit patterns from the existing pipeline. Multi-day build. High value once shipped.

- **Service catalog / packages**
  - Define service packages (name, description, hours, price). Listed on `/services` page; potentially used as templates for quotes.
  - Could reuse the existing `tenant_entities` table with IT-flavored UI, or get its own table — design decision at planning time.

- **Proposal / SOW generator**
  - Template-based proposal builder; IT-agency analog to the education form-builder.
  - Edit templates, fill placeholders, output as shareable link.
  - Bigger / more ambitious — best as a v2 once the other three have set the pattern.

### Other industries

_(no approved features yet)_

---

## 📋 Planned / next up (brief written, top of queue)

Has a brief in `docs/<FEATURE>-BRIEF.md` or a detailed section here. Acceptance criteria, scope, key files identified. Ready for the next build session.

- **Time Tracking** (`time-tracking`, industry-scoped to `it_agency`)
  - **Brief**: `docs/TIME-TRACKING-BRIEF.md` (full data model, API surface, UI surface, 5-phase plan, verification per phase)
  - **Scope**: account/project/task/time-entry hierarchy + per-member-rate-with-project-override + tenant-admin approvals + billable totals
  - **Phasing**: 5 commits across ~4–5 dev-days (schema → CRUD → time entries → approvals → rates)
  - **Workflow**: Opus planned + reviews; **Sonnet executes** (separate session). Opus gates each phase before push to stage.
  - **Status**: planned. Awaiting Sonnet session pickup.

---

## 🔨 In progress (WIP)

Someone is actively building it. Each entry includes: owner, ETA, branch link, brief link.

_(empty)_

---

## ✅ Recently shipped (last 30 days)

Cross-reference only. The authoritative current state lives in `docs/FEATURE-CATALOG.md`. Sessions live in `docs/SESSION-LOG.md`.

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
