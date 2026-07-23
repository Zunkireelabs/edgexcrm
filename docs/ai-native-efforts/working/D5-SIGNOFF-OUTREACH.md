# D5 Sign-off Sheet — Outreach AI-Drafting (it_agency only)

> **Purpose:** the minimum, scoped decision needed to promote **outreach AI-drafting** to production for one or more `it_agency` tenants. This is the ADR-001 **Decision 5** gate, narrowed to a single feature so the smallest safe step can be taken independently of the wider AI/Orca rollout.
>
> **Authoritative source:** `docs/ai-native-efforts/00-DECISIONS-ADR.md` § Decision 5 + D5 Amendment (2026-07-19). Where this sheet and the ADR disagree, the ADR wins.
>
> **Accountable owner:** Sadin. **Prepared by:** Opus session, 2026-07-23.

---

## 1. What is being turned on

The optional **"Draft with AI"** helper on the outreach email-sequencing feature (`FEATURES.OUTREACH`). It is already built, merged, and live **on stage** (PR #282, migration 178). This sheet authorizes its promotion to **production**.

**Feature is `it_agency`-only.** Only the `it_agency` manifest registers `FEATURES.OUTREACH`, so the *only* tenants that can ever use it are:

| Tenant | Slug | Relationship | External consent needed? |
|---|---|---|---|
| **Zunkiree Labs** | `zunkireelabs-crm` | **Our own company** (the vendor) | **No** — we are controller + processor of our own data |
| **Mobilise** | `mobilise` | **External client** (`kk@mobilise.agency`) | **Yes** — their leads' PII would egress; needs notice + consent first |

**Admizz (education, real student PII) is NOT in scope** — it doesn't have the outreach feature. This sheet cannot enable AI for Admizz.

---

## 2. What data would leave EdgeX, and to whom

When a rep on an **enabled** tenant clicks "Draft with AI" (or a step is set to auto-AI), this is sent to **OpenAI** (`gpt-4o-mini`) to generate the draft:

- Lead: **first name, last name, email, city, country, and any custom fields** on that lead.
- Context: sequence name/description, step number, and the step's AI instructions.

Nothing else. **Send is unchanged** — the rep still copies the draft into their own inbox; EdgeX does not send it, and no email/Gmail egress changes. Template steps never call the model.

**Sub-processors touched by this feature:**
- **OpenAI** — receives the lead details above + returns the draft. *Not used for training* (API default); **retained by OpenAI up to 30 days for abuse monitoring, then deleted.** (True zero-retention is not available on our plan — any disclosure must say "30-day", not "zero".)
- **Langfuse** (observability) — receives run/tenant/user **IDs + token counts only**, PII-masked, fails closed. No lead content, no draft text.
- **Inngest** (draft-due reminders) — event **IDs only**, no tenant content.

---

## 3. The gate (both required; either one false = no AI, zero model calls)

1. **Env flag** `AI_OUTREACH_DRAFT_ENABLED=true` in prod `deploy.yml` — currently **absent** (this is what keeps prod AI dark).
2. **Per-tenant** `tenants.ai_enabled = true` — currently **false** for every tenant.

Both must be true for a given tenant before a single token is sent.

**Prod schema is already ready (verified 2026-07-23).** The AI-foundation migrations (168 `ai_usage_events`, 174 `tenants.ai_enabled`, 176/177 email-sequences) are **already on the prod ledger** — prod has been schema-ready but flag-dark. The **only** DB delta this promotion carries is **migration 178** (`email_sequence_steps.ai_instructions`). So the prod promotion is small: mig 178 + the #282 code + the env flag + the tenant flip(s).

---

## 4. Sign-off checklist

### A — Provider posture (one-time, applies to all AI)
- [ ] **OpenAI org confirmed "no training on API data"** (it's the default — verify nobody enabled data-sharing on the org).
- [ ] **`AI_PROVIDER=openai`** is (and stays) the prod value — provider is a privacy decision; changing it later re-triggers disclosure.

### B — Disclosure (one-time)
- [ ] **Privacy policy updated** to name the AI sub-processors used by this feature — **OpenAI** (draft generation) and **Langfuse** (masked traces) — and to state the **honest 30-day OpenAI retention** (not "zero retention").

### C — Per-tenant consent
- [x] **Owner attests consent is on file for all tenants (Sadin, 2026-07-23):** AI was pitched as a core feature to customers; the required consents (covering AI processing + sub-processors) are in place. *(Follow-up: link/attach the consent records here for the audit trail.)*
- [x] **Zunkiree Labs** (`zunkireelabs-crm`): our own tenant — cleared.
- [x] **Mobilise** (`mobilise`): consent on file per the owner attestation above — cleared.

### D — Technical promotion (done by Opus/Sonnet once A–C are checked)
- [ ] Add `AI_OUTREACH_DRAFT_ENABLED=true` to prod `deploy.yml` (mirrors the existing stage line).
- [ ] Promote code + migration 178 via a normal `stage → main` PR (migrate-before-code gate applies; needs ani-shh approval).
- [ ] After deploy, enable the approved tenant(s) with `scripts/set-tenant-ai.sh` (below).
- [ ] Verify: on the enabled tenant, "Draft with AI" works and produces a real draft; on a non-enabled it_agency tenant (if any), the button is hidden and the route 403s.

---

## 5. Approved scope

**Full it_agency scope — Zunkiree Labs + Mobilise** (owner decision, 2026-07-23; consent on file for both per § C). Both are the only tenants with the outreach feature. Suggested execution order: enable **Zunkiree Labs first** (dogfood, own data), confirm a real draft works in prod, then enable **Mobilise** in the same session.

---

## 6. Exact enablement commands (prod)

```bash
# PROD_DB_URL is in CLAUDE.md § Credentials (ap-south-1 pooler).
# Zunkiree Labs (recommended first):
PROD_DB_URL='postgresql://…' scripts/set-tenant-ai.sh prod zunkireelabs-crm on

# Mobilise — ONLY after C-Mobilise is checked (consent on file):
PROD_DB_URL='postgresql://…' scripts/set-tenant-ai.sh prod mobilise on
```

**Rollback** (instant, no deploy, no data change) — flip the tenant back off:
```bash
PROD_DB_URL='postgresql://…' scripts/set-tenant-ai.sh prod zunkireelabs-crm off
```
(Or remove the env flag from `deploy.yml` to disable the feature for every tenant at once.)

---

## 7. Explicitly OUT of scope of this sheet

- Any **Admizz** AI enablement (student PII) — separate, later, needs the full consent flow.
- The **AI assistant / knowledge-layer / Orca write-tools** (`AI_ASSISTANT_ENABLED`, etc.) — different flags, different data, not touched here.
- **Native EdgeX sending** — send stays manual-copy; that's the separate email-productionization track.

---

## 8. Decision

> **I authorize promoting outreach AI-drafting to production for the tenant(s) checked in § C, having confirmed § A and § B.**

- **Tenant(s) approved:** `zunkireelabs-crm` + `mobilise` (full it_agency scope)
- **Signed:** Sadin Shrestha   **Date:** 2026-07-23
- **Notes / conditions:** Owner attests consent is on file for all tenants (AI pitched as a core feature). Provider stays OpenAI; disclosure to state honest 30-day retention. Audit follow-up: attach the consent records to § C.
