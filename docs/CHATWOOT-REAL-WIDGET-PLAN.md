# Plan: make the branded website chat widget real, through Chatwoot

Status: APPROVED by Sadin and Anish (2026-11-22). Not built yet. Native-EdgeX-channel option is OFF the table.

## Goal
The branded widget (`public/chat-widget/chat-widget.js`, Admizz-styled, contact form, "Powered by Zunkiree") must deliver
visitors' messages into EdgeX Inbox and show counsellors' replies back to the visitor. Today it uses a mock transport
(`config.transport` with `start / send / submitDetails`) and makes no network calls.

## Approach
Chatwoot runs the conversation behind the widget. EdgeX Inbox gets chats through the Chatwoot webhook that already exists, and
replies go out through the Chatwoot code that already exists.

1. The Website chat card creates an **API-type inbox** in Chatwoot (the web-widget type cannot be called from outside
   Chatwoot's own iframe), instead of a web-widget inbox.
2. The widget calls Chatwoot's public Client API: create contact, create conversation, post message, read messages.
3. Chatwoot -> EdgeX through the existing webhook (`chatwootAdapter`, HMAC signature, `process-inbound`, lead match).
4. Counsellor reply in EdgeX -> `sendMessage` -> Chatwoot -> widget (poll first; live connection later).

## Verified in Chatwoot 4.19.1 source (not guessed)
- Public Client API routes: `inboxes/:id/contacts` (create/show/update), `.../conversations`, `.../messages`
  (index/create/update), toggle_typing, update_last_seen.
- `Channel::Api` has `webhook_url`, `hmac_mandatory`, `hmac_token`, `identifier`.
- Tested live on stage: a request from an arbitrary origin is accepted (`access-control-allow-origin: *`). No rate-limit
  headers seen. So by default any website that knows the inbox identifier can call the API.

## Closing most of the open door (new finding, needs a test)
With `hmac_mandatory = true`, creating a contact requires an `identifier` plus an `identifier_hash` = HMAC-SHA256 of that
identifier with the inbox's `hmac_token`. Only a server holding the token can produce it. So:
- EdgeX adds ONE small public endpoint, `POST /api/public/chat/session`: checks the request Origin against the tenant's
  allowed website, rate-limits per IP, and returns `{ identifier, identifier_hash }` for a fresh random identifier.
- The widget uses that to create its contact, then talks to Chatwoot directly. The contact `source_id` is an unguessable
  per-visitor secret, so only the visitor who created it can post to that conversation.
- Limit to know: an Origin header only stops other websites in a browser. A script can fake it. The rate limit on the session
  endpoint is what blunts scripted floods. This reduces the open door; it does not remove it.
- Still to do at the front door: a rate limit on Chatwoot's public chat path in Traefik (server-side, never edit Traefik's
  own settings), and a honeypot field in the widget form.

## Proven on a real Chatwoot 4.19.1 (local experiment, 2026-11-22)
- An API inbox created with `hmac_mandatory: true` returns `inbox_identifier` and `hmac_token`.
- With the lock on, EVERY public call needs `identifier_hash` (create contact, create conversation, post message, read
  messages, update contact): no hash or a wrong hash gives 401, the right hash gives 200. The widget therefore keeps the hash
  it gets from the session endpoint for the whole session (it is derived from a random identifier only EdgeX can sign).
- Round trip: the visitor's message is `message_type` 0, the counsellor's reply is 1, and the visitor can read both.
- The account webhook fires for incoming and outgoing messages with account, inbox, conversation, sender id, name, phone and
  email, and `channel: Channel::Api`. `chatwootAdapter.parseInboundEvent` parses it unchanged (test added from the real payload).

## Build steps (stage first)
1. DONE (local): `connectWebsiteChat({ inboxType: "api" })` and `POST /api/v1/inbox/website-chat { branded: true }` create the API inbox with
   `hmac_mandatory`, store identifier and encrypted hmac token. The card UI does not offer it yet.
2. DONE: webhook shape confirmed against a real API inbox; parses unchanged.
3. DONE (local, mock-tested): `POST /api/public/chat/session` (`src/lib/inbox/website-chat/session.ts` + route). Body `{ inbox }`.
   Checks, in order: feature flag, id shape, per-IP limit (60 / 10 min), inbox lookup (unknown, off, wrong type: one identical 404),
   Origin must be the tenant's website (https, with or without www; no Origin header is refused), per-inbox limit (1000 / 10 min).
   Returns `{ chatwootBaseUrl, inboxIdentifier, identifier, identifierHash }`. CORS names the one allowed origin, only on success.
   Not yet exercised against a live local server (needs a branded inbox connected locally).
4. DONE (local, jsdom-tested): the widget's real transport. With `connection: { inbox, api? }` it asks the session endpoint (api defaults
   to the origin the script came from), then calls Chatwoot's public client API with `identifier_hash` on every call. Lazy: nothing
   is contacted until the visitor sends. Polls every 5 s while the page is visible (backs off to 30 s on errors), shows only
   counsellor messages (type 1), resumes after a reload (sessionStorage), re-signs once on a 401, shows a plain notice when the
   team cannot be reached, normalises phone numbers to international form (config `contact.defaultCountryCode`, retry without the
   number if Chatwoot rejects it), hidden spam-trap field. The mock remains when no `connection` is given.
   Still to do on the Admizz site: pass `connection.inbox` (+ `defaultCountryCode: "+977"`) from an env variable.
5. "Online": decide between a static value and EdgeX office hours (Chatwoot's agent status will not drive it for API inboxes).
6. Stage test end to end, then abuse tests. Security review (`/security-auditor`) before production.
7. Production: its own Chatwoot install and host, a separate decision.

## Not decided / unverified
- Chatwoot's own rate limits on public routes.
- Reply delivery: polling interval vs the live connection.
- Visitor reconnect rules (same visitor, new tab, cleared storage) and session lifetime.
- Data retention for visitor details (personal data).
