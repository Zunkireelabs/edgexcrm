# Forms & Lead-Intake API — Audit & Discussion Brief

**Date:** 2026-06-07
**Author:** Opus planning/review session (with Sadin)
**Audience:** Anish, Hardik, Sadin — team discussion on architecture + discipline
**Status:** In-flight brief. Archive to `docs/archive/research/` after the discussion.

> **Purpose.** While shipping a small feature (per-form → pipeline routing) for the new **Prime Ceramics** tenant, we hit a wall that turned out not to be a one-off bug but a set of **structural and process problems** in how forms and the lead-intake API are built. This brief documents every finding with evidence, rates severity, and proposes fixes — framed around *structure and discipline*, not blame. **Our own planning/review process is critiqued here too** (Section 6); the misses were not only in the existing code.

---

## 1. Executive summary

| # | Finding | Severity |
|---|---|---|
| F1 | **Two parallel lead-creation paths** for forms (`/api/v1/leads` and `/api/public/submit/...`), each re-implementing pipeline/stage resolution. A third copy lives in the CRM-integration endpoint. No single source of truth. | 🔴 High |
| F2 | **No server-side validation of submissions against the form's fields.** The API stores arbitrary `custom_fields`; declared form fields are ignored. | 🔴 High |
| F3 | **API keys are tenant-scoped but NOT form-scoped, and key permissions are not enforced** at the submit endpoint. | 🟠 Medium |
| F4 | **Open CORS (`*`) + no origin allowlist.** If a key is used in front-end JS (the obvious "submit from our website" pattern), it is effectively public. | 🔴 High |
| F5 | **Form "integration mode" (hosted vs API) is implicit and undocumented.** A form can have zero fields yet collect leads, which looks broken. | 🟠 Medium |
| F6 | **Process: feature was built/reviewed against a wrong assumption** (wrong endpoint), passed build+lint+code-review, but was **never exercised end-to-end**. | 🔴 High |
| F7 | **Schema-ahead-of-code drift:** a migration was applied to the shared/prod DB before the code that uses it was deployed. | 🟡 Low |
| F8 | **Board "leads in both pipelines"** — source filters correctly; symptom is a stale running view. Needs confirmation (container image vs source / browser cache). | 🟡 Low (verify) |

**The throughline:** features are bolted onto a base where the same concept (lead routing, lead creation) is copy-pasted across multiple endpoints, and where the API accepts un-validated data. We built *on top of* that instead of fixing the seam.

---

## 2. How forms & lead intake actually work today

There are **two integration modes**, served by **two different endpoints** — and most people don't realize both exist.

### Mode A — Hosted form / iframe embed (no-code)
- Built in the CRM form builder (fields, branding, steps).
- `/forms` exposes a shareable URL (`…/form/{tenant}/{slug}`); the client embeds it in an `<iframe>`.
- Renders at the `(widget)` route — `src/app/(widget)/form/[slug]/page.tsx` (`force-dynamic`) → `PublicForm` (`src/components/form/public-form.tsx`).
- **Submits to `POST /api/v1/leads`** — `public-form.tsx:265` and `:372`. No API key required (public route keyed off `body.tenant_id`).
- The CRM owns field rendering, client-side validation, dedup, sessions.

### Mode B — API integration (developer-built UI)
- The client builds their own form markup and **POSTs JSON** to **`POST /api/public/submit/{tenantSlug}/{formSlug}`** — `src/app/api/public/submit/[tenantSlug]/[formSlug]/route.ts`.
- Requires a **form API key** (Bearer token) — `authenticateIntegrationRequest` (`route.ts:67`). Rate-limited, CORS-enabled.
- The CRM's field definitions are **not enforced**; the client owns the UI and validation.

### The CRM-integration endpoint (a third lead-creation path)
- `src/app/(main)/api/v1/integrations/crm/leads/route.ts:226-259` — yet another lead-create path with its **own** default-stage lookup, and it **never sets `pipeline_id`** (latent bug, already tracked on STATUS-BOARD).

**So "where does a new lead come from / which pipeline does it land in?" is answered independently in 3 places.** That is the root cause of most of what follows.

---

## 3. The Prime Ceramics example (concrete)

| | **Request a Quote** | **Download Catalogue** |
|---|---|---|
| Fields defined | 6 (`your_name`, `phone_number`, `email`, `project_type`, `tile_size`, `message`) | **0** |
| Target pipeline | none (→ Default) | Catalogue |
| Leads collected | 3 | 6 |
| Hosted-form submissions (`session_id`) | **0** | **0** |
| API submissions (`intake_source='api'`) | **3 (100%)** | **6 (100%)** |

