# APPLICATION CONSENT GATE — Build Brief · for Sonnet, STOP-AT-REVIEW

**Branch:** continue on the **existing `feature/classes` branch** (Sadin chose to stack consent on it; do NOT create a new branch). Do **NOT** push / PR / merge — stop at review.
**Scope:** `education_consultancy` only. Other industries byte-for-byte unaffected.
**DB target:** **STAGE only** (`dymeudcddasqpomfpjvt`), migration in a txn with before/after counts. Never touch prod.
**Pattern sources (reuse, don't reinvent):** invite-token flow, the public form/widget shell, the Resend email helper, the `/api/v1/upload` → `lead-documents` storage flow, and the Agents/Applications settings + gate patterns. Exact file/line anchors are inline below.

---

## 🛑 HARD GUARDRAILS
1. **STOP AT REVIEW.** Commit to `feature/classes`, then stop & report. No push/PR/merge.
2. **Migration to STAGE only**, additive (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`), txn + before/after counts. No prod, no destructive SQL.
3. Commit in the **Part order** below as separate commits.
4. Paste `npm run build` (clean) + `npx eslint --max-warnings 50` (0 errors, ≤50 warnings) before reporting.
5. **SAFETY — the gate must be OFF by default.** Application creation must behave EXACTLY as today unless the tenant has an **active** consent template (`consent_templates.is_active = true`). Do not lock existing tenants out of creating applications.
6. Education-gated; non-education tenants must see/behave with zero change.

---

## What we're building (one sentence)
In education_consultancy, once a tenant turns it on, a **student must sign a consent document** (digital e-sign link **or** an exec-recorded manual upload) before **any** application can be created for that lead — enforced in the UI and both application-create APIs.

**Locked decisions:** consent is **per-student/one-time** (unlocks all future applications); **both** e-sign + manual-upload methods; consent content is a **dedicated Settings ▸ Consent template** (versioned, NOT the form-builder); v1 = send/sign/manual/link-expiry+resend (**revocation deferred**). Signature = **typed name + "I agree" checkbox + IP/timestamp** always, with a **drawn-signature pad** behind an admin toggle. Link delivery = **copy-link (WhatsApp) + email**. Consent card shows at **Prospects+** (where applications live).

---

## PART 1 — Migration `066_application_consent.sql`

Mirror `057_application_tracking.sql` for RLS/trigger style. Wrap in `BEGIN; … COMMIT;`.

### 1a. `consent_templates` (one per tenant, drives whether the gate is on)
```
id          UUID PK DEFAULT gen_random_uuid()
tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
title       TEXT NOT NULL DEFAULT 'Student Consent & Authorization'
body        TEXT NOT NULL DEFAULT ''        -- the consent document text
version     INT NOT NULL DEFAULT 1          -- bump on each save
require_drawn_signature BOOLEAN NOT NULL DEFAULT false
link_expiry_days INT NOT NULL DEFAULT 14
is_active   BOOLEAN NOT NULL DEFAULT false  -- false ⇒ gate OFF (apps behave as today)
created_at, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
UNIQUE (tenant_id)                          -- single consent doc per tenant
```
- RLS: SELECT = `tenant_id IN (SELECT get_user_tenant_ids())`; INSERT/UPDATE/DELETE = `is_tenant_admin(tenant_id)`. `update_updated_at` trigger.
- **Do NOT seed any rows** — absence = gate off.

### 1b. `lead_consents` (per-student consent record + token)
```
id           UUID PK DEFAULT gen_random_uuid()
tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
lead_id      UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE
status       TEXT NOT NULL DEFAULT 'sent'    -- 'sent' | 'signed' | 'expired'
method       TEXT                            -- 'esign' | 'manual_upload' (set when signed)
token        TEXT                            -- random, for the public link (null for manual)
body_snapshot TEXT                           -- exact doc text the student agreed to (frozen)
template_version INT                         -- version at send time
signer_name  TEXT
signature_type TEXT                          -- 'typed' | 'drawn' (esign)
signature_value TEXT                         -- typed full name
signature_image_url TEXT                     -- drawn signature PNG (lead-documents bucket)
document_url TEXT                            -- uploaded signed scan (manual path)
ip_address   TEXT
sent_at      TIMESTAMPTZ
sent_via     TEXT                            -- 'link' | 'email'
link_expires_at TIMESTAMPTZ
signed_at    TIMESTAMPTZ
created_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL
created_at, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
deleted_at   TIMESTAMPTZ
```
- Indexes (partial `WHERE deleted_at IS NULL`): `(tenant_id, lead_id)`, and a **unique index on `(token)` WHERE token IS NOT NULL** (token lookup must be unique).
- RLS: SELECT = tenant membership; INSERT/UPDATE/DELETE = `is_tenant_admin(tenant_id)` (server routes use the service/scoped client + code-level `canManageApplications`, matching the applications routes — RLS is the backstop). `update_updated_at` trigger.

**No new FEATURES constant, no new permission.** Consent is gated under `FEATURES.APPLICATION_TRACKING`; consent mutations use the existing `canManageApplications(auth.permissions)`; template editing is admin via the Settings page gate.

Paste before/after: `SELECT count(*) FROM consent_templates;` `SELECT count(*) FROM lead_consents;` (both expected 0).

---

## PART 2 — Authenticated APIs (exec + admin)

All gate with `authenticateRequest()` → `getFeatureAccess(auth.industryId, FEATURES.APPLICATION_TRACKING)` else `apiForbidden()`. Use `scopedClient(auth)` (or service client + explicit `.eq("tenant_id", auth.tenantId)`, matching the applications routes).

### 2a. Consent template — `src/app/(main)/api/v1/consent-template/route.ts`
- **GET**: read gate. Return the tenant's `consent_templates` row (or `null`).
- **PUT**: gate + **owner/admin role** (mirror the agents POST role check). Upsert by `tenant_id` (insert if none, else update); on update **increment `version`**. Accept `title`, `body`, `require_drawn_signature`, `link_expiry_days`, `is_active`. Audit `consent_template.updated`.

### 2b. Per-lead consent — `src/app/(main)/api/v1/leads/[id]/consent/route.ts`
- **GET**: read gate. Return `{ consent_enabled: <tenant has active template>, status: 'none'|'sent'|'signed'|'expired', record: <latest non-deleted lead_consents row or null incl. signer_name/method/signed_at/document_url>, link: <`${APP_URL}/consent/${token}` if status='sent' and not expired, else null> }`. Compute `status='expired'` on the fly if `link_expires_at < now()` and not signed.
- **POST**: gate + `canManageApplications`. Verify lead in tenant + branch/scope (reuse `requireLeadBranchAccess`/`getLeadMembership` like the applications POST). Body `action`:
  - `"send"`: require an **active** consent template (else 400 "Configure consent in Settings first"). Create a `lead_consents` row: `status='sent'`, `token = crypto.randomUUID()` (mirror `invites/route.ts:142`), `body_snapshot` = active template `body`, `template_version` = its `version`, `link_expires_at = now() + link_expiry_days`, `sent_at=now()`, `created_by`. If the lead has an email, **fire-and-forget** `sendConsentEmail(...)` (Part 4) and set `sent_via='email'`, else `'link'`. Supersede any prior unsigned row for that lead (soft-delete it) so there's one active token. Return the row + the link (for Copy). Emit `consent.sent`.
  - `"record_manual"`: require `signer_name`, `document_url` (already uploaded via `/api/v1/upload`), optional `signed_at` (default now). Create a row `status='signed'`, `method='manual_upload'`, `signer_name`, `document_url`, `signed_at`, `body_snapshot` = active template body (if any). Emit `consent.signed`.

(Drawn-signature PNG and the manual scan both upload through the existing **`POST /api/v1/upload` → `lead-documents`** flow — see `public-form.tsx:295-337` for the two-step `createSignedUploadUrl`→`uploadToSignedUrl`→`public_url` pattern; the uploader needs only `tenant_id`, no session.)

---

## PART 3 — Public signing (no login)

### 3a. Middleware bypass
In `src/middleware.ts` add a `/consent` prefix bypass mirroring the existing `/form` bypass (lines 5-8) so the signing page skips `updateSession`.

### 3b. Public APIs — `src/app/api/public/consent/[token]/route.ts` (service client, token-scoped; mirror `invites/validate`)
- **GET**: look up `lead_consents` by `token` via `createServiceClient()`. Return `{ valid:false, reason }` for not-found / already-signed / expired (`link_expires_at < now`). On valid: `{ valid:true, tenant:{ name, logo_url }, title, body_snapshot, require_drawn_signature, tenant_id }` (resolve tenant for branding + the `tenant_id` the page needs for uploads).
- **POST**: body `{ signer_name, signature_type:'typed'|'drawn', signature_value, signature_image_url?, agreed:true }`. Re-validate token (not signed/expired). Require `agreed===true` and `signer_name`. If template `require_drawn_signature` then `signature_image_url` required. Set `status='signed'`, `method='esign'`, `signed_at=now()`, `ip_address` from `x-forwarded-for`/`x-real-ip` header, persist signature fields. Emit `consent.signed`. Return success.

### 3c. Signing page — `src/app/(widget)/consent/[token]/page.tsx`
- `export const dynamic = "force-dynamic"`. Reuse the `(widget)/layout.tsx` shell (like `(widget)/form/[slug]/[formSlug]/page.tsx`). Fetch the public GET; render a client `ConsentSignForm`:
  - Tenant logo + title, scrollable `body_snapshot`, **Full name** input, **Signature** (typed name field always; if `require_drawn_signature`, a lightweight `<canvas>` signature pad — no new dependency: pointer events → `canvas.toBlob()` → upload via `/api/v1/upload` with the returned `tenant_id` → `public_url` → `signature_image_url`), **"I have read and agree"** checkbox, Submit → calls the public POST → confirmation screen.
  - Handle the invalid/expired/already-signed states with a clean message (mirror invite-validate UX).

---

## PART 4 — Email
Add `src/lib/email/send-consent.ts` mirroring `src/lib/email/send-invite.ts` (+ a template under `src/lib/email/templates/`). Link = `` `${APP_URL}/consent/${token}` ``. Gracefully returns `{success:false}` if `RESEND_API_KEY` unset (dev often has none — that's fine, the Copy-link path is the reliable channel). Call fire-and-forget from Part 2b `send` (never block the response on email — mirror `invites/route.ts:196-214`).

---

## PART 5 — The gate (enforce consent before application creation)

In **both** application POST handlers, after the lead scope check (`applications/route.ts` POST ~after line 134 `requireLeadBranchAccess`; `leads/[id]/applications/route.ts` POST ~after line 109), insert:
```
// Consent gate — only enforced if the tenant has an ACTIVE consent template
const { data: tpl } = await supabase.from("consent_templates")
  .select("is_active").eq("tenant_id", auth.tenantId).maybeSingle();
if (tpl?.is_active) {
  const { data: signed } = await supabase.from("lead_consents")
    .select("id").eq("tenant_id", auth.tenantId).eq("lead_id", <leadId>)
    .eq("status", "signed").is("deleted_at", null).limit(1).maybeSingle();
  if (!signed) return apiError("CONSENT_REQUIRED", "Student consent must be signed before creating an application", 409);
}
```
`<leadId>` = `leadRow.id` (nav route) / `id` (lead route). Add `apiError` is already imported in both; no new import needed.

---

## PART 6 — UI

### 6a. Lead detail server page — `src/app/(main)/(dashboard)/leads/[id]/page.tsx`
Alongside the existing `classesActive`/`applicationsActive` computation, query the tenant's active consent template + the lead's signed `lead_consents`, and pass two props to `LeadDetailV2`:
- `consentEnabled` = tenant has `consent_templates.is_active = true`.
- `consentSigned` = lead has a `lead_consents` row `status='signed'`, `deleted_at IS NULL`.

### 6b. `src/components/dashboard/lead/lead-detail-v2.tsx`
In the education right-rail, when `applicationsActive`:
- Render a new `<ConsentCard leadId consentSigned canManage={canManageApplications ?? isAdmin} consentEnabled />` **above** `<ApplicationsCard/>`.
- Pass `disabled={consentEnabled && !consentSigned}` to `<ApplicationsCard/>` (the card's "+" / Add-Application button is disabled with a tooltip "Sign consent first" when consent is enabled and unsigned). If `consentEnabled` is false, nothing changes (no ConsentCard, ApplicationsCard normal).

### 6c. `ConsentCard` — `src/industries/education-consultancy/features/application-tracking/components/consent-card.tsx`
Fetches `GET /api/v1/leads/{id}/consent`. Renders the three states from the approved diagram:
- **none**: "⚠ Consent required" + `[Send consent link]` + `[Record manually]` (canManage only).
- **sent**: "⏳ Consent sent · awaiting signature" + `[Copy link]` `[Resend]` `[Record manually]`.
- **signed**: "✅ Consent signed · {signer_name} · {date}" + `[View]` (opens `document_url` or a read-only modal of `body_snapshot`+signature).
Actions open `SendConsentDialog`.

### 6d. `SendConsentDialog` — same folder
- **Send link tab**: triggers `POST .../consent {action:'send'}`, shows the returned link with a **Copy** button + a **Send email** affordance (email auto-attempted if lead has an email; show "emailed to {email}" or "no email on file — copy the link").
- **Record manually tab**: file upload (→ `/api/v1/upload` → `lead-documents`, reuse the two-step pattern) + **Signer name** + **Date**, then `POST .../consent {action:'record_manual', signer_name, document_url, signed_at}`.

### 6e. Nav workspace — `AddApplicationSheet` (`features/application-tracking/components/add-application-sheet.tsx`)
After a student is selected, fetch `GET /api/v1/leads/{id}/consent`. If `consent_enabled && status!=='signed'`, disable the submit and show an inline notice "This student must sign consent first" with a `[Manage consent]` link to the lead. (Prevents a confusing 409 from the API gate.)

### 6f. Settings ▸ Consent — `src/components/dashboard/settings/consent-manager.tsx`
Mirror `agents-manager.tsx`. `GET/PUT /api/v1/consent-template`. Fields: **Title** (Input), **Body** (textarea), **Require drawn signature** (toggle), **Link expiry days** (number), and **"Require consent before applications"** = `is_active` (toggle — this is the master on/off for the gate). Mount in `settings/page.tsx` guarded exactly like `AgentsManager` (lines 118-120): `getFeatureAccess(tenant.industry_id, FEATURES.APPLICATION_TRACKING) && <ConsentManager />`. Use `sonner` toasts.

---

## Reuse anchors (copy these)
- Token row + `crypto.randomUUID()` + expiry + email: `invites/route.ts:142-214`; public validate: `invites/validate/route.ts`.
- Public/widget shell + force-dynamic: `(widget)/layout.tsx`, `(widget)/form/[slug]/[formSlug]/page.tsx`; middleware bypass: `middleware.ts:5-8`.
- Email: `src/lib/email/send-invite.ts` + `src/lib/email/index.ts` (`EMAIL_FROM`, `APP_URL`, `getResendClient`).
- Storage upload (scan + signature PNG): `POST /api/v1/upload` (`lead-documents` bucket) consumed in `public-form.tsx:295-337`.
- Application POST gate points: `applications/route.ts` POST (after ~L134), `leads/[id]/applications/route.ts` POST (after ~L109); error helper `apiError(code,msg,status)`.
- Settings mount + feature gate: `settings/page.tsx:118-120` (AgentsManager); manager shape: `agents-manager.tsx`.
- Right-rail gate props precedent: the `classesActive`/`applicationsActive` work in `leads/[id]/page.tsx` + `lead-detail-v2.tsx`.

---

## Self-check before reporting (paste results)
- [ ] `npm run build` clean · `npx eslint --max-warnings 50` clean.
- [ ] Migration 066 applied to **stage only**, txn, before/after counts (both tables 0 rows). No prod, no destructive SQL.
- [ ] **Gate OFF by default**: with no active consent template, creating an application works exactly as before (verify a normal prospect can still add an application). Turn `is_active` on in Settings → application creation now blocked (409 / disabled "+") until signed.
- [ ] E-sign happy path: Send → Copy link → open `/consent/{token}` logged-out → read doc, type name, (drawn if required), agree, submit → lead shows ✅ signed → Add Application unlocks.
- [ ] Manual path: Record manually (upload scan + name) → ✅ signed → unlocks.
- [ ] Expired/already-signed/invalid token pages show a clean message. Link expiry honored; Resend works.
- [ ] Public signing route is truly no-login (middleware bypass) and education-gated tenants only. Non-education + non-application tenants: zero change anywhere.
- [ ] Report: files touched, decisions, gate outputs + migration counts. Then STOP.

## Hand back to Opus
Commit to `feature/classes` (commit-msg hook rewrites co-author), stop. Opus re-runs gates, reviews the diff, verifies the stage DB + the no-login signing route + the gate-off-by-default behavior independently, then (with the whole classes+consent stack green and Sadin's local verify) pushes + PRs to stage.
