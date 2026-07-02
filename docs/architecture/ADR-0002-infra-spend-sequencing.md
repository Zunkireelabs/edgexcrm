# ADR-0002 — Infrastructure Spend Sequencing (Supabase Pro vs GCP credit)

- **Status:** Approved (2026-07-02)
- **Scope:** EdgeX; sets the ZunkireeLabs default posture.
- **Deciders:** Sadin + Architecture (CAO).
- **Relates to:** [ADR-0001](./ADR-0001-gcp-adoption-strategy.md) (unchanged by this decision).

## Context

Two spend options were on the table, framed as a choice:
1. Use a **$300 GCP credit** to migrate off the current stack onto GCP.
2. Take a **Supabase paid plan**.

…with the standing constraint that **all ZunkireeLabs platforms must become AI-native**.

Key facts that decide it:
- The $300 GCP credit is the standard **90-day free trial** — time-boxed evaluation money, not
  a migration budget. It expires and cannot fund a production migration.
- EdgeX runs **live customer data on prod** (Admizz, incl. student PII). Supabase **free tier
  has no daily backups** — an unacceptable production risk *today*.
- The AI-native retrieval layer is already designed (`docs/reference/02-ARCHITECTURE-AI-KNOWLEDGE-LAYER.md`):
  `knowledge_chunks` + **pgvector inside the existing Supabase Postgres**; documents on Supabase
  Storage → Cloudflare R2 target; the blueprint **explicitly rejects GCS** (egress cost). So
  "AI-native" pulls *deeper into Supabase + Cloudflare*, not toward GCP.
- Moving off Supabase Postgres/Auth/Realtime was already ruled out in ADR-0001 (heavy coupling).

## Decision

1. **Take Supabase Pro (~$25/mo) now.** It is both a production necessity (daily backups + PITR
   for live customer/PII data, bigger DB + compute for Admizz's 6k+ leads, no project pausing)
   **and** the AI-native engine (pgvector runs in this Postgres — "~3 orders of magnitude below
   pgvector's pain point"). Highest-leverage spend by far.
2. **Do NOT migrate production to GCP on the $300 credit.** Use it as a **staging sandbox**:
   stand up the ADR-0001 / Track B Cloud Run prototype on *staging only*, prove zero-downtime
   deploys + autoscale at ~$0, then migrate prod later with real budget.
3. **Pursue Google for Startups credits ($2k–$200k+)** before any real GCP prod spend — that,
   not the $300 trial, is the strategic lever that funds Cloud Run + Vertex + BigQuery at scale.

## Alternatives considered

- **Go all-in on GCP using the $300 (drop Supabase).** Rejected: ADR-0001 coupling audit + the
  90-day expiry + the AI-native layer living in pgvector make this high-cost, high-risk, and
  self-sabotaging (weakens the very backbone the AI layer needs).
- **Stay entirely on Supabase free tier, skip both spends.** Rejected: no daily backups on live
  PII data is an unacceptable production risk.
- **Supabase Pro only, no GCP at all.** Viable near-term, but forecloses the reliability/scale
  wins (zero-downtime, autoscale) and the AI-native inference/analytics path. Kept as the
  fallback if GCP evaluation disappoints.

## Consequences

- Immediate: production gets daily backups + more headroom; AI-native (pgvector) work is
  unblocked on paid compute.
- GCP enters at **zero cost** via a staging Cloud Run prototype — decoupled from prod risk.
- No change to ADR-0001; this only confirms sequencing (Supabase stays and is upgraded; GCP is
  additive, funded first by the $300 sandbox then by Startups credits).

## Trade-offs accepted

- Paying Supabase Pro *and* (later) GCP means two paid clouds — accepted, same rationale as
  ADR-0001 (consolidating means the rejected rewrite; net lock-in stays low).

## Follow-up actions

- [ ] Upgrade the **prod** Supabase project (`pirhnklvtjjpuvbvibxf`) to Pro; confirm daily
      backups + PITR are on. (Dev/stage `dymeudcddasqpomfpjvt` can stay free or Pro as budget allows.)
- [ ] Apply for **Google for Startups** credits.
- [ ] When ready, run the Track B Cloud Run prototype on **staging** against the $300 credit.
