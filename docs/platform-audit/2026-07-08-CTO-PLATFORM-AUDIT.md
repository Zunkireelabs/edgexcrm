# EdgeX CRM — CTO Platform Audit

**Date:** 2026-07-08
**Auditor:** Opus session (CTO-lens review; 5 parallel deep audits — architecture, data layer, API/security, performance, infrastructure)
**Scope:** ~123k lines TS/TSX, 218 API routes, 62 pages, 126 migrations. Critical findings independently verified against code and both live databases (stage `dymeudcddasqpomfpjvt`, prod `pirhnklvtjjpuvbvibxf`).

---

## Executive verdict

**Directionally right. The architecture is not the problem — execution gaps are.** The industry-module pattern, the tenant-isolation design, the gated migration pipeline, and the Next.js + Supabase stack are sound choices for this stage and will carry the product to hundreds of tenants. What will hurt is not a wrong stack decision but four specific debts: **two live security holes (verified on prod), a dashboard that shows wrong numbers today, zero observability, and near-zero tests.** All four are fixable in weeks, not months.

The honest one-liner: *this is a well-architected product with startup-grade operations bolted on. The gap between the two is now the biggest risk.*

## Scorecard

| Dimension | Grade | One-line summary |
|---|---|---|
| Architecture & modularity | **B+** | Industry-module system genuinely well designed; 21 hardcoded industry checks leak past it |
| Data layer & tenant isolation | **B** | Near-total RLS coverage, disciplined migrations; but 216/218 routes bypass RLS via service-role |
| API design | **B** | Consistent helpers, exemplary public-submit endpoint; validation only ~36% adopted |
| Security | **C–** | Two verified HIGH holes on prod (§ P0 below) |
| Performance & scalability | **C** | APIs paginate correctly; pages don't — already biting at 17k leads |
| CI/CD | **A–** | Gated prod-migration pipeline is principal-grade work |
| Testing | **F** | 2 test files, 45 lines, on a multi-tenant SaaS |
| Observability | **F** | No error tracking, no alerting, logs die on every deploy |

---

## 🔴 P0 — verified, act this week

### 1. `lead-documents` bucket is PUBLIC on production ✅ VERIFIED
Confirmed via `storage.buckets` query on **both** stage and prod: `lead-documents.public = true` (the other two buckets, `employee-photos` and `knowledge-base-files`, are correctly private). The bucket holds passports, financial statements, and transcripts for education tenants. Anyone with a URL can read them, and paths are semi-predictable — `{tenant-slug}/{sessionId}/{fieldName}.ext`, where only `sessionId` is unguessable.

- **Fix:** flip the bucket private; serve via short-lived signed URLs like the other buckets.
- **Code touchpoints:** `src/app/(main)/api/v1/upload/route.ts:114` (`getPublicUrl`), `src/app/api/public/consent/[token]/route.ts:215`.

### 2. `POST /api/v1/upload` has zero authentication ✅ VERIFIED
Read the route directly: no `authenticateRequest`, no API key. `tenant_id` comes from the request body; any anonymous caller can mint signed upload URLs into any tenant's bucket. Rate limiting (20/10min per tenant+IP) and MIME/size checks exist, but that is abuse-throttling, not auth.

- **Fix:** if it must stay public for the widget form flow, gate it with API-key auth like the submit endpoint it feeds (per-key origin allowlist already exists in `integration-auth`).
- **File:** `src/app/(main)/api/v1/upload/route.ts`.

### 3. Dashboard stats are silently wrong today (correctness, not perf)
`src/app/(main)/(dashboard)/dashboard/page.tsx:34-68` fetches leads via `getLeads` with a **default 1000-row cap** and computes all StatsCards/charts in JS over that slice. A 17k-lead tenant's dashboard is computed over 6% of its data. Same silent-truncation pattern elsewhere:

