# Brief: AI replies in the EdgeX website chat

> **Changed 2026-11-25 (after the first stage test):** the AI reply no longer runs as an Inngest function. The Inngest Hobby plan hit its monthly limit (52,026 / 50,000), so Inngest stopped starting any new run and the first version never answered. The reply is now scheduled **in the EdgeX server process** (`src/lib/inbox/ai-reply/scheduler.ts`, 5 s quiet period, one run per chat at a time). Where the text below says Inngest / `inbox/ai-reply.requested`, read "the in-process scheduler". This is a deliberate exception to the repo's "background work is Inngest" convention and needs a lead's approval in the PR.

**Written:** 2026-11-25 (Opus, planner). **For:** the Sonnet executor sessions.

**Two parts, two repos.** Build them in order:
- **Part A** is in `zunkiree-search-v1`. Do it first.
- **Part B** is in `edgexcrm`. It depends on Part A.

## Why

Admizz website-chat visitors get no reply. On 2026-11-24 a visitor (Khagendra kc) wrote "Study in the UK", "Ok" and "Fast", nobody answered for over an hour, and the chat stayed Unassigned.

We already have an AI that knows Admizz's courses: the **education counsellor agent** in `zunkiree-search-v1`, which already answers on the Admizz website widget. Connect it to EdgeX website chat.

## Product decisions (final, from the user, 2026-11-25)

1. **When:** the AI replies instantly to every visitor message, as long as no human has accepted the chat.
2. **How:** the AI sends directly to the visitor. There is no approval or draft step. In the EdgeX Inbox the message is marked as AI.
3. **When it stops:** a counsellor clicks **Accept** (the existing claim flow). After that, the AI never replies in that chat.
4. **Automatic hand-off (changed 2026-11-25, replaces the earlier "keep answering" decision):** when the question is outside the knowledge base, or the visitor asks for a person, the AI **stops** and the chat is handed to the team:
   - The visitor gets one short message saying a counsellor will reply here.
   - The chat is flagged **"Needs a human"**. AI replies stop for that chat. The pop-up and list show the flag so the team sees it first.
   - After hand-off the AI does not reply again unless a counsellor switches AI back on.
5. **Scope:** the **Admizz** website chat (provider `chatwoot`, education_consultancy) only. WhatsApp and other channels are untouched.

## Ground rules (both parts)

- Cut the branch from the latest `stage` of that repo. **Do not commit, push or open a PR until the user says so.**
- **No database access of any kind** and no migrations; none are needed. Never run SQL against stage or prod.
- **Background work goes in Inngest functions** (`src/lib/inngest/`). Never use inline long work, never GitHub Actions cron.
- If something in this brief turns out to be wrong once you read the code, stop and report it. Don't invent around it.
- **Final report:**
  - Files changed.
  - Tests added, with pass counts.
  - tsc, lint and build results.
  - What you verified by hand vs. what is unverified.

---

## Part A: zunkiree-search-v1 (`~/Desktop/Projects/zunkiree-search-v1/backend`)

**Goal:** EdgeX's server can call the education agent safely, and gets a plain-text answer back.

**Background (verified in code):**
- **The endpoint.** The education agent is served by `POST /api/v1/query/stream` (`app/api/query.py`, `submit_query_stream`). It is SSE, and the request body is `QueryRequest`: `site_id`, `question` (max 500), `session_id` (required for education), `channel`, and so on.
- **Origin check.** For education it calls `require_allowed_origin` (`app/api/origin_guard.py`). A request with no `Origin` header is allowed, so server-to-server already passes this.
- **Rate limit.** For education it also calls `enforce_rate_limit(request, site_id, "chat", CHAT_LIMIT)`. In `app/utils/rate_limit.py` that keys on **client IP**: 20 messages per 60 s.
  - Every EdgeX call comes from one server IP, so all chats would share one bucket and get 429s quickly. **This must change for EdgeX calls.**
