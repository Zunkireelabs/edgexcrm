# Status Board — Lead Gen CRM

> Live checklist of open user-side actions, decisions, and questions. Companion to [SESSION-LOG.md](./SESSION-LOG.md). Update as items resolve.

Last updated: 2026-05-24 (post-backfill)

---

## 🔴 Needs Sadin decision / action

- [ ] **Branch sync**: local `stage` diverged from `origin/stage` (~3 ahead, 7 behind). Pull/rebase before starting new feature work. The 7 behind are now logged in the backfill entry; the 3 ahead look minor (ci + style).
- [ ] **`PRICING.md` at repo root**: duplicate of `docs/reference/PRICING.md`. Delete the root copy (recommended) or replace the `reference/` one — don't keep both.
- [ ] **PR #9 verification**: "form builder for education consultancy" merged 2026-05-21 but landed after the backfill window. Needs current-state verification and its own SESSION-LOG entry.

## 🟡 Open questions

- [ ] `docs/archive/research/ai-insight-*` (2026-03-28) — `013_lead_insights` migration + `/api/v1/ai/chat` stub suggest partial implementation. Is the AI insight feature still on the roadmap, or are the stubs dormant?
- [ ] `docs/feature/email-automation/` was empty when the docs were reorganized — the actual email-forward + Gmail OAuth feature shipped via `f728ca8` (May 4). Was the empty dir a stale placeholder? Safe to confirm-and-delete.
- [ ] Older planning docs `docs/archive/plans/enhanced-dashboard.md` and `lead-detail-redesign.md` (2026-03-27) — were these the briefs for PRs #4–#5? Worth retitling/dating if so, or moving to `archive/stale/` if superseded.

## ✅ Recently resolved

- 2026-05-24 — **SESSION-LOG backfill** written for the March–May shipped-work gap (PRs #4–#8 + commits `f728ca8` → `b890c35`). The "Phase 2B scope" question is answered (it shipped via PRs #4–#7). The "branches `feature/upgrade-pipeline` and `feature/ai-orchestrate-orca`" question is answered for upgrade-pipeline (= PR #8, merged); ai-orchestrate-orca status still ambiguous but lower priority.
- 2026-05-24 — Doc layout reorganized to match Stella+Zunkiree brain-folder pattern: SESSION-LOG.md as single source of truth, `reference/` for stable docs, `archive/<series>/` for shipped work. Top-level `docs/` is now scannable.

---

## How this board works

- **🔴 Needs decision / action**: blocking items that require Sadin's input before a new session can move forward productively.
- **🟡 Open questions**: non-blocking ambiguities worth resolving when convenient.
- **✅ Recently resolved**: rolling log of items closed in the last few weeks — keeps the why-it-changed paper trail near where decisions were made.

Items here should be specific and actionable. If something becomes a multi-step project, write a `<CONTEXT>-BRIEF.md` at the top of `docs/` and link from here.
