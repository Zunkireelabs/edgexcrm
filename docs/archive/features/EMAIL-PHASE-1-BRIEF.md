# Email feature — Phase 1 (foundation: schema + OAuth evolution + Connected Inboxes settings UI)

> Phase 1 of the education_consultancy Email feature. Foundation only — no send, no UI on lead detail, no inbound sync. Closes when an Admizz admin can OAuth-connect 2 Gmail inboxes from `/settings`, see them listed, and disconnect. Industry-scoped: not visible to other tenants.

The full 4-phase plan is at `/Users/sadinshrestha/.claude/plans/today-what-feature-i-wobbly-russell.md` (approved 2026-05-31). Phase 2 (send + log) and Phase 3 (sync + threading + reply) build on Phase 1's primitives.

---

## Goal

Real email in CRM (per HubSpot/Zoho reference patterns) needs four primitives before any user-facing surface can work: (1) a `user_id`-scoped multi-inbox connection model, (2) the message + thread storage schema, (3) `googleapis` client wired with token refresh, (4) the OAuth flow producing rows that point at the connecting user (not just the tenant). Phase 1 builds all four and surfaces the connection management in `/settings`.

The existing infra (mig 018's `connected_email_accounts` + `/api/v1/settings/email-accounts/gmail/auth` + `callback` + `sendGmailOAuth2Email`) is **tenant-scoped** today — built for the email-forward feature where the tenant admin connects one company-wide account. Sadin's email-from-CRM ask is **user-scoped, multi-account-per-user**: a counselor connects their own work + personal inboxes and picks which to send from at compose time.

Phase 1 evolves the schema and OAuth path to support both shapes. The legacy email-forward feature (which reads `connected_email_accounts` via `email_account_id` FK) continues to work — the migration backfills `user_id` from each tenant's owner so existing rows stay valid.

---

## CRM-expert design framing (carried over from approved plan)

1. **From-address model is per-user OAuth Gmail-only.** The counselor IS the relationship; the student emails a person, not a robot. Multi-inbox-per-user (e.g. `daniel@admizz.com` + `daniel@gmail.com`) — counselor picks at compose time. Existing `connected_email_accounts.email` column is already there; we just add user ownership.

2. **Store BOTH Gmail thread_id AND RFC headers (Message-ID / In-Reply-To / References) on every message.** v1 queries by Gmail thread_id for speed; the RFC headers are insurance for a future Outlook swap with no data migration. Cost is two extra TEXT columns. No-regret call.

3. **Schema is industry-agnostic; only the manifest registration is education-only.** No `parent_email` columns or education-specific fields in the email tables. Per CLAUDE.md "promote, don't copy" — `git mv` to `_shared/` when IT-agency opts in later. The 3 new tables (`email_threads`, `emails`, `email_sync_state`) sit alongside the existing `connected_email_accounts` (which itself is universal infra; only the wiring of inboxes-as-feature is industry-scoped).

---

## Scope

### In scope (Phase 1)

1. **Migration 025** — adds `user_id` + `display_name` to `connected_email_accounts`; updates RLS policies to be user-scoped (each user manages own); creates `email_threads`, `emails`, `email_sync_state`.
2. **`googleapis` package** added to dependencies.
3. **New feature constant `FEATURES.EMAIL`** in `src/industries/_registry.ts`.
4. **New industry-scoped feature folder skeleton** at `src/industries/education-consultancy/features/email/` with `meta.ts` and `lib/gmail-client.ts`. No components or hooks yet (Phase 2 starts adding those).
5. **Register feature in `src/industries/education-consultancy/manifest.ts`** — push `{ meta: emailMeta }` onto `features[]`. NO sidebar entry (Phase 1 has no top-level page; the only surface is a section in `/settings`).
6. **`gmail-client.ts` lib** — wraps `googleapis`. Phase 1 exports just `createOAuth2Client(refreshToken)` + `refreshAccessTokenIfNeeded(account)` + `getProfileEmail(client)` (used to fetch the connecting user's email after OAuth). Phase 2 adds `sendMessage()`; Phase 3 adds `listHistory()` + `getMessage()`.
7. **Evolve legacy OAuth callback** at `src/app/(main)/api/v1/settings/email-accounts/gmail/callback/route.ts` — capture `user_id = auth.uid()` from the authenticated session and write it into the inserted/updated row. Existing email-forward feature continues to work (it reads via `email_account_id` FK; doesn't care about `user_id`).
8. **New API endpoints** under `src/app/(main)/api/v1/email/inboxes/` — industry-gated with `getFeatureAccess(auth.industryId, FEATURES.EMAIL) → apiForbidden()`:
   - `GET /api/v1/email/inboxes` — list current user's connected inboxes (`user_id = auth.uid()` filter via `scopedClient`).
   - `POST /api/v1/email/inboxes/connect` — returns Google OAuth auth URL with state param identifying the email-feature flow (vs legacy email-forward flow).
   - `GET /api/v1/email/inboxes/callback` — receives Google's code, exchanges for tokens, fetches the connecting user's Gmail address via `getProfileEmail`, upserts a row with `user_id = auth.uid()`. Redirects to `/settings#connected-inboxes` on success.
   - `DELETE /api/v1/email/inboxes/[id]` — deletes the row (RLS-enforced: user can only delete own).
9. **Settings page UI** — new `<ConnectedInboxesSection>` rendered conditionally on the existing `/settings` page when the tenant has `FEATURES.EMAIL` registered. Lists current user's inboxes (email + provider + connected date) with a Disconnect button per row, and a "Connect a Gmail inbox" CTA button that opens the OAuth flow.

### Out of scope (later phases)

- **Phase 2**: compose modal, send endpoint, sent-email persistence, Email tab on lead detail, `email.sent` events.
- **Phase 3**: polling worker, inbound message handling, reply matching, thread display, reply-from-CRM, `email.received` events.
- **Phase 4**: Email tab on contact detail, Account 360 activity feed integration, subject search, unread badges, parent CC merge field.

Specifically NOT in Phase 1:
- No top-level sidebar entry. (Compose is invoked from lead/contact detail in later phases; no inbox-list-page is planned.)
- No new `googleapis` calls beyond OAuth roundtrip + `gmail.users.getProfile()` (the latter to fetch the connecting user's email address). No send, no list, no get-message.
- No changes to `sendGmailOAuth2Email` in `src/lib/email/smtp-sender.ts` — left as-is. Phase 2 adds a new send function inside `gmail-client.ts` using `googleapis.gmail.users.messages.send`, which returns Gmail's internal `messageId` + `threadId` directly (nodemailer-via-SMTP can't return those).
- No backfill of historical inbox emails. v1 only sees emails sent/received AFTER the inbox connect timestamp.

---

## Schema — migration 025

File: `supabase/migrations/025_email_send_foundation.sql`.

### Alter `connected_email_accounts`

```sql
ALTER TABLE connected_email_accounts
  ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN display_name TEXT;

-- Backfill: assign existing rows to each tenant's owner.
-- (Existing rows were created by the email-forward feature, where the
-- tenant admin connected the company-wide account. Owner is the right default.)
UPDATE connected_email_accounts cea
SET user_id = (
  SELECT tu.user_id
  FROM tenant_users tu
  WHERE tu.tenant_id = cea.tenant_id
    AND tu.role = 'owner'
  ORDER BY tu.created_at ASC
  LIMIT 1
)
WHERE cea.user_id IS NULL;

-- Any rows still NULL (no owner exists — should not happen, but defensive):
DELETE FROM connected_email_accounts WHERE user_id IS NULL;

ALTER TABLE connected_email_accounts
  ALTER COLUMN user_id SET NOT NULL;

-- Uniqueness: one (user, email) per user. Drop any preexisting unique on
-- (tenant_id, email) if present. (Mig 018 didn't create one, but check.)
CREATE UNIQUE INDEX idx_connected_email_accounts_user_email
  ON connected_email_accounts (user_id, email);

CREATE INDEX idx_connected_email_accounts_user
  ON connected_email_accounts (user_id);
```

### Update RLS policies on `connected_email_accounts`

```sql
-- Drop the tenant-admin policies (they assume tenant-shared accounts).
DROP POLICY IF EXISTS "Tenant members can view connected accounts" ON connected_email_accounts;
DROP POLICY IF EXISTS "Tenant admins can insert connected accounts" ON connected_email_accounts;
DROP POLICY IF EXISTS "Tenant admins can update connected accounts" ON connected_email_accounts;
DROP POLICY IF EXISTS "Tenant admins can delete connected accounts" ON connected_email_accounts;

-- New user-scoped policies: each user manages own inboxes.
CREATE POLICY "Users can view own connected accounts"
  ON connected_email_accounts FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own connected accounts"
  ON connected_email_accounts FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own connected accounts"
  ON connected_email_accounts FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete own connected accounts"
  ON connected_email_accounts FOR DELETE
  USING (user_id = auth.uid());

-- Tenant admins can view all inboxes in their tenant (read-only oversight).
CREATE POLICY "Tenant admins can view all tenant connected accounts"
  ON connected_email_accounts FOR SELECT
  USING (is_tenant_admin(tenant_id));

-- Service role policy is preserved from mig 018; do not re-create.
```

### New `email_threads`

```sql
CREATE TABLE email_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connected_email_account_id UUID NOT NULL REFERENCES connected_email_accounts(id) ON DELETE CASCADE,
  gmail_thread_id TEXT NOT NULL,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  subject TEXT,
  last_message_at TIMESTAMPTZ,
  message_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_email_threads_account_gmail_thread
  ON email_threads (connected_email_account_id, gmail_thread_id);
CREATE INDEX idx_email_threads_tenant ON email_threads (tenant_id);
CREATE INDEX idx_email_threads_lead ON email_threads (lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX idx_email_threads_contact ON email_threads (contact_id) WHERE contact_id IS NOT NULL;

CREATE TRIGGER set_email_threads_updated_at
  BEFORE UPDATE ON email_threads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE email_threads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view email threads"
  ON email_threads FOR SELECT
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY "Tenant admins can mutate email threads"
  ON email_threads FOR ALL
  USING (is_tenant_admin(tenant_id))
  WITH CHECK (is_tenant_admin(tenant_id));

CREATE POLICY "Service role full access to email threads"
  ON email_threads FOR ALL
  USING (auth.role() = 'service_role');
```

### New `emails`

```sql
CREATE TABLE emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  thread_id UUID NOT NULL REFERENCES email_threads(id) ON DELETE CASCADE,
  connected_email_account_id UUID NOT NULL REFERENCES connected_email_accounts(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('outbound', 'inbound')),
  from_email TEXT NOT NULL,
  from_name TEXT,
  to_emails TEXT[] NOT NULL DEFAULT '{}',
  cc_emails TEXT[] NOT NULL DEFAULT '{}',
  bcc_emails TEXT[] NOT NULL DEFAULT '{}',
  subject TEXT,
  body_html TEXT,
  body_text TEXT,
  gmail_message_id TEXT NOT NULL,
  rfc_message_id TEXT NOT NULL,
  in_reply_to TEXT,
  rfc_references TEXT[] NOT NULL DEFAULT '{}',
  sent_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  sender_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_emails_thread ON emails (thread_id, COALESCE(sent_at, received_at));
CREATE UNIQUE INDEX idx_emails_gmail_message ON emails (connected_email_account_id, gmail_message_id);
CREATE INDEX idx_emails_rfc_message_id ON emails (rfc_message_id);
CREATE INDEX idx_emails_tenant ON emails (tenant_id);

ALTER TABLE emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view emails"
  ON emails FOR SELECT
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY "Tenant admins can mutate emails"
  ON emails FOR ALL
  USING (is_tenant_admin(tenant_id))
  WITH CHECK (is_tenant_admin(tenant_id));

CREATE POLICY "Service role full access to emails"
  ON emails FOR ALL
  USING (auth.role() = 'service_role');
```

> **Note on the `references` column name**: Postgres reserves `references` (SQL keyword used by FKs). Column is named `rfc_references` to avoid quoting hell at query time. Same column carries the RFC 5322 `References:` header chain.

### New `email_sync_state`

```sql
CREATE TABLE email_sync_state (
  connected_email_account_id UUID PRIMARY KEY REFERENCES connected_email_accounts(id) ON DELETE CASCADE,
  last_history_id TEXT,
  last_synced_at TIMESTAMPTZ,
  last_error TEXT,
  consecutive_error_count INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_email_sync_state_updated_at
  BEFORE UPDATE ON email_sync_state
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE email_sync_state ENABLE ROW LEVEL SECURITY;

-- Owner can read own sync state (debug surface); only service role mutates.
CREATE POLICY "Users can view own sync state"
  ON email_sync_state FOR SELECT
  USING (connected_email_account_id IN (
    SELECT id FROM connected_email_accounts WHERE user_id = auth.uid()
  ));

CREATE POLICY "Service role full access to sync state"
  ON email_sync_state FOR ALL
  USING (auth.role() = 'service_role');
```

---

## File-by-file changes

### Add

1. `supabase/migrations/025_email_send_foundation.sql` — full SQL above.
2. `src/industries/education-consultancy/features/email/meta.ts`:
   ```ts
   import { FEATURES, INDUSTRIES } from "../../../_registry";
   import type { FeatureMeta } from "../../../_types";

   export const emailMeta: FeatureMeta = {
     id: FEATURES.EMAIL,
     industries: [INDUSTRIES.EDUCATION_CONSULTANCY],
   };
   ```
3. `src/industries/education-consultancy/features/email/lib/gmail-client.ts`:
   - `createOAuth2Client(refreshToken: string)` — returns a `googleapis` `OAuth2Client` configured with `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` env vars + the refresh token. The googleapis client handles access-token refresh internally on each request.
   - `getProfileEmail(client: OAuth2Client): Promise<string>` — calls `gmail.users.getProfile({ userId: "me" })` and returns `.emailAddress`. Used after OAuth callback to fetch the connecting user's Gmail address.
   - `refreshAccessTokenIfNeeded(account: ConnectedEmailAccount): Promise<{ access_token: string, expiry_date: number } | null>` — used by Phase 2/3 routes that need an access_token explicitly (Phase 1 doesn't call this; included so the foundation is complete).
   - Phase 1 exports ONLY these three. Phase 2 will add `sendMessage()`; Phase 3 adds `listHistory()` + `getMessage()`.
4. `src/app/(main)/api/v1/email/inboxes/route.ts`:
   - `GET` — list current user's connected inboxes via `scopedClient(auth).from("connected_email_accounts").select("id, email, display_name, provider, created_at").eq("user_id", auth.userId)`. RLS also enforces but the explicit filter is good practice.
5. `src/app/(main)/api/v1/email/inboxes/connect/route.ts`:
   - `POST` — build Google OAuth URL with `client_id`, `redirect_uri = <APP_URL>/api/v1/email/inboxes/callback`, `scope = https://mail.google.com/ https://www.googleapis.com/auth/userinfo.email`, `access_type = offline`, `prompt = consent` (forces refresh_token re-issue every connect — important for multi-inbox), `state` containing `user_id` (signed via `crypto.createHmac` with `NEXTAUTH_SECRET` or equivalent — see existing legacy callback for the precedent if it does signing; otherwise plain `user_id:<id>` is fine for v1 since callback validates against `auth.uid()`). Returns `{ url: <google_oauth_url> }`.
6. `src/app/(main)/api/v1/email/inboxes/callback/route.ts`:
   - `GET` — receives `code` + `state` query params. Validates state matches current session's user. Exchanges code for `{ access_token, refresh_token, expiry_date }` via Google's token endpoint (POST to `https://oauth2.googleapis.com/token`). Calls `getProfileEmail()` to fetch the connecting user's Gmail address. Upserts a row into `connected_email_accounts` keyed on `(user_id, email)` — if user already connected this email, update tokens; if not, insert. Writes `display_name = email` for now (user can edit later — Phase 2+). Redirects to `/settings?connected=<email>#connected-inboxes` on success; on error redirects to `/settings?error=<reason>#connected-inboxes`.
7. `src/app/(main)/api/v1/email/inboxes/[id]/route.ts`:
   - `DELETE` — deletes the row via `scopedClient(auth).from("connected_email_accounts").delete().eq("id", params.id).eq("user_id", auth.userId)`. (Both filters required — the `.eq("id", id)` is what makes it not delete every row in tenant per the wrapper's contract.)
8. `src/industries/education-consultancy/features/email/components/inbox-connector.tsx`:
   - Client component. Fetches `/api/v1/email/inboxes` on mount + after Connect/Disconnect mutations.
   - Renders a card titled "Connected Inboxes" with subtitle "Send emails from CRM using your own Gmail. Connect one or more accounts; pick the From address at compose time."
   - Lists each connected inbox: row with envelope icon + `email` + `provider` badge + "Connected on <date>" + `Disconnect` button (destructive variant).
   - Empty state: "No inboxes connected yet. Connect your first Gmail account to send emails from CRM."
   - Primary CTA: "Connect a Gmail inbox" button that POSTs `/api/v1/email/inboxes/connect`, takes the returned `url`, and `window.location.href = url` (OAuth roundtrip).
   - On callback redirect with `?connected=<email>`, show a `toast.success(`Connected ${email}`)` on mount.
   - Counselor users see the same card (it's user-scoped — every user manages own inboxes). Admin sees the same card; their visibility into other users' inboxes is a Phase 4+ admin surface (out of scope for Phase 1).

### Modify

9. `src/industries/_registry.ts`:
   - Add `EMAIL: "email"` to the `FEATURES` constant (place under the existing education_consultancy block alongside `CHECK_IN`, `FORM_BUILDER`, `CONTACTS`).
10. `src/industries/education-consultancy/manifest.ts`:
   - Import `emailMeta`.
   - Push `{ meta: emailMeta }` onto `features[]`.
   - **No sidebar entry.** (Confirmed in scope above.)
11. `src/app/(main)/api/v1/settings/email-accounts/gmail/callback/route.ts` (LEGACY — preserve behavior, add user_id capture):
   - In the upsert/insert into `connected_email_accounts`, add `user_id: auth.userId` to the row payload. Authenticate the request first with `authenticateRequest()` if it isn't already (read the file — it likely already authenticates).
   - This makes the legacy email-forward connect flow ALSO produce user_id-populated rows, keeping the schema invariant `user_id NOT NULL` satisfied. The legacy email-forward feature continues to work — it reads `connected_email_accounts` by `email_account_id` FK, doesn't filter by `user_id`.
12. **Settings page** wherever it lives (likely `src/app/(main)/(dashboard)/settings/page.tsx`):
   - Conditionally render `<ConnectedInboxesSection />` when `getFeatureAccess(tenantData.tenant.industry_id, FEATURES.EMAIL)` returns true.
   - Place it near the existing Email Forward Rules section if one exists; otherwise put it as its own card.
   - Read the existing settings page first to find the right insertion point — don't blindly add at the top.
13. `package.json` + `package-lock.json`:
   - `npm install googleapis` — installs the official Google APIs Node.js client. Verify Node 22 Alpine compatibility (should be fine; googleapis is pure JS).

---

## Patterns to reuse

- **Existing OAuth roundtrip mechanics**: read `src/app/(main)/api/v1/settings/email-accounts/gmail/auth/route.ts` + `callback/route.ts` end-to-end before building the new endpoints. The token-exchange POST to `https://oauth2.googleapis.com/token`, the scopes string, the `access_type=offline` + `prompt=consent` flags — all directly reusable. Don't rewrite from scratch.
- **`scopedClient(auth)` for tenant-owned table access**: see `src/lib/supabase/scoped.ts`. Both new API routes (`GET /inboxes`, `DELETE /inboxes/[id]`) use this. The callback uses `createServiceClient()` because it needs to upsert across the user's own row regardless of RLS (the row may not yet exist).
- **`getFeatureAccess` gate**: see `src/industries/_loader.ts` for signature. Mirror the form-builder API gate (`src/app/(main)/api/v1/form-configs/route.ts:23, 43`):
  ```ts
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.EMAIL)) return apiForbidden();
  ```
- **API response helpers**: `apiSuccess()`, `apiError()`, `apiUnauthorized()`, `apiForbidden()` — see existing routes for usage. Standard pattern in this codebase.
- **Industry-scoped feature shape**: `src/industries/education-consultancy/features/form-builder/` is the cleanest precedent — read its `meta.ts` and folder layout. Mirror exactly. (Form-builder also has manifests + a feature gate, so it's the right reference.)
- **Card chrome** for the settings UI: `border border-border bg-card rounded-lg shadow-none p-3 space-y-3` — matches the design tokens documented in SESSION-LOG resume block.
- **Button tokens**: primary CTA uses `bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg`; Disconnect uses `variant="destructive"`.
- **Toast on success/error**: `import { toast } from "sonner"` — used throughout the app already.

---

## Verification

Before pushing for review:

- [ ] `npm run build` clean locally.
- [ ] `npx eslint --max-warnings 50 .` clean locally (must stay at 17 baseline).
- [ ] **Migration applies cleanly**: `npx supabase db push` (or apply via MCP) on the dev DB. Confirm:
  - `connected_email_accounts.user_id` is NOT NULL.
  - Existing rows (if any) were backfilled to the tenant owner.
  - `UNIQUE(user_id, email)` enforced — attempting to insert a duplicate (same user, same email) raises 23505.
  - `email_threads`, `emails`, `email_sync_state` tables exist with the expected columns.
  - RLS policies on `connected_email_accounts` are user-scoped (admin-as-different-user cannot SELECT/DELETE another user's row).
- [ ] **OAuth roundtrip** as Admizz admin (`admin@admizz.com`):
  - Login → `/settings` → see "Connected Inboxes" card → click "Connect a Gmail inbox" → consent on Google → redirected back → toast "Connected <email>" → inbox row appears.
  - Connect a second different Gmail account — both rows appear in the list.
  - Click Disconnect on one — row disappears + toast confirms.
  - Re-connect the same Gmail account that was just disconnected — upserts cleanly (no duplicate row).
- [ ] **Industry gating** as Zunkireelabs admin (`admin@zunkireelabs.com`):
  - `/settings` does NOT show the Connected Inboxes card.
  - `GET /api/v1/email/inboxes` returns 403.
  - `POST /api/v1/email/inboxes/connect` returns 403.
  - `GET /api/v1/email/inboxes/callback?code=anything&state=anything` returns 403 (industry gate runs before code exchange).
  - `DELETE /api/v1/email/inboxes/<any-id>` returns 403.
- [ ] **User-scoped RLS** as a counselor user on Admizz:
  - Connect a Gmail inbox as counselor — succeeds, appears in counselor's list.
  - As admin, querying `GET /api/v1/email/inboxes` returns ONLY admin's own inboxes (not counselor's) — the API filter is `user_id = auth.userId`.
  - Admin querying `connected_email_accounts` directly via Supabase MCP CAN see all tenant inboxes (the tenant-admin SELECT policy allows it). This is intentional admin oversight.
- [ ] **Legacy email-forward feature still works**:
  - As Admizz admin, navigate to the existing Email Forward Rules / Email Accounts setup UI (wherever it lives) and confirm the legacy `/api/v1/settings/email-accounts/gmail/auth` flow still produces a row in `connected_email_accounts` — the row now has `user_id` populated (it's `auth.uid()` of the admin who completed the flow).
  - Email Forward Rules that reference the connected account via `email_account_id` continue to read it correctly.
- [ ] **All 7 code-review checklist items** considered (see `docs/STATUS-BOARD.md`):
  - **PostgREST embed FK disambiguation** — N/A for Phase 1 (no PostgREST embeds across tables with reverse FKs). Phase 3 will need to consider when joining emails → email_threads → leads.
  - **PATCH preserves POST invariants** — N/A for Phase 1 (no PATCH endpoints).
  - **New page components need a route shell** — N/A (no new top-level pages).
  - **`.select()` after insert/update** — RELEVANT for the callback. Confirm the returned row shape from the callback's upsert matches what `<ConnectedInboxesSection>` consumes via `GET /api/v1/email/inboxes`. (Easiest: the callback doesn't need to return the row to the client; it redirects. The list endpoint freshly queries on settings page load.)
  - **Radix Select empty-string sentinel** — N/A (no Select component used in Phase 1; the Connect button is a plain button).
  - **Cross-cutting predicate audits** — RELEVANT. The new RLS policy `WHERE user_id = auth.uid()` is the new soft-state filter. Grep `from("connected_email_accounts")` across `src/` and audit every hit — the LEGACY flow's read paths (in the email-forward feature UI) must continue to surface tenant-shared accounts to all tenant admins. The legacy email-forward UI reads via `is_tenant_admin` policy which we preserve in the new RLS — confirm at smoke time.
  - **Page-padding stacks with shell** — N/A (no new page wrappers).

---

## Decisions locked in (do not re-litigate during implementation)

- **User-scoped, not tenant-scoped, inbox connections.** Multi-inbox-per-user is the feature requirement.
- **Backfill existing rows to tenant owner** (not delete; not assign to first admin). Owner is the deterministic single-row choice; first admin is undefined when multiple admins exist.
- **No changes to `sendGmailOAuth2Email` in `src/lib/email/smtp-sender.ts`.** New `gmail-client.ts` lives in the feature folder. Phase 2 uses it; legacy lib stays untouched.
- **No sidebar entry for the email feature.** Compose is invoked from lead/contact detail. No standalone inbox-list page in v1.
- **`rfc_references` column name** (not `references`) — Postgres keyword collision.
- **`googleapis` client over nodemailer** for Phase 2's send path — so we get back Gmail's internal `messageId` + `threadId` directly (needed for threading). Phase 1 only installs the package + builds the OAuth client wrapper.
- **OAuth `prompt=consent`** is forced on every Connect — ensures Google always re-issues a refresh_token (otherwise multi-inbox connect fails silently for the second + third account).

---

## Workflow handoff

1. Sadin pastes the prompt below into a fresh Sonnet session.
2. Sonnet implements on a feature branch off `stage`, runs local gates, commits, pushes.
3. Sadin notifies Opus when the branch is up. Opus reviews against this brief + the 7-item checklist + the verification matrix above, drafts fixback prompts if needed, then squash-merges to `stage` once clean.
4. After stage deploy completes, Sadin runs the verification matrix above. Any defects → fixback prompt to Sonnet on the same branch (or, if branch is deleted, a follow-up branch).
5. Opus archives this brief to `docs/archive/features/EMAIL-PHASE-1-BRIEF.md` and writes the Phase 2 brief at `docs/EMAIL-PHASE-2-BRIEF.md`.

---

## Sonnet handoff prompt

Paste the block below to a fresh Sonnet session.

```
You're implementing Phase 1 of the education_consultancy Email feature on a feature branch. Read /Users/sadinshrestha/Projects/edgeXcrm/docs/EMAIL-PHASE-1-BRIEF.md end-to-end before touching any code — it's the full spec including the rationale ("Decisions locked in" section is non-negotiable), the schema, the file-by-file changes, the patterns to reuse, and the verification matrix.

This is FOUNDATION only. No send, no UI on lead detail, no inbound sync. Phase 1 closes when an Admizz admin can OAuth-connect 2 Gmail inboxes from /settings, see them listed, and disconnect.

Workflow:
1. From the repo root, fetch latest stage and branch off it:
   git fetch origin && git checkout -b feat/email-phase-1-foundation origin/stage
2. Implement the changes per the brief, in this order:
   a. Run `npm install googleapis` and commit the package.json + package-lock.json change.
   b. Write migration 025 (supabase/migrations/025_email_send_foundation.sql) per the SQL in the brief. Apply it to the dev DB via Supabase MCP. Confirm it applies cleanly (no errors); spot-check the resulting RLS policies match the brief.
   c. Add FEATURES.EMAIL to src/industries/_registry.ts.
   d. Create the feature folder skeleton at src/industries/education-consultancy/features/email/ with meta.ts and lib/gmail-client.ts (export only the 3 Phase-1 functions: createOAuth2Client, getProfileEmail, refreshAccessTokenIfNeeded).
   e. Register the feature in src/industries/education-consultancy/manifest.ts (push { meta: emailMeta } onto features[]; NO sidebar entry).
   f. Evolve src/app/(main)/api/v1/settings/email-accounts/gmail/callback/route.ts to write user_id = auth.userId on the inserted/updated row. This keeps the legacy email-forward flow producing user_id-populated rows so the schema's NOT NULL invariant holds.
   g. Build the 4 new API endpoints under src/app/(main)/api/v1/email/inboxes/ (GET /, POST /connect, GET /callback, DELETE /[id]). All industry-gated with getFeatureAccess(auth.industryId, FEATURES.EMAIL) → apiForbidden().
   h. Build the InboxConnector client component at src/industries/education-consultancy/features/email/components/inbox-connector.tsx. Wire it into the settings page conditionally on getFeatureAccess returning true.
3. Verify locally before pushing:
   - npm run build (clean)
   - npx eslint --max-warnings 50 . (clean — CI hard gate; local build does NOT run ESLint)
   - Apply migration 025 to dev DB if not already
   - Manual OAuth roundtrip as Admizz admin: Connect → consent → row appears in list → Disconnect → row disappears.
   - Manual 403 spot-check as Zunkireelabs admin: /settings doesn't show the Connected Inboxes card; GET /api/v1/email/inboxes returns 403.
4. Self-check against the verification checklist at the bottom of the brief.
5. Commit with clear message ending with:
   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   (The commit-msg hook will rewrite this to the local git user.)
6. Push the branch. DON'T merge — Opus reviews and squash-merges to stage.

Critical constraints from the brief:
- Schema: 3 new tables + alter connected_email_accounts. Backfill existing rows to each tenant's owner BEFORE setting user_id NOT NULL. DELETE any rows still NULL after backfill (defensive).
- The column is named rfc_references, NOT references (Postgres keyword collision).
- RLS on connected_email_accounts shifts from tenant-admin-scoped to user-scoped — each user manages own. A SEPARATE policy allows tenant admins to SELECT (read-only oversight of all tenant inboxes).
- DO NOT touch src/lib/email/smtp-sender.ts. New send code lives in src/industries/education-consultancy/features/email/lib/gmail-client.ts (Phase 2 will add sendMessage there; Phase 1 only builds the OAuth client + getProfileEmail).
- OAuth scopes: keep the existing https://mail.google.com/ + https://www.googleapis.com/auth/userinfo.email (same as legacy flow).
- OAuth flow MUST set access_type=offline AND prompt=consent (the latter forces Google to re-issue a refresh_token on every connect — without it, the 2nd-and-later inbox connects for the same user receive no refresh_token and the row's NOT NULL constraint will fail).
- The state param on the OAuth flow can simply be the user_id (or signed if the legacy flow does signing — read it and mirror). Callback validates state matches auth.uid() before exchanging the code.
- The new /api/v1/email/inboxes/callback redirects on success/failure to /settings?connected=<email> (or ?error=<reason>) — never returns JSON. The settings page reads the query param on mount and shows a toast.
- For the DELETE endpoint, both the .eq("id", id) AND .eq("user_id", auth.userId) filters are required per the scopedClient contract — the wrapper auto-adds tenant_id but NOT id. Without .eq("id", id) the delete would target every row owned by the user in the tenant.
- The InboxConnector component reads `GET /api/v1/email/inboxes` to populate, but the callback redirects (no JSON response to the component) — so the component re-fetches on mount when it sees ?connected=<email> in the URL.
- Industry gating runs on ALL 4 new endpoints. Don't skip the callback — even though it's the OAuth landing page, a non-education tenant should not be able to consume the callback URL.

If you find a real ambiguity or issue with the approach, surface it in your handoff back to Opus rather than guessing. Especially: if the legacy callback's user_id capture turns out to require schema/RLS gymnastics that break the legacy email-forward feature, flag it before plowing through — that's the most likely thing in this brief that could go sideways.
```