- **Events.** The agent (`app/services/education_agent.py`) streams `token`, `ui_block` (course cards and so on), `ui_pending` and `tool_call` events, then `done` with `answer`.
  - **EdgeX can only show plain text.** If the answer relies on a `ui_block` (for example "here are some courses:" followed by cards), the EdgeX visitor sees nothing useful.

**Build:**

1. **Server key.**
   - Add a setting `EDGEX_SERVER_KEY` (env, read through `app/config.py`).
   - When a request carries header `X-EdgeX-Key` that matches it (constant-time compare):
     - Rate-limit per `session_id` instead of per IP. Use the same limiter and a new scope, for example `edgex`; pick a sensible limit such as 20 per 60 s per session.
     - Still enforce the origin rule.
   - A wrong key gives a 401.
   - No header at all: behaviour stays **exactly** as today.
   - Unset key on the server: the header is ignored and behaviour is as today.
2. **Plain-text output.**
   - Add a response profile for text-only callers. Preferred: extend the `channel` pattern with `"text"`. First check whether an existing profile, such as `instagram`, already gives text-only output; if it does, reuse it and say so.
   - On that profile, the final `done.answer` must stand on its own as plain text. If the agent produced `ui_block`s (course lists and similar), render their key facts into the answer as short text lines: course name, university, country, fee and intake where present.
   - No markdown tables, and no "click the card below" wording.
3. **Structured "needs a human" signal.** Verified: the agent has **no** such signal today. When the knowledge base has no answer it only says in words that it doesn't have that detail (`education_agent.py` around lines 379-385), and its prompt forbids promising that a counsellor will contact the student.
   - Add `needs_human: bool` and `needs_human_reason` (`out_of_knowledge` | `asked_for_person`) to the `done` event, for the text channel only.
   - Set it when the knowledge-base lookup finds no clear answer, when the model declines, and when the visitor asks for a human, a counsellor or a call.
   - Prefer the signal the agent already computes at those lines over parsing its words. Do not match on the wording of the answer text.
   - Do **not** change the agent's prompt rule about promising contact. EdgeX sends the hand-off message itself.
4. **Tests:**
   - `needs_human` is true for an out-of-knowledge question and for "can I talk to a counsellor?".
   - `needs_human` is false for a normal answerable question such as "Study in the UK".
   - Key valid: limits by session.
   - Key wrong: 401.
   - No key: unchanged IP limit.
   - The text profile turns a sample course block into text in `done.answer`.
   - Run the backend test suite.
4. **Hand-check.** Run locally and send a `curl` with the key, `site_id` = the Admizz education site, a `session_id`, `channel: "text"` and the question "Study in the UK". Paste the `done.answer` in your report.

**Do not:**
- Change the widget.
- Change other tenants' paths.
- Change the browser behaviour of `/query/stream`.

---

## Part B: edgexcrm (`~/Desktop/Projects/edgexcrm`)

**Goal:** when a website-chat visitor writes and no human has accepted the chat, EdgeX asks the Part A agent and sends the answer back as an AI message.

**Read first:**
- `CLAUDE.md`, especially tenant isolation and the Inngest rule.
- `docs/reference/03-INNGEST-BACKGROUND-JOBS.md`.

