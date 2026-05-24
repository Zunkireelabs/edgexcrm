# Status Board — Lead Gen CRM

> Live checklist of open user-side actions, decisions, and questions. Companion to [SESSION-LOG.md](./SESSION-LOG.md). Update as items resolve.

Last updated: 2026-05-24 (initial seed during doc reorg)

---

## 🔴 Needs Sadin decision / action

- [ ] **Phase 2B scope**: Phase 2A built the operational backend (lead assignment, counselor role, dual-mode pipeline, invites, checklists, intake fields) with no UI. What's the UI scope for Phase 2B? Drives next brief.
- [ ] **`PRICING.md` at repo root**: untracked. Commit as-is (live product doc), move into `docs/reference/PRICING.md`, or add to `.gitignore`?
- [ ] **`docs/feature/email-automation/`** was empty (no PLAN.md). Was this a planned feature that never got specced? Drop or write the brief?
- [ ] **Stage branch is 7 commits behind `origin/stage`** (as of audit). Pull before any new work to avoid divergence.

## 🟡 Open questions

- [ ] Status of branches `feature/upgrade-pipeline` and `feature/ai-orchestrate-orca` — merged/open PR/abandoned? Their PLAN.md docs were marked COMPLETE and have been archived to `docs/archive/features/`.
- [ ] Older planning docs (`docs/archive/plans/enhanced-dashboard.md`, `lead-detail-redesign.md`, dated 2026-03-27) — shipped, dormant, or superseded by Phase 2A? Confirms whether they belong in `archive/plans/` or `archive/stale/`.
- [ ] `docs/archive/research/ai-insight-*` (2026-03-28) — research that never linked to a PR. Still on the roadmap, or abandoned?

## ✅ Recently resolved

- 2026-05-24 — Doc layout reorganized to match Stella+Zunkiree brain-folder pattern: SESSION-LOG.md as single source of truth, `reference/` for stable docs, `archive/<series>/` for shipped work. Top-level `docs/` is now scannable.

---

## How this board works

- **🔴 Needs decision / action**: blocking items that require Sadin's input before a new session can move forward productively.
- **🟡 Open questions**: non-blocking ambiguities worth resolving when convenient.
- **✅ Recently resolved**: rolling log of items closed in the last few weeks — keeps the why-it-changed paper trail near where decisions were made.

Items here should be specific and actionable. If something becomes a multi-step project, write a `<CONTEXT>-BRIEF.md` at the top of `docs/` and link from here.
