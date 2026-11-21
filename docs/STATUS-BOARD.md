# Status Board — EdgeX

> **📋 Plane is the board (from 2026-11-03).** Open actions, blockers and questions for Sadin are tickets in Plane, project **EdgeX** (key `EDGEX`, `https://app.plane.so/zunkireelabs/`). Questions only the owner can answer are `DECIDE …` tickets. The generated to-do file is [`tasks/TRACKER.md`](../tasks/TRACKER.md) (made by `/project-pm sync`, never hand-edited). **Do not add to-dos to this file.**

This file now keeps only **where things went**. The full previous text (every Live, Parked and Recently-closed item, with its context) is in [`archive/STATUS-BOARD-ARCHIVE-2026-11-03.md`](./archive/STATUS-BOARD-ARCHIVE-2026-11-03.md); the earlier triage archive is [`archive/STATUS-BOARD-ARCHIVE-2026-09-07.md`](./archive/STATUS-BOARD-ARCHIVE-2026-09-07.md). Engineering lessons live in [`reference/06-ENGINEERING-LESSONS.md`](./reference/06-ENGINEERING-LESSONS.md).

## Where the 2026-09-07 "Live" items went (EDGEX-33)

All carry `needs-verification` in Plane, because the source text is from 2026-09-07 or earlier.

| Former Live item | Plane |
|---|---|
| Verify Langfuse masking against first real prod Orca traces | EDGEX-19 |
| Register a branded SMS sender ID with NTC/Ncell | EDGEX-20 |
| Back up the prod `.env.local` secrets | EDGEX-21 |
| Remove `OLD_SUPABASE_*` from prod `.env.local` + rotate the old key | EDGEX-22 |
| Delete/rename the stray dev `docker-compose.yml` on the prod box | EDGEX-23 |
| CI never runs 22 integration tests | EDGEX-24 |
| Tell Admizz that Orca is live | EDGEX-25 |
| Advanced filters: Phase 3.5 facet-count verification before the prod flag flip | EDGEX-26 |
| Admizz "email campaigns from admizz.com": Brevo or EdgeX Outreach? | EDGEX-27 (DECIDE) |
| Backlog PR triage | EDGEX-18 (DECIDE #91/#33); #396 → EDGEX-17, #417 → EDGEX-16; #26/#98/#134/#176/#177/#285/#310 are closed on GitHub (checked 2026-11-03) |

## Where the 2026-09-07 "Parked" items went

| Former Parked item | Plane |
|---|---|
| Migrate the remaining legacy authenticated routes (67) to `scopedClient(auth)` | EDGEX-36 |
| AI-native Phase 5: env vars (`AI_TOOL_APPROVAL_SECRET` overdue on stage, `AI_AGENTS_ENABLED`, `AI_MCP_ENABLED`) | EDGEX-34 |
| AI-native Phase 5: stage PR + deferred live verifications | EDGEX-35 |
| Lead Detail Associations Rail (built, awaiting review + smoke) | EDGEX-37 |
| Domain migration `lead-crm` → `edgex` (EDGEX-DRAIN, then Phase 3) | EDGEX-38 |
| IT-agency surface pass (paused) | EDGEX-39 |
| PROD-WEDGE leftovers (stray compose rename, memory sampler, capacity decision) | EDGEX-40 |
| `deriveHomeTip` server-timezone day boundaries | EDGEX-41 |
| Wire `events` → webhook dispatcher | EDGEX-42 |
| Per-industry AI agent prompts/tools | EDGEX-43 |
| Time Tracking smoke gaps | EDGEX-44 |
| Promote tags UI to `_shared` | EDGEX-45 |
| `DELETE /api/v1/email/inboxes/[id]` FK check | EDGEX-46 |
| Shared deploy concurrency group (optional) | EDGEX-47 |
| Low-severity code-review findings | EDGEX-48 |
| CLAUDE.md "Developer Persona & System Guardrails" fate | EDGEX-49 (DECIDE) |
| `ai-insight` stubs: dormant or on the roadmap? | EDGEX-50 (DECIDE) |

The "Recently closed" items were already done; they are kept in the archive only.