**Both forms are used purely as Mode-B API endpoints.** The client's developer built their own forms on the Prime Ceramics website and POSTs JSON (e.g. `custom_fields: {source:"catalog-download", catalog:"Wall Tiles 300×450MM…"}`). That's why "Download Catalogue" has **no fields but still collects leads** — for an API integration, the builder's fields are irrelevant.

---

## 4. Findings in detail

### F1 — Duplicated lead-creation logic / no single source of truth 🔴
**What:** Pipeline + stage resolution for a new lead is implemented separately in:
- `/api/public/submit/.../route.ts:143-211` (Mode B; now has the routing resolver)
- `/api/v1/leads/route.ts:238-280` (Mode A; `pipelineId = body.pipeline_id || defaultPipeline.id`, **no** `target_pipeline_id` lookup)
- `/api/v1/integrations/crm/leads/route.ts:226-259` (no `pipeline_id` at all)

**Impact:** Any change to routing/intake behavior must be made in 3 places and is silently easy to miss one. This *directly* caused F6.
**Fix:** Extract one shared `resolveLeadPipelineAndStage(formConfig, body, tenant)` (and ideally a single `createLead()` service) that every path calls.

### F2 — No server-side validation against the form schema 🔴
**What:** The submit route writes `custom_fields: body.custom_fields || {}` (`route.ts:368`) with **zero** checks: no required-field enforcement, no "is this field declared on the form?", no type checks. Field validation exists **only** client-side in `public-form.tsx` (Mode A), which API callers bypass.
**Impact:** Garbage-in/garbage-stored; required fields not guaranteed; no data contract. Forms with 0 fields accept anything (see F5).
**Good news (not a hole):** system/ownership fields **cannot** be injected — `tenant_id`, `pipeline_id`, `stage_id`, `status`, `form_config_id` are server-resolved (`route.ts:354-358`); `assigned_to` is not settable. So this is a **data-quality** gap, not mass-assignment.
**Fix:** Validate the payload against the form's declared fields server-side (shared validator used by both modes), or explicitly mark a form "API mode, schema-free" and document that.

### F3 — Keys tenant-scoped but not form-scoped; permissions unenforced 🟠
**What:**
- A key is bound to one tenant (`integration_keys.tenant_id`, `005_integration_keys.sql`) and the route enforces tenant match (`route.ts:103`). ✅
- But there is **no per-form binding** — any valid tenant key can submit to **any** active form in that tenant. No `form_id` on the key.
- Keys carry `permissions text[]` (default `{read,write}`) and `permissions_detail` category (`007_integration_permissions.sql`), but the submit route performs **no permission check** (`grep permission` on the route → nothing). A `read`-only key could create leads.
**Impact:** A key leaked/issued "for one form" works for all forms; the scope model is decorative at this endpoint.
**Fix:** Bind keys to a form (or form set); enforce a `submit`/`write` permission at the endpoint.

### F4 — Open CORS + no origin allowlist → key exposure 🔴
**What:** `Access-Control-Allow-Origin: *` (`route.ts:33-37`) with no per-key origin/domain allowlist.
**Impact:** The whole point of Mode B is "submit from the client's website." If the dev puts the Bearer key in **front-end JavaScript**, it's visible in page source / network tab, and with `*` CORS nothing limits where it's called from → anyone can inject leads (capped only by per-key rate limit). **This is the highest practical risk for the Prime Ceramics integration.**
**Mitigation now:** the key MUST be used **server-side** (client backend proxies the POST), never in browser JS.
**Fix:** per-key origin allowlist; document server-side-only usage; consider CAPTCHA/bot protection for any genuinely public form.

### F5 — Integration mode is implicit/undocumented 🟠
**What:** Nothing on a form declares "hosted" vs "API" mode. So you get an empty hosted form (`download-catalogue`) that's actually an API endpoint — confusing, and it made the system look broken during testing.
**Fix:** Make mode explicit per form; in the builder, show the right integration instructions (embed snippet for hosted; API contract + key for API mode).

### F6 — Feature built/reviewed against a wrong assumption, never run 🔴 (our process)
**What:** The form→pipeline routing feature modified **only** `/api/public/submit` because the plan assumed that was "the form submit route." The **hosted** form actually uses `/api/v1/leads`, which was never touched. The feature passed build + lint + code-review, but **no actual submission was ever made** to confirm routing worked.
**Why it happened:** exploration didn't verify what the hosted form POSTs to (F1 made "the submit route" ambiguous); review verified *conformance to the plan*, not *real outcome*; our own rule "verify on local dev before declaring done" was skipped.
**Fix (process):** see Section 6.