- Contacts page: hard `.limit(500)` — `contacts/page.tsx:38-50`
- Deals: hard `.limit(500)` — `src/lib/deals/queries.ts:73-80`
- Reminders cron: `.limit(500)` due reminders per run — drops the rest once >500 due in a window
- Applications suggestions: `.limit(1000)`

**Fix:** `count: "exact", head: true` + SQL group-bys for dashboard aggregates; paginate or raise-and-alert on the caps.

### 4. Nobody would know if prod broke
No Sentry/error tracking, no uptime monitor, no alerting, no log shipping. `src/lib/logger.ts` sends prod pino logs to container stdout only — **discarded on every deploy** (container recreation). Deploy "smoke test" and container healthcheck both only assert `/login` returns 200; no `/api/health`, no DB-round-trip check. Outage discovery today is "a client complains," or a GitHub Actions cron happens to fail during the window.

**Fix (a day of work, outsized ROI):** Sentry (client+server) + a lightweight `/api/health` (DB ping) + an external uptime check + memory limits (see P1).

---

## 🟠 P1 — the scaling wall (next 30–60 days)

### Leads page ships the whole dataset to the browser
`leads/page.tsx:133` calls `getLeads(..., { limit: 50000 })`; `getLeads` (`src/lib/supabase/queries.ts:181-218`) loops 1k-row chunks sequentially — the code's own comment says *"TEMPORARY: loads the whole list into the client; proper server-side pagination is the real roadmap fix."* `leads-table.tsx` (1,993 lines) holds the entire array in `useState` and filters/sorts in JS per keystroke; the 25-row page is cosmetic; no virtualization. At 17k leads that's an estimated 10–30 MB RSC payload per page view.

**The irony: a correctly server-paginated `/api/v1/leads` route already exists** (`count:"exact"` + `.range()`). The fix is mostly wiring, not building. Same fetch-all: `leads-organise/[slug]/page.tsx:99`.

