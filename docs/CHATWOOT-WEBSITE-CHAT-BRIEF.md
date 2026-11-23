> **Status note (2026-11-20).** This is the original planning brief, written 2026-11-18 before the build; the
> "DRAFT, not started" line below is out of date. Built since: Phase 1 (receive), Phase 2 (reply from EdgeX),
> Phase 3 (the Website chat settings card, plus logo, office hours and the "online" fix), and a prototype branded
> chat widget (`public/chat-widget/`). Not built: Phase 4 (Open Inbox button), Phase 5 (AI replies), and the
> real connection of the branded widget. Migrations are now **294** and **295** (renumbered from 282/283).
> For the current state and the production checklist, read `CHATWOOT-GO-LIVE-BRIEF.md` and
> `CHATWOOT-DECISIONS-BRIEF.md`. The Chatwoot facts and the EdgeX design reasoning below still apply.

# Chatwoot Website Chat — build brief (DRAFT, not started)

Status: planning only. Nothing in this brief has been built in EdgeX. Chatwoot-side behaviour below was **verified on a local
Chatwoot 4.19.1 (2026-11-18)**; EdgeX-side facts come from reading this repo and are marked as such.

## 1. Goal

A website chat bubble (first: admizzeducation.com) whose chats land in EdgeX as conversations linked to leads. Counselors can
reply from EdgeX or open the full Chatwoot inbox in a new tab, already signed in. A tenant admin turns the feature on from
Settings. Later, an AI replies to common questions using the tenant's knowledge base.

Chatwoot = chat engine (self-hosted, own domain). EdgeX = CRM, tenant control panel, system of record for leads.

## 2. Decisions needed from the leads before building

1. **Where Chatwoot runs in production** (VPS subdomain such as inbox.<domain>, or separate server). It needs HTTPS and a public
   address, because EdgeX webhooks must be reachable *from* Chatwoot and the website bubble loads from it. Check VPS RAM/disk first
   (Rails + Sidekiq + Postgres/pgvector + Redis). Not checked yet.
2. **Scope:** universal feature (the existing inbox is universal, no FEATURES id) or education_consultancy only (EdgeX default).
3. **Retire or keep** the existing EdgeX inbox UI for web chat. This brief assumes **keep**: web chat appears in the existing
   `/inbox` as provider `chatwoot`, plus an "Open full inbox" button.
4. **AI auto-reply policy** (drafts only, or auto-send for FAQs) and the visitor consent notice wording.
5. **Chatwoot licence check** for anything under its `enterprise/` folder (core is MIT). The plan below uses only core APIs.

## 3. Verified Chatwoot facts (local test)

