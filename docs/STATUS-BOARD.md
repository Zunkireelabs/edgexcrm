# Status Board — Lead Gen CRM

> Live checklist of open user-side actions, decisions, and questions. Companion to [SESSION-LOG.md](./SESSION-LOG.md). Update as items resolve.

Last updated: 2026-05-24 (post-industry-modules)

---

## 🔴 Needs Sadin decision / action

- [ ] **`PRICING.md` at repo root**: duplicate of `docs/reference/PRICING.md`. Delete the root copy (recommended) or replace the `reference/` one — don't keep both.
- [ ] **Decide first IT-agency-scoped feature**: the industry module foundation is in place but `industries/it-agency/manifest.ts` is empty. Pick one feature to validate the parallel-work claim end-to-end.

## 🟡 Open questions

- [ ] `docs/archive/research/ai-insight-*` (2026-03-28) — `013_lead_insights` migration + `/api/v1/ai/chat` stub suggest partial implementation. Is the AI insight feature still on the roadmap, or are the stubs dormant? The new `industries/<id>/ai/agent.ts` slots are reserved for per-industry prompts — when this work gets prioritized, that's the home.
- [ ] `docs/feature/email-automation/` was empty when the docs were reorganized — the actual email-forward + Gmail OAuth feature shipped via `f728ca8` (May 4). Was the empty dir a stale placeholder? Safe to confirm-and-delete.
- [ ] Older planning docs `docs/archive/plans/enhanced-dashboard.md` and `lead-detail-redesign.md` (2026-03-27) — were these the briefs for PRs #4–#5? Worth retitling/dating if so, or moving to `archive/stale/` if superseded.

## 🟠 Ongoing hardening work (not blocking)

- [ ] **Migrate ~35 legacy authenticated routes to `scopedClient(auth)`**. Today they use raw `createServiceClient()` + manual `.eq("tenant_id", auth.tenantId)`. Two routes migrated as proof (`/api/v1/team` GET, `/api/v1/notifications` GET). The wrapper handles tenant filter auto-injection; new routes must default to it. Migrate at the rate of "every route I'm already editing for another reason" — no big-bang refactor.
- [ ] **Wire `events` table → webhook dispatcher**. Mutations emit to `events`; the dispatcher exists but isn't consuming. Until then, webhook delivery is broken.
- [ ] **Build per-industry AI agent prompts/tools**. The `industries/<id>/ai/agent.ts` slots exist and the manifest type reserves an `ai` field, but no real prompts/tools are wired. Education-consultancy first when prioritized.

## ✅ Recently resolved

- 2026-05-24 — **Industry module foundation (Path C) shipped**. `src/industries/` is now a first-class architectural concept with 7 industry folders, registry, loader, manifests. Student check-in and form-builder migrated into `industries/education-consultancy/features/`. Sidebar reads manifests (no more ternary). API gates added to all check-in and form-config routes (the check-in API was previously ungated for non-education tenants). CLAUDE.md restructured around the new pattern. `scopedClient(auth)` hardening wrapper added with 2 proof migrations. See SESSION-LOG.
- 2026-05-24 — **PR #9 verification done** as part of the industry-modules work — form-builder was understood, migrated, and re-gated. The form-builder paths in CLAUDE.md are now accurate.
- 2026-05-24 — **Branch sync resolved** — rebased local onto `origin/stage` cleanly. The 4 prior local docs commits replayed without conflicts.
- 2026-05-24 — **SESSION-LOG backfill** written for the March–May shipped-work gap (PRs #4–#8 + commits `f728ca8` → `b890c35`).
- 2026-05-24 — Doc layout reorganized to match Stella+Zunkiree brain-folder pattern: SESSION-LOG.md as single source of truth, `reference/` for stable docs, `archive/<series>/` for shipped work.

---

## How this board works

- **🔴 Needs decision / action**: blocking items that require Sadin's input before a new session can move forward productively.
- **🟡 Open questions**: non-blocking ambiguities worth resolving when convenient.
- **✅ Recently resolved**: rolling log of items closed in the last few weeks — keeps the why-it-changed paper trail near where decisions were made.

Items here should be specific and actionable. If something becomes a multi-step project, write a `<CONTEXT>-BRIEF.md` at the top of `docs/` and link from here.
