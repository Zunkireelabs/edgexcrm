# Unified Inbox — Phase 3a Brief (connect-a-channel UI + WhatsApp go-live)

> Sonnet build brief. Phase 3a of the unified inbox: build the **provider-agnostic connect-a-channel foundation** and **light up WhatsApp** (the first real channel). Branch off `stage`; stop at review. See `docs/UNIFIED-INBOX-BRIEF.md` for the whole feature. Messenger/Instagram are deliberately 3b/3c fast-follows — do NOT implement them here, but keep everything provider-agnostic so they slot in.

## Context — what's already built vs the gap

- **WhatsApp adapter is built** (`src/lib/inbox/adapters/whatsapp.ts`, flag `INBOX_WHATSAPP_ENABLED`): `verifyWebhook` (GET handshake vs `META_WEBHOOK_VERIFY_TOKEN`), `verifySignature` (HMAC vs `META_APP_SECRET`), `parseInboundEvent` (WhatsApp Cloud API → normalized), `sendMessage` (POSTs to `graph.facebook.com/v19.0/<phone_number_id>/messages` with the channel token), capabilities (24h window, templates).
- **Gaps to close in 3a:**
  1. The **Meta webhook POST** (`src/app/api/webhooks/meta/[provider]/route.ts`) is a stub (logs + discards). Needs real wiring.
  2. **Tenant routing** — `NormalizedInbound` has no `channelRef`, so the webhook can't map a WhatsApp payload to the right `inbox_channels` row (by `phone_number_id`).
  3. **No connect-a-channel UI/API** — admins can't create a channel without SQL.
  4. **Access tokens stored plaintext** — must be encrypted at rest now that real tokens land.
  5. The **24h-window guard** in `send-message.ts` only logs — it must *enforce* for WhatsApp.