| Need | How | Notes |
|---|---|---|
| Reply from outside | `POST /api/v1/accounts/:acc/conversations/:cid/messages` with header `api_access_token`, body `{content, message_type:"outgoing", private:false}` | returns message id |
| Webhook out | `POST /api/v1/accounts/:acc/webhooks {webhook:{url, subscriptions:[...]}}` | response includes a per-webhook `secret` |
| Webhook signing | headers `X-Chatwoot-Timestamp`, `X-Chatwoot-Signature: sha256=HMAC_SHA256(secret, "<ts>.<raw body>")`, `X-Chatwoot-Delivery` | verify with timing-safe compare + timestamp window |
| Private-address block | Chatwoot refuses webhook URLs that resolve to private IPs | prod URL must be public HTTPS; local dev needs `SAFE_FETCH_ALLOW_PRIVATE_NETWORK=true` on Chatwoot |
| Create tenant setup | Platform API (`PlatformApp` token): `POST /platform/api/v1/accounts`, `/users`, `/accounts/:id/account_users {user_id, role}` | then the user's own token creates the inbox |
| Create inbox | `POST /api/v1/accounts/:acc/inboxes {name, channel:{type:"web_widget", website_url, widget_color, welcome_title, welcome_tagline}}` | response has `website_token` + `web_widget_script` |
| Sign-in link | `GET /platform/api/v1/users/:id/login` returns `/app/login?email=..&sso_auth_token=..` | single-use (2nd use 401). Works on OSS. |
| Bot | `POST /api/v1/accounts/:acc/agent_bots {name, outgoing_url}`, `POST .../inboxes/:id/set_agent_bot {agent_bot}` | bot gets incoming msgs (conversation starts `pending`); replies with its own token; hands off via `POST .../conversations/:id/toggle_status {status:"open"}` |
| Gotchas | API cannot create *incoming* messages on website inboxes (422). Webhook `message_type` values seen: `incoming`, `outgoing`, `template` (Chatwoot's own prompts like "Give the team a way to reach you" — ignore these) |

## 4. EdgeX facts this plan builds on (from reading the repo)

- Tables from `supabase/migrations/044_unified_inbox.sql`: `inbox_channels`, `conversations`, `messages`; later migrations do not alter
  them; latest migration is 281, so use 282+. `inbox_channels.provider` has a CHECK limited to
  `whatsapp|messenger|instagram|sandbox|email`, so a migration must widen it. `UNIQUE(provider, external_account_id)` exists.
  Conversation find-or-create anchor is `UNIQUE(channel_id, external_contact_id)`; messages dedupe on `(channel_id, provider_message_id)`.
- Adapter seam: `ChannelAdapter` in `src/lib/inbox/adapters/types.ts`, registered in `adapters/index.ts` (`getAdapter(provider)`).
  Needs `verifySignature`, `parseInboundEvent` -> `NormalizedInbound[]`, `sendMessage` (never throws), `capabilities`.
- Inbound pipeline: webhook inserts an `events` row, returns 200, `after()` runs `processInboundEventsByIds`; a 15-min Inngest cron is
  the safety net. Single send path: `sendMessage()` in `src/lib/inbox/send-message.ts`.
- Lead matching is **phone only and link-only** (`resolveLeadByPhone` in `process-inbound.ts`; links on exactly one match, never creates).
  Web visitors often give email first, so email matching and lead creation must be added (`normalizeEmail` in `src/lib/leads/dedup.ts`).
- `src/lib/inbox/scope.ts` hides conversations with `lead_id = null` from counselor-scoped users. Unlinked web chats would be invisible
  to counselors unless handled.
- Encryption: `encryptToken/decryptToken` (AES-256-GCM, `INBOX_TOKEN_ENC_KEY`). Only `access_token` is encrypted; `meta` is not, so any
  secret placed in `meta` must be encrypted first.
- UI: `/inbox` page + `src/components/dashboard/inbox/InboxUI`; routes under `src/app/(main)/api/v1/inbox/`; channel connect UI is
  `src/components/dashboard/settings/channels-card.tsx` (hard-coded to WhatsApp); channels POST validates `provider` as `["whatsapp"]` only.
  Settings are a modal: add the new card in `panels/communications-panel.tsx` next to `ChannelsCard`.
- AI: the draft route only approves existing drafts; **no draft generator exists yet**. Reusable: `src/lib/ai/provider.ts`, `budget.ts`
  (`checkDailyBudget`), `retrieval/retrieve.ts`, `flag.ts` (env kill switch AND `tenants.ai_enabled`). The current assistant prompts/tools are
  staff-facing, so a visitor path needs its own prompt and a read-only, retrieval-only toolset.
- Rate limiting: `checkRateLimit(key, config)` in `src/lib/api/rate-limit.ts` (DB-backed). Webhook route pattern to copy:
  `src/app/api/webhooks/meta/[provider]/route.ts` (raw body first, verify, fast 200). The Meta route hard-codes providers and one shared
  verify token, so add a **dedicated** `/api/webhooks/chatwoot` route.

## 5. Phases (each ships on its own; stage first, prod only after verification)

### Phase 1 — Receive chats (read-only mirror)
- Migration `282_inbox_chatwoot_provider.sql`: widen the provider CHECK to include `chatwoot` (additive; apply to stage first, with before/after counts).
- `src/lib/inbox/adapters/chatwoot.ts`: `verifySignature` (HMAC over `ts.body`, timing-safe, reject stale timestamps), `parseInboundEvent`
  (only `message_created` where `message_type` is `incoming`; map contact id -> `externalContactId`; contact phone/email/name; message id ->
  `providerMessageId`). Register in `adapters/index.ts` and the `InboxProvider` type.
- Route `src/app/api/webhooks/chatwoot/route.ts`: resolve the channel by Chatwoot account id + inbox id from the payload, then verify with
  *that channel's* secret; unknown channels return 200 and are dropped (no enumeration). Insert `events`, fast 200, reuse the existing processor.
- Lead linking: keep phone match; add email match; create a lead when the visitor supplies contact details and no match exists; define
  counselor visibility for unlinked chats.
- Mirror agent replies made inside Chatwoot (`message_type: outgoing`) as outbound / `human_agent`, deduped by Chatwoot message id.
- Tests (vitest, co-located): adapter signature + parsing, route (bad signature 403, unknown channel 200-drop, duplicate delivery), lead matching.
- Done when: a message from the bubble shows in `/inbox`, linked or created as a lead, and a replay of the same webhook creates no duplicate.

### Phase 2 — Reply from EdgeX
- `adapter.sendMessage` -> Chatwoot messages API using the channel's encrypted API token; store the returned message id as
  `provider_message_id` so the webhook echo is deduped. `capabilities`: no session window, no templates.
- Done when: a reply sent in `/inbox` appears in the visitor's bubble exactly once.

### Phase 3 — "Website Chat" settings (tenant self-serve)
- New card in `communications-panel.tsx`; admin-only API (`requireAdmin`, `scopedClient`) e.g. `POST /api/v1/inbox/chatwoot/setup`.
- Server-side flow: ensure Chatwoot account for the tenant (Platform API) -> create inbox (web_widget, allowed domains, color, titles,
  reply time, pre-chat form) -> register the webhook (store its secret encrypted) -> create the `inbox_channels` row (`provider=chatwoot`,
  `external_account_id` encoding account+inbox, encrypted API token) -> return the snippet and `website_token`.
- Server env: `CHATWOOT_BASE_URL`, `CHATWOOT_PLATFORM_TOKEN`, kill switch `INBOX_CHATWOOT_ENABLED === "true"` (matches existing flags). Fail closed.
- Done when: an admin enables chat, pastes the snippet on a test page, and chats arrive (Phase 1) with no manual Chatwoot clicks.

### Phase 4 — "Open Inbox" button
- Route that maps the EdgeX user to a Chatwoot user (create on demand; owner/admin -> administrator, counselor -> agent), requests a
  **fresh** single-use link, and redirects (new tab). Never store or reuse the link.
- Done when: clicking the button lands a counselor in the tenant's Chatwoot account without a password, and a second use of the same link fails.

### Phase 5 — AI replies (after 1-4 are stable)
- Chatwoot Agent Bot `outgoing_url` -> EdgeX route. Start in **draft mode** (counselor approves), then optional auto-reply for FAQs.
- Reuse `retrieve()`, `checkDailyBudget`, `model()`; new visitor-facing prompt (no staff tools, retrieval only, never promise admission/visa/fees);
  new env flag + per-tenant column (mirror `ai_enabled`); handoff by `toggle_status open` when unsure or the visitor asks for a person.
- Consent: short privacy notice in the bubble and consent before collecting a phone number. Confirm what data may go to the model provider.

### Phase 6 — Admizz website + production rollout
- Website repo (`~/Projects/admizz-web-dev`): loader already added locally (branch `feature/local-chatwoot-bubble`, unpushed). Still to do: hide on
  `/affiliate-dashboard` and `/affiliate-admin`, check mobile bottom-bar overlap, add the Chatwoot host to `nginx/static.conf` `$csp`
  (script-src, connect-src incl. wss, frame-src), set `NEXT_PUBLIC_CHATWOOT_BASE_URL` / `NEXT_PUBLIC_CHATWOOT_WEBSITE_TOKEN` in deploy secrets
  (baked at build time), test on dev-web first. Tawk.to removal is part of that change.
- Chatwoot production: HTTPS domain, secrets, backups, upgrade plan, Sidekiq monitoring.

## 6. Risks
- Two systems to run/upgrade; chat data lives in Chatwoot while leads stay in EdgeX (webhook failures = drift; the 15-min cron is the safety net).
- Public webhook endpoint: verify signature + timestamp, rate limit, never leak whether a channel exists.
- Anonymous visitors: spam/abuse (rate limits, allowed domains), privacy notice and consent.
- AI wrong answers: ground in the tenant KB, budget caps, human handoff, drafts first.
- Counselor-scope visibility for unlinked chats; email-based lead creation can create duplicates if dedup is loose.

## 7. Out of scope here
WhatsApp/Instagram/Messenger through Chatwoot (EdgeX already has its own adapters; decide later whether to route them through Chatwoot),
Chatwoot Captain/enterprise features, replacing the Chatwoot UI with a fully native one.

## 8. Rules to follow when building (EdgeX CLAUDE.md)
New tenant tables need `tenant_id` + RLS; prefer `scopedClient(auth)`; additive migrations, stage before prod; update `docs/FEATURE-CATALOG.md`;
`npm run build` clean before pushing; PRs go to `stage`, never `main`. Per the user (2026-11-18) Plane is not being used for this work.