**What already exists (reuse it, don't rebuild it):**
- **Conversation fields.** `conversations.ai_autonomy` (`off` | `suggest` | `autonomous`, default `off`, migration 044) is already shown read-only as "AI mode" in `src/components/dashboard/inbox/ContactPanel.tsx`. The PATCH allow-list in `src/app/(main)/api/v1/inbox/conversations/[id]/route.ts` already includes it.
- **Message fields.** `messages.author_type` already allows `'ai_agent'`, and `messages.ai_metadata` is JSONB.
- **Sending.** `sendMessage()` in `src/lib/inbox/send-message.ts` already takes `author: { type: "ai_agent", aiMetadata }`, and it is the path that delivers to Chatwoot.
- **Inbound flow:**
  1. The Chatwoot webhook (`src/app/api/webhooks/chatwoot/route.ts`) enqueues events.
  2. `processInboundEventsByIds` runs in `after()`.
  3. `src/lib/inbox/process-inbound.ts` finds or creates the conversation, then inserts the inbound `messages` row (`author_type: "customer"`).
- **Claim / Accept:**
  - `src/lib/inbox/claim.ts`, `claim-rules.ts` (`CLAIM_PROVIDERS`, `OWNERLESS_FILTER`, `POPUP_WINDOW_HOURS`).
  - Route `src/app/(main)/api/v1/inbox/conversations/[id]/claim/route.ts`.
  - A chat is human-owned when `assignee_type = 'human'` and `assigned_to_user_id` is set.
- **Settings.** The website-chat settings live in `inbox_channels.meta.website_chat` (`src/lib/inbox/website-chat/settings.ts`, `service.ts`, route `src/app/(main)/api/v1/inbox/website-chat/route.ts`). Note: `inbox_channels.status` must never be set to `paused`.
- **Inngest:**
  - Client: `src/lib/inngest/client.ts`.
  - Register functions in `src/app/api/inngest/route.ts`.
  - Existing examples: `src/lib/inngest/functions/inbox-process.ts`, `agent-follow-up-drafter.ts`.
- **Tenant AI switch.** `tenants.ai_enabled` (migration 174) is the tenant-level AI kill switch.

**Build:**

1. **Config:**
   - Env vars: `INBOX_AI_REPLY_ENABLED` (default off), `ZUNKIREE_SEARCH_URL`, `ZUNKIREE_SEARCH_KEY`. All server-only; never `NEXT_PUBLIC`.
   - Website-chat settings gain `ai_reply_enabled: boolean` (default false) and `ai_site_id: string`, stored in `meta.website_chat`.
   - Admin/owner only, validated, with tests matching the existing settings tests.
2. **Settings UI.**
   - The Website chat card in Settings > Communications gets an "AI replies" switch and a "zunkiree-search site ID" field.
   - Show them only when the env flag is on and the tenant is education_consultancy.
3. **New chats start with AI on.** In `process-inbound.ts`, when a **new** `chatwoot` conversation is created on a channel with `ai_reply_enabled`, insert it with `ai_autonomy: 'autonomous'`.
4. **Trigger.**
   - In `process-inbound.ts`, after a **new** inbound customer message is inserted for a `chatwoot` conversation, `inngest.send({ name: "inbox/ai-reply.requested", data: { tenantId, conversationId, messageId } })`.
   - Not on a duplicate (idempotent conflict).
   - Non-fatal: a failed send is logged and never breaks inbound processing.
5. **New Inngest function** `src/lib/inngest/functions/inbox-ai-reply.ts`, registered in `route.ts`:
   - **Debounce** per `conversationId`, about 5 s, so a burst like "Ok" then "Fast" gets one reply.
   - **Load the conversation and channel tenant-scoped.** Then **skip** (log the reason, send nothing) unless **all** of these hold:
     - The env flag is on.
     - `tenants.ai_enabled` is true.
     - The channel `ai_reply_enabled` is true and `ai_site_id` is set.
     - The conversation's provider is `chatwoot`, and `status = 'open'`.
     - `ai_autonomy = 'autonomous'`.
     - **Not human-owned.** Reuse the claim rules; don't write a second definition.
     - **The latest message is from the customer.** If the last message is already `ai_agent` or `human_agent`, skip; this also makes retries safe.
   - **Build the question** from the customer messages since the last outbound message, joined with newlines and capped to 500 characters (the Part A limit).
   - **Call Part A:**
     - `POST {ZUNKIREE_SEARCH_URL}/api/v1/query/stream` with `X-EdgeX-Key`, `site_id = ai_site_id`, `session_id = conversationId`, `channel: "text"` (or whatever Part A settled on), and **no `Origin` header**.
     - Read the SSE stream and take `done.answer`.
     - Timeout about 30 s.
   - **Re-check ownership right before sending.** A counsellor may have clicked Accept while the AI was thinking. If the chat is now human-owned, drop the answer.
   - **Send:** `sendMessage({ tenantId, conversationId, content: answer, author: { type: "ai_agent", aiMetadata: { source: "zunkiree-search", site_id, session_id } } })`.
   - **Hand-off.** If `done.needs_human` is true:
     - Send one fixed message as `ai_agent`: "Thanks, I've passed your question to our counsellors. One of them will reply here soon." Make the text a constant so the Admizz team can change it later. Do **not** also send the agent's own answer.
     - Set `conversations.meta.needs_human = { at, reason }` (the existing `meta` JSONB, no migration) and set `ai_autonomy = 'off'`.
     - Create the notification for the team the way `process-inbound.ts` already does for new chats, with the title "Needs a human".
   - **On any error or empty answer:** send nothing and log a warning. The chat just waits for a human, as it does today.
   - **Never** put visitor text in logs (privacy). Log ids and reasons only.
6. **Accept stops the AI.** In the claim route (and handover/take-over if they set an owner), also set `ai_autonomy = 'off'`. Keep the existing atomic first-wins logic intact.
7. **The pop-up must still show AI-handled chats.**
   - `src/app/(main)/api/v1/inbox/pending-claims/route.ts` filters `.eq("last_message_direction", "inbound")`. After an AI reply, the last direction is outbound, so the chat would vanish from the "new chat" pop-up.
   - Change it so an open, ownerless website chat stays pending when the last **non-AI** message is from the visitor. Equivalently: the visitor spoke last, ignoring AI messages.
   - Keep `POPUP_WINDOW_HOURS`.
   - Add an "AI is replying" hint on the pop-up card and the list chip for chats with `ai_autonomy = 'autonomous'`.
   - Chats with `meta.needs_human` show a clear **"Needs a human"** badge on the pop-up card and the list chip, sorted above chats the AI is still handling. Clicking Accept clears the flag.
8. **Inbox screens:**
   - `MessageThread.tsx`: AI messages (`author_type = 'ai_agent'`) get a small "AI" label.
   - `ContactPanel.tsx`: turn the read-only "AI mode" line into an On/Off switch (`autonomous` / `off`) for website chats.
     - Allowed for the chat owner or an admin only, the same rule as `chatChangeLock` in `claim.ts`.
     - When no one owns the chat, an admin may toggle it.
9. **Tests.** Use explicit, non-DB test files only. Do **not** run the whole suite or `src/lib` broadly; it hits the local DB. Cover:
   - Every skip rule in the Inngest function.
   - Debounce config.
   - Question building and the 500-character cap.
   - SSE parsing: takes `done.answer`, ignores `ui_block`.
   - Error → no send.
   - Re-check-before-send.
   - Claim sets `ai_autonomy` to off.
   - Pending-claims still lists a chat whose last message is AI.
   - Settings validation.
   - The `process-inbound` wiring sends the event only for new chatwoot customer messages. Use a wiring test, like the existing `process-inbound.claim-wiring.test.ts`.
10. **Gates:**
    - `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit`
    - `npm run lint`
    - `npm run build`
11. **Docs:** add a `docs/FEATURE-CATALOG.md` row ("Website chat AI replies").

**Do not:**
- Change WhatsApp, Messenger, Instagram or email.
- Change how leads are created from chats.
- Add a migration.
- Touch any database.

**Local end-to-end (report what you actually saw):**
1. Run Part A locally. Point `ZUNKIREE_SEARCH_URL` at it, set the key and the flag, and run `npx inngest-cli dev`.
2. Turn AI replies on in the Website chat card, then chat from the local widget.
3. Expect an AI reply within a few seconds, labelled AI in the Inbox. The pop-up still shows the chat.
4. Click Accept, then send another visitor message. There should be no AI reply.

## Needs a human (not the executor)

- Generate the shared key and set it in both places:
  - zunkiree-search env `EDGEX_SERVER_KEY`.
  - EdgeX env `ZUNKIREE_SEARCH_KEY`, with `ZUNKIREE_SEARCH_URL` and `INBOX_AI_REPLY_ENABLED`.
  - Stage first, then prod.
- Find the Admizz education `site_id` in zunkiree-search, to type into the Website chat card.
- Tell Sadin: visitor messages go to zunkiree-search, which uses OpenAI. The Admizz website widget already does this.
