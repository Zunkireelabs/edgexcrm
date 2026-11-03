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

The "Parked" items were archived as written. They were **not** ticketed in this pass; see the archive and the EDGEX-33 ticket.
