# Status Board — Lead Gen CRM

> Live checklist of open user-side actions, decisions, and questions. Companion to [SESSION-LOG.md](./SESSION-LOG.md). Update as items resolve.

Last updated: 2026-05-25 (post-phase-3, mid-time-tracking-build)

---

## 🔴 Needs Sadin decision / action

- [ ] **Phase 4 of Time Tracking in flight via Sonnet**. When Sonnet reports back (branch `feature/time-tracking-phase-4` + commit SHA), hand the report to Opus for review. Opus pulls → builds → lints → starts dev server for local verify → merges to stage + pushes if green.
- [ ] **Promote `stage` → `main` for production**. Everything on staging today is unshipped to prod: industry module foundation, hardening, Anish's view-details, time-tracking phases 1–3. Recommend doing this **after time-tracking v1 completes** (Phase 5), but Sadin's call.
- [ ] **`PRICING.md` at repo root**: duplicate of `docs/reference/PRICING.md`. Delete the root copy (recommended).

## 🟡 Open questions

- [ ] `docs/archive/research/ai-insight-*` (2026-03-28) — `013_lead_insights` migration + `/api/v1/ai/chat` stub suggest partial implementation. Is the AI insight feature still on the roadmap, or are the stubs dormant? The new `industries/<id>/ai/agent.ts` slots are reserved for per-industry prompts — when this work gets prioritized, that's the home.
- [ ] `docs/feature/email-automation/` was empty when the docs were reorganized — the actual email-forward + Gmail OAuth feature shipped via `f728ca8` (May 4). Was the empty dir a stale placeholder? Safe to confirm-and-delete.
- [ ] Older planning docs `docs/archive/plans/enhanced-dashboard.md` and `lead-detail-redesign.md` (2026-03-27) — were these the briefs for PRs #4–#5? Worth retitling/dating if so, or moving to `archive/stale/` if superseded.
- [ ] **Promote tags UI to `_shared/` when a 2nd industry wants tags**. Today Student/Parent labels are hardcoded in education's check-in UI. When IT or another industry wants tags, move the UI to `src/industries/_shared/features/lead-tags/` and let each manifest define its own label set (Student/Parent vs Hot/Warm/Cold vs Buyer/Seller etc.) via per-industry config. Not blocking.

## 🟠 Ongoing hardening work (not blocking)

- [ ] **Migrate ~33 legacy authenticated routes to `scopedClient(auth)`**. Today they use raw `createServiceClient()` + manual `.eq("tenant_id", auth.tenantId)`. Four routes migrated as proof (`/api/v1/team` GET + DELETE, `/api/v1/notifications` GET). The wrapper handles tenant filter auto-injection + strips caller-supplied `tenant_id` from update/insert payloads; new routes must default to it. Migrate at the rate of "every route I'm already editing for another reason" — no big-bang refactor.
- [ ] **Wire `events` table → webhook dispatcher**. Mutations emit to `events`; the dispatcher exists but isn't consuming. Until then, webhook delivery is broken.
- [ ] **Build per-industry AI agent prompts/tools**. The `industries/<id>/ai/agent.ts` slots exist and the manifest type reserves an `ai` field, but no real prompts/tools are wired. Education-consultancy first when prioritized.
- [ ] **Address remaining low-severity code-review findings**: typed-as-`keyof typeof INDUSTRY_ICONS` for icon names (catch typos at compile time), runtime warning when scopedClient.insert silently overrides caller tenant_id, telemetry for industries-not-in-registry. None are bugs today; all worth doing on the next sweep.

## ✅ Recently resolved

- 2026-05-25 — **Time Tracking Phases 1–3 shipped to stage** via the Opus-plans / Sonnet-executes workflow. Phase 1 (schema + manifest + 5 placeholder shells), Phase 2 (Accounts/Projects/Tasks CRUD), Phase 3 (time entries log + list + edit, with a timezone bug caught + fixed mid-review). Migration 020 applied live. 3 staging deploys succeeded. Phase 4 (Approvals) is currently in Sonnet's hands.
- 2026-05-25 — **Workflow split formalized**: Opus plans/reviews/pushes-to-stage; Sonnet executes feature code on per-phase branches; Sonnet never pushes to stage. Local-verify-before-push is the new flow (added mid-Phase-1, caught the timezone bug before it shipped).
- 2026-05-25 — **First IT-agency feature decided: Time Tracking.** Brief written at `docs/TIME-TRACKING-BRIEF.md`.
- 2026-05-25 — **Anish onboarded.** Prompt sent; he'll pull stage, read CLAUDE.md + `docs/reference/01-ARCHITECTURE-INDUSTRY-MODULES.md` + the migration playbook before starting his next feature.
- 2026-05-25 — **Anish's `view-details` branch adapted and merged into `stage`**. 3 commits (View Details panel, Student/Parent tags, tag selector in add form) cherry-picked onto the new industry-module structure. Git rename detection ported the check-in changes to the new file location automatically — zero manual conflict resolution. Migration 019_lead_tags.sql backfilled to close the schema-drift gap (Anish had applied the ALTER TABLE directly via MCP). Adapter branch and Anish's original branch both deleted.
- 2026-05-25 — **Architecture explainer + migration playbook added**. `docs/reference/01-ARCHITECTURE-INDUSTRY-MODULES.md` (visual old-vs-new comparison) linked from CLAUDE.md in two places. New CLAUDE.md subsection "Migrating an existing flat-pattern feature" gives a 10-step checklist for adapting old-pattern code. Together they make the onboarding path explicit so the next developer (or Claude session) doesn't have to derive the pattern from code archaeology.
- 2026-05-25 — **Code-review hardening pass**. RSC boundary bug (icon as function) fixed before any user hit it on prod; scopedClient cross-tenant escape closed (strips tenant_id from update/insert); auth.ts defensively handles tenants embed array vs object; getManifest(null) falls back to general; FeatureId typed in loader signatures. 11 of 15 review findings addressed; 4 low-severity items remain on the ongoing list.
- 2026-05-24 — **Industry module foundation (Path C) shipped**. `src/industries/` is now a first-class architectural concept with 7 industry folders, registry, loader, manifests. Student check-in and form-builder migrated into `industries/education-consultancy/features/`. Sidebar reads manifests (no more ternary). API gates added to all check-in and form-config routes (the check-in API was previously ungated for non-education tenants). CLAUDE.md restructured around the new pattern. `scopedClient(auth)` hardening wrapper added with proof migrations. See SESSION-LOG.
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