### Embeddable widget cannot be cached
`(widget)/form/[slug]/page.tsx` is `force-dynamic` → every embed impression = full SSR + 2 sequential DB round-trips on the single VPS. The `Cache-Control: s-maxage=3600` header in `next.config.ts` is **inert** — there is no CDN/caching proxy in front (Traefik doesn't cache). Fix: ISR + `revalidateTag` on form save, and/or Cloudflare in front (already in the GCP ADR). Widget client bundle itself is fine.

### No container resource limits, prod + dev on one box
`docker-compose.prod.yml` and `docker-compose.yml`: no `mem_limit`/`cpus`. One unbounded Node process serves all tenants; a couple of admins opening the 17k-lead table concurrently can OOM the container → all tenants down. Deploys are recreate-in-place → brief downtime every deploy; a bad image = extended outage until rollback. No host backup for `.env.local` secrets / Traefik certs. Add memory limits now; the durable fix is the Cloud Run ADR.

### Test coverage is effectively 0%
Vitest harness exists, the Test CI job is now required/blocking (good), but only 2 test files / 45 lines total (`_loader.test.ts`, `validation.test.ts`). No API-route, component, or tenant-isolation tests. A cross-tenant regression would ship undetected. Next suites (already planned on the roadmap): **tenant isolation, counselor scoping, getFeatureAccess matrix.**

### Counselor scoping gaps on lead sub-resources
Tenant-scoped but missing the assigned-to/own-scope check — a counselor can read these for leads NOT assigned to them:
`leads/[id]/tasks`, `leads/[id]/duplicates`, `leads/[id]/collaborators`, `leads/[id]/mentionable-users`, `leads/[id]/check-ins`. Tenant-safe, but violates the product's own access rule. Also confirm `leads/merge`, `bulk/restore` have `requireAdmin`.

### Polling + realtime fan-out
- `use-badge-counts.ts:45` (`setInterval 30s`, mounted in both `shell.tsx` and `leads-table.tsx`) + `notifications-dropdown.tsx:84` (30s) → ~4 req/min/user, uncached; badge-counts runs a `LIKE '/leads/%'` scan on unread notifications per poll.
- Supabase Realtime `postgres_changes` subscriptions (PipelineBoard, deal-board, InboxUI) — Supabase's least-scalable realtime mode; cost grows with tenants × open boards × write rate. Swap for broadcast before ~100 concurrent users.

### Cron architecture won't scale with tenants — ✅ RESOLVED (Inngest migration, 2026-07-21)
This section originally described all background work running via GitHub Actions cron (best-effort scheduling, observed 1–3 hour real-world drift regardless of the written cron expression) hitting single endpoints that loop **all** tenants in one invocation with no overlap locking (`email-poll` */5, `inbox-process` */2, `reminders-run` */5). That architecture has been retired: the 5 GH-Actions cron workflows are deleted and the same jobs now run as Inngest scheduled functions (`ops-heartbeat`, `ops-reminders-scan`, `ops-inbox-process`, `ops-email-poll`), matching the Inngest pick in ADR-001. See [`docs/reference/03-INNGEST-BACKGROUND-JOBS.md`](../reference/03-INNGEST-BACKGROUND-JOBS.md) for the current architecture, function inventory, and free-tier budget. Note: this resolves the *scheduling-reliability* half of the original concern; the "loops all tenants in one invocation with no overlap locking" per-job design is unchanged by this migration and remains a separate, still-open scaling consideration as tenant count grows.

---

## 🟡 P2 — structural debt (60–90 days)

1. **Adopt a client data-fetching library (TanStack Query).** Zero react-query/SWR today; 103 files of hand-rolled `useEffect`+`fetch` (327 `useEffect`s), no dedup/cache/invalidation. Would delete a large fraction of that code and fix the polling loops as a side effect. Highest long-term maintainability lever.
2. **Finish the half-done migrations — all >60% complete but unfinished safety layers mislead reviewers:**
   - `scopedClient(auth)`: 134/218 routes on the wrapper; 71 pure-raw remain (spot-check found no leak, but the risk is structural — manual `.eq("tenant_id")` discipline, and RLS is bypassed by service-role on 216/218 routes so it's a backstop, not enforcement).
   - `validate()` input validation: ~36% of routes (no zod anywhere; hand-rolled validators).
   - `createRequestLogger`: ~67%.
3. **De-hardcode the 21 `industry_id === "..."` checks** from shared hot paths (`leads/route.ts` ×4, `leads/[id]/route.ts` ×5, public submit, home/dashboard/leads pages, shared check-in UI). `getFeatureConfig()` in `_loader.ts` was built for exactly this. Right now adding industry #4 means editing the riskiest shared files — the thing the architecture was designed to prevent.
4. **Break up the god-components** (17 files >800 lines): `leads-table.tsx` 1,993 / `key-info-section.tsx` 1,341 / `check-in/ui.tsx` 1,225 / `activities-panel.tsx` 1,097 / `add-lead-sheet.tsx` 1,019 — all in the most-touched, least-testable surface.
5. **Query-layer bypass:** `queries.ts` is the intended data layer but 69 files hit `.from("leads")` directly, duplicating tenant-scoped lookup. Consolidate into shared helpers (e.g. `requireLeadAccess` already exists — extend the pattern).
6. **`scopedClient.update()/delete()` footgun:** only `tenant_id` is auto-applied; a forgotten second `.eq("id", ...)` mutates every row in the tenant. Un-greppable; consider a required-filter API change or lint rule.
7. **Smaller but real:**
   - `auth/register/route.ts:43` calls unexported `minLength(8)` → probable runtime error on the registration path.
   - Missing indexes: `(tenant_id, idempotency_key)` on leads (per-insert seq scan at 50k rows); GIN on `audit_logs.payload` (`.contains()` queries degrade as audit trail grows).
   - Duplicate migration numbers (110 ×2, 112 ×2) → non-deterministic order on fresh-environment rebuild; gaps at 063/092/120/125.
   - `_currentRateLimitInfo` module-level singleton in `response.ts:12` races across concurrent requests (header bleed in a persistent Node server).
   - No rate limiting on authenticated v1 routes (only public/integration paths).
   - `GET /api/v1/entities/public?tenant_id=…` returns entities for any tenant, unauthenticated — cross-tenant enumeration (low).
   - `anon` SELECT policy on `tenants` is `USING (true)` — confirm column exposure is minimal.
   - Hardcoded prod Supabase URL in `(widget)/layout.tsx:18,22` preconnects — env-derive it.
   - Recharts imported statically into dashboard bundle — lazy-load the chart components.
   - `xlsx@0.18.5` has known unpatched advisories (scripts-only usage — not in client bundle, still worth a pass).
   - Convention drift in `education-consultancy` features (`ui.tsx` vs `ui/` vs `pages/`) + unregistered orphan dirs (`lead-types`, `new-leads-triage`, `utm-analytics`) that escape the feature gate.
   - `temp_ss/`, `.aider.*`, `tsconfig.tsbuildinfo` committed — `.gitignore` pass.
   - `@types/node ^20` vs Node 22 runtime; no `engines` field; no Dependabot/Renovate.

---

## Tech stack verdict

**Next.js 16 + React 19 + Supabase + Tailwind 4 is the right stack — stay on it.** For a multi-tenant CRM at current scale (3 tenants, ~17k leads max), Postgres-with-RLS + a single well-structured Next app is the correct choice. Do NOT microservice, do not add Kubernetes, do not switch databases. Two caveats:

1. **Bleeding edge everywhere at once** (Next 16, React 19, Tailwind 4). Deliberate trade — faster CVE/regression exposure and smaller ecosystem in exchange for no future migration tax. Acceptable, but one more reason error tracking is non-negotiable.
2. **The single VPS is the real infra ceiling, not Supabase.** The existing GCP ADR (Cloud Run + keep Supabase + Cloudflare edge) is the correct answer — sequence it **after** the P0s and the leads-pagination fix, because moving a fetch-all app to Cloud Run just buys a more expensive place to OOM.

## What's genuinely excellent — keep doing this

- **Industry-module system** (`_registry`/`_loader`/manifests, defense-in-depth gating: manifest AND meta must both claim the industry). Better than most Series-B SaaS.
- **Gated prod-migration pipeline** (pure-git `migrate-check` → environment-approval gate → migrate-before-deploy, fail-closed connectivity probe, advisory lock, per-file transactions + self-record ledger). Principal-grade.
- **RLS coverage near-total**: 85/86 tables, 301 policies, SECURITY DEFINER helpers with pinned `search_path`.
- **Public form-submit endpoint**: hashed keys + constant-time compare + scopes + per-key origin allowlist + idempotency with unique-index race handling. Exemplary.
- **Type safety**: 21 `any`s, zero `ts-ignore`, in 123k lines. Outstanding.
- **Past incidents properly guard-railed**: the `.in()` undici-overflow fix is capped and documented in code; bulk routes hard-reject >100 ids.

## Recommended sequence

1. **This week (P0):** private bucket + signed URLs; auth on `/api/v1/upload`; Sentry + `/api/health` + uptime monitor; container memory limits.
2. **Next 30 days:** dashboard stats via SQL counts (correctness); leads page onto the existing paginated API + server-driven table; widget ISR/CDN caching; counselor-scoping gaps.
3. **Next 60–90 days:** tenant-isolation + counselor-scoping test suites; TanStack Query adoption; finish scopedClient/validate rollout; de-hardcode industry checks; god-component breakup.
4. **Then:** execute the Cloud Run ADR from a position of strength.

## Corrections to project docs

- **CLAUDE.md tenant-isolation numbers are stale:** claims "~35–37 of ~47 routes raw." Reality: 218 routes; 134 on `scopedClient`, 71 pure-raw, 10 mixed. Update so future sessions calibrate correctly.
- Route count ("~47") and the scoped-migration tracker on STATUS-BOARD should be refreshed against these numbers.
