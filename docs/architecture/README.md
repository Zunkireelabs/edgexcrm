# ZunkireeLabs Architecture Register

This folder is the **authoritative technical record** for how ZunkireeLabs products are
architected. It has two kinds of documents:

1. **`REFERENCE-ARCHITECTURE.md`** — the canonical stack + patterns ("the golden path").
   Every new product starts here. EdgeX is the reference implementation.
2. **`ADR-NNNN-*.md`** — Architecture Decision Records. Each significant architectural
   decision is captured once, with rationale, alternatives, trade-offs, and status.
   Decisions never change silently — they are superseded by a new ADR.

## ADR status values
`Proposed` → `Approved` → `Superseded` / `Deprecated`

## Decision log

| ADR | Title | Status | Date |
|-----|-------|--------|------|
| [ADR-0001](./ADR-0001-gcp-adoption-strategy.md) | GCP adoption strategy — compute + AI/data on GCP, data/auth/realtime stays on Supabase | **Approved** | 2026-07-02 |

## How to add an ADR
1. Copy the format of ADR-0001. Number sequentially.
2. Fill: Context · Decision · Alternatives considered · Consequences · Trade-offs · Status.
3. Add a row to the table above.
4. If it changes a prior decision, set the old ADR's status to `Superseded by ADR-NNNN`.

> Owner: Architecture (CAO). Reviewed before any infra or cross-cutting change.