## Decisions (confirmed with Sadin)
- WhatsApp first; Messenger/Instagram are later phases (their adapters stay stubs).
- Connect flow = **paste credentials** (admin pastes `phone_number_id` + access token; we show the webhook URL + verify token to paste into Meta). No Embedded Signup (that's a v2).
- Build + test against a **WhatsApp test number** (free, instant); the real number + app review run in parallel on Sadin's side.

---

## Track B — code deliverables (Sonnet)

### D1. `channelRef` for tenant routing
- Add `channelRef: string` to `NormalizedInbound` (`src/lib/inbox/adapters/types.ts`) — the provider account id the message arrived on.
- `whatsappAdapter.parseInboundEvent`: set `channelRef` from `change.value.metadata.phone_number_id` (add `metadata?: { phone_number_id?: string }` to `WAValue`). The sandbox adapter sets `channelRef` to its own account id (or leave the sandbox webhook using its `x-channel-id` header — keep sandbox working unchanged; just satisfy the type).

### D2. Wire the Meta webhook POST (`src/app/api/webhooks/meta/[provider]/route.ts`)
Replace the discard stub with the real flow, mirroring `src/app/api/webhooks/sandbox/route.ts`:
1. Resolve the adapter via `getAdapter(provider)`; 404 if unknown.
2. Read the **raw body** (`Buffer.from(await req.arrayBuffer())`), get `x-hub-signature-256`; `adapter.verifySignature(rawBody, sig)` → 403 on fail.
3. `adapter.parseInboundEvent(JSON.parse(rawBody))` → messages.
4. For each: look up `inbox_channels` by `(provider, external_account_id = msg.channelRef)` (service client). If no channel or not `active` → fast-ack 200 and skip (don't 500).
5. Enqueue each to the `events` queue (`type='inbox.inbound_received'`, same payload shape as the sandbox route — reuse it).
6. **Fast-ack 200** always (Meta disables slow webhooks). Keep the existing GET handshake (already real).
7. **Status callbacks (delivered/read):** WhatsApp posts `value.statuses[]` (not `messages`) to the same webhook. Add an `adapter.parseStatusEvent(payload) → {providerMessageId, status, timestamp}[]` (whatsapp implements; sandbox returns `[]`). In the webhook, patch `messages` by `(channel_id, provider_message_id)` → set `status` (`delivered`/`read`) + `delivered_at`/`read_at`. Forward-only (never downgrade `read`→`delivered`). Keep it simple; if this balloons, ship messages-only in 3a and statuses in 3b — **flag the choice in the PR**.

### D3. Connect-a-channel API — `src/app/(main)/api/v1/inbox/channels/route.ts` (+ `[id]/route.ts`)
- `GET` — list the tenant's `inbox_channels` (never return the decrypted token; return masked `••••last4` + status + webhook URL + the configured verify token for display).
- `POST` (admin only — `authenticateRequest` + `is_tenant_admin`/role check, matching how channel mutations are gated) — body `{ provider:'whatsapp', external_account_id, access_token, display_name }`. **Encrypt the token** (D5), insert `inbox_channels` row `status='active'`, return the row + the webhook URL (`https://<host>/api/webhooks/meta/whatsapp`) + verify token.
- `DELETE [id]` (admin) — remove the channel (cascades conversations/messages — warn in the UI).
- Use `scopedClient(auth)`; respect the existing `UNIQUE(provider, external_account_id)` (return a clear 409 if the number is already connected to another tenant).

### D4. Connect-a-channel Settings UI — `src/components/dashboard/settings/channels-card.tsx`
- A new card on `/settings` (admin-only; render it from `settings/page.tsx` next to `IndustryInfoCard`). Universal/global.
- Lists connected channels (provider icon, display name, masked token, status). **Connect WhatsApp** button → form: `Phone number ID`, `Access token`, `Display name` → Save → on success show the **Webhook URL** + **Verify token** in a copy-box with a one-line "paste these into your Meta app's WhatsApp → Configuration → Webhook" hint. Delete with a confirm ("removes its conversations + messages").
- Plain `fetch` + `sonner` toasts + `router.refresh()`, matching the leads/inbox client patterns.

### D5. Token encryption at rest — `src/lib/inbox/crypto.ts`
- AES-256-GCM helpers `encryptToken(plaintext): string` / `decryptToken(blob): string`, key from `INBOX_TOKEN_ENC_KEY` (32-byte hex/base64 in env). Output = base64(iv ‖ authTag ‖ ciphertext).
- Encrypt in the channels `POST`; **decrypt in `send-message.ts`** right before handing the channel to the adapter (the adapter keeps expecting a plaintext `access_token`). Fail closed if the key is missing.

### D6. Enforce the 24h-window guard — `src/lib/inbox/send-message.ts`
- Today it only `logger.warn`s. Change: when `adapter.capabilities.requiresTemplateOutsideWindow && !content.template` and the conversation is **outside the window**, **return `{status:'failed', error:'OUTSIDE_SESSION_WINDOW: …'}` and do NOT call the adapter** (and don't leave a stuck `queued` row — mark it `failed`). "Outside window" = latest **inbound** message's `provider_timestamp` is older than `capabilities.sessionWindowHours`. Within the window, text sends as today. (Template *composing* UI is out of scope — just enforce the guard so reps get a clear error instead of a silent Meta rejection.)

### D7. Env / flags (per env — Sadin sets; document in the PR)
`INBOX_WHATSAPP_ENABLED=true` · `META_APP_SECRET` · `META_WEBHOOK_VERIFY_TOKEN` · `INBOX_TOKEN_ENC_KEY` · plus `INBOX_SANDBOX_SECRET`/`INTERNAL_CRON_SECRET` already noted. The inbound processor cron (the `inbox-process.yml` workflow) must be live for inbound to drain — it activates on `main` at prod promotion; for dev testing use manual dispatch once on main, or drain manually.

---

## Track A — Sadin's Meta setup (from scratch; runs in parallel)

1. **Meta Business + developer app** — create a Business portfolio at business.facebook.com, then an app at developers.facebook.com (type: Business) → add the **WhatsApp** product.
2. **Test number (instant, free)** — WhatsApp → API Setup gives a **test `phone_number_id`** + a temporary 24h token + 5 free recipient numbers. Enough to build/dogfood **today**.
3. **Paste into the new UI** — Settings → Channels → Connect WhatsApp: paste the `phone_number_id` + token + a display name.
4. **Webhook** — in the app's WhatsApp → Configuration → Webhook, set the **Callback URL** + **Verify token** shown in our UI; subscribe to the **`messages`** field. (Set `META_WEBHOOK_VERIFY_TOKEN` + `META_APP_SECRET` in our env to match.)
5. **Go real (parallel, ~weeks)** — add a **real business phone number**, complete **Business Verification** + request `whatsapp_business_messaging` / `_management`, and get **message templates** approved (needed to message users outside the 24h window). Swap the test creds for the real ones in the UI when ready. The temp token expires in 24h — generate a **permanent System User token** for anything beyond first tests.

---

## Verification
1. `npm run build` clean + `npx eslint --max-warnings 50 .` 0 errors.
2. **Inbound (mocked, no Meta needed):** craft a WhatsApp-shaped payload, sign it `sha256=HMAC(META_APP_SECRET, body)`, POST to `/api/webhooks/meta/whatsapp` with a seeded `whatsapp` channel whose `external_account_id` = the payload's `phone_number_id` → 200 fast-ack → drain → conversation + message appear; bad signature → 403.
3. **Connect UI:** as admin, connect a WhatsApp channel → row created, token stored **encrypted** (psql: `access_token` is not the plaintext) → webhook URL + verify token shown. Non-admin → no card / 403.
4. **Outbound + guard:** within 24h of an inbound → text sends (real test number: message arrives on WhatsApp); simulate >24h (no recent inbound) → send returns `OUTSIDE_SESSION_WINDOW`, no stuck `queued` row.
5. **Live (test number):** message the test number from a registered WhatsApp → appears in `/inbox` (after drain) → reply → arrives on the phone. Tenant isolation: a second tenant can't see/POST the channel; duplicate `phone_number_id` → 409.

## Out of scope (later phases)
- Messenger / Instagram adapters (3b/3c) — leave as stubs; keep code provider-agnostic.
- Meta Embedded Signup / one-click connect (v2).
- Template-message composer UI (only the *guard* lands here).
- Media/attachment send (text-first).

## SONNET HANDOFF PROMPT
> Build **Unified Inbox Phase 3a** on a branch off `stage` per `docs/UNIFIED-INBOX-PHASE-3A-BRIEF.md`: provider-agnostic connect-a-channel foundation + WhatsApp go-live. Deliverables D1–D7: add `channelRef` to `NormalizedInbound` + populate it in the WhatsApp adapter; wire the real Meta webhook POST (verify HMAC → parse → route to tenant by `phone_number_id` → enqueue, reusing the sandbox route pattern; + delivery/read status callbacks, or flag if deferring to 3b); `inbox/channels` admin API (CRUD, `scopedClient`, **encrypted token**, 409 on duplicate number); a Channels card in Settings (paste-credentials Connect-WhatsApp form + webhook URL/verify-token display); `src/lib/inbox/crypto.ts` AES-256-GCM token helpers (decrypt in `send-message.ts`); and make the 24h-window guard in `send-message.ts` **enforce** (return failed, no stuck row) instead of just logging. Do NOT implement Messenger/Instagram (keep provider-agnostic) or Embedded Signup. Verify per the brief (build + eslint 0 errors + the mocked-signed-payload inbound test + the encrypted-token + window-guard checks). Commit trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Then STOP and summarize for Opus review.