### F7 — Schema-ahead-of-code drift 🟡
**What:** Migration `036` (`form_configs.target_pipeline_id`) was applied to the **shared/prod DB** to unblock local testing, before the consuming code was deployed. Harmless here (additive, nullable column; prod code ignores it) but it's the "DB changed outside a deploy" pattern.
**Fix:** track out-of-band DB changes explicitly; prefer migrations landing with their code via the normal pipeline.

### F8 — Board "leads in both pipelines" (verify) 🟡
**What:** During testing, the same leads appeared under both Default and Catalogue. **Source code filters correctly** on local and prod: `pipeline/page.tsx` passes `pipelineId`; `getLeadsForPipeline` applies `.eq("pipeline_id", …)`; `PipelineBoard.tsx:82-86` buckets by `stage_id`. With every lead in Default, Catalogue should render empty. The symptom is therefore a **stale running view** (deployed container image older than source, and/or browser router cache), not a code bug.
**Fix/verify:** hard-refresh; confirm the prod container image matches `f961970` source (deploy hygiene). Treat as a deploy-verification item.

---

## 5. Recommendations (prioritized)

**P0 — correctness & security**
1. **Single shared lead-creation seam.** One `resolveLeadPipelineAndStage()` + ideally one `createLead()` service called by all 3 paths. Fixes F1, completes the routing feature (F6), and fixes the CRM-endpoint null `pipeline_id`.
2. **Server-side schema validation** for submissions (shared validator for both modes) — F2.
3. **Lock down API keys for client-website use** — server-side-only guidance now; per-key origin allowlist + form binding + permission enforcement next — F3, F4.

**P1 — clarity & data quality**
4. **Declare form integration mode explicitly**; surface the correct integration instructions per mode — F5.
5. **Hand the Prime Ceramics dev the proper API contract** (we already have `docs/reference/api-contracts/GENXCRM_API_CONTRACT.md` + `openapi.json` + Postman collection) and confirm they call it server-side.

**P2 — hygiene**
6. Track out-of-band DB changes; align migrations with deploys — F7.
7. Verify deployed container == source on prod; resolve F8.

---

## 6. Discipline / process — the actual conversation

These are the agreements to propose, owned by all of us (this session included):

1. **Verify the real behavior, not just the build.** "Build + lint + code-review pass" is necessary, not sufficient. A feature isn't done until it's **exercised end-to-end** on local dev against a throwaway DB. F6 would have been caught in 5 minutes by one real submission.
2. **Ground plans in evidence, not assumption.** Before changing "the X route," confirm what actually calls it. F1's duplication makes this essential — naming alone is misleading.
3. **One concept, one implementation.** Lead creation and pipeline resolution living in 3 endpoints is the root cause. New work should consolidate seams, not add a 4th copy. "Don't build on top of a mess — fix the seam you're touching."
4. **Reviews check outcomes, not just conformance.** A review that confirms code matches the plan can still ship a wrong plan. Reviewers should ask "did we prove it works?"
5. **No silent un-validated public surfaces.** A public/API endpoint that accepts arbitrary data and is reachable with a potentially-public key needs validation, scoping, and origin controls by default.

**Framing for Anish & Hardik:** the goal is structural — one lead-intake seam, validated and scoped — not assigning fault. Several of these (F6, F7) are our planning/review misses. The shared structural items (F1–F5) are what we want to align on building correctly going forward.

---

## Appendix — evidence (reproducible)

- **Lead source split (Prime Ceramics):** `leads` for tenant `6e553dc9-…`: `download-catalogue` 6 leads / 6 via API / 0 hosted; `request-a-quote` 3 / 3 / 0. `intake_source='api'`, `session_id` null → all Mode B.
- **Form configs:** `download-catalogue` steps=1/fields=0, `target_pipeline_id`=Catalogue; `request-a-quote` 6 fields, no target.
- **Prod state:** `f961970` ("promote form-builder to _shared"), routing feature `grep target_pipeline_id src/` → NOT PRESENT; `/api/v1/leads` uses `body.pipeline_id || defaultPipeline.id`.
- **Key code refs:** auth `src/lib/api/integration-auth.ts`; submit route `src/app/api/public/submit/[tenantSlug]/[formSlug]/route.ts` (CORS :33-37, auth :67, tenant check :103, resolver :143-211, custom_fields :368, payload :354-383); hosted form `src/components/form/public-form.tsx:265,372`; `/api/v1/leads` `:238-280`; CRM endpoint `…/integrations/crm/leads/route.ts:226-259`; key schema `005_integration_keys.sql`, `007_integration_permissions.sql`.
