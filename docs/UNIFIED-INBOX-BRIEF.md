# Unified Inbox — Feature Brief & Status

> **Single source of truth for the omnichannel inbox.** Captures what shipped, what's deliberately stubbed, what's required before it works in a deployed env, and the remaining roadmap. Keep this current until the feature is fully live, then archive to `docs/archive/features/`.

**Status (2026-06-11):** Phases 1 + 2 + 3a **shipped to stage**; **real WhatsApp is LIVE end-to-end on dev** (`dev-lead-crm`) — inbound + outbound + read receipts, verified with a real phone. Migration 044 applied to the shared Supabase DB (additive, dormant for prod). **Not on prod yet.** Next: Phase 3b (near-instant inbound — `docs/UNIFIED-INBOX-PHASE-3B-BRIEF.md`), then prod promotion. See **Live state log** below for the exact dev wiring.

### Phase ledger
| Phase | What | Status |
|---|---|---|
| 1 | Foundation: tables, adapter seam, sandbox loop, 3-pane UI, AI seams | ✅ stage (`9eb782a`) |
| 2 | Notifications-on-inbound + `inbox-process.yml` workflow | ✅ stage (`8c19dbc`) |
| 3a | Connect-a-channel UI + WhatsApp go-live (webhook wiring, token encryption, 24h guard, status callbacks) | ✅ stage (`0279241`); **WhatsApp LIVE on dev** |
| 3b | Near-instant inbound (inline-process after fast-ack) | 📋 brief written, awaiting Sonnet |
| 4 | Messenger + Instagram (adapters are stubs) | ⏳ future |
| 5 | AI agent runtime over the 4 declared tools | ⏳ future |

### Live state log — WhatsApp on dev (2026-06-11)
Real WhatsApp proven end-to-end on `dev-lead-crm`. The wiring, for reproducibility / prod parity:
- **Meta app:** "EdgeX CRM" (app id `1322014153236497`), **Published/Live**, under business portfolio "Zunkiree Labs Pvt. Ltd." (`2965471130325336`). WhatsApp use case added.
- **Test number:** phone_number_id `1143343632197234` (`+1 555-646-8778`), WABA `1017943797291700`, status CONNECTED, recipient `+917624807563` verified.
- **Token:** a **permanent System User token** ("Edgex crm" system user, id `61590939201995`, Admin, assigned the app + WABA with Full control, scopes `whatsapp_business_messaging` + `whatsapp_business_management`, **never expires**). The earlier *temporary* dashboard token expired within hours and caused outbound 131005 — **always use a System User token.**
- **Channel row:** `inbox_channels` provider `whatsapp`, external_account_id `1143343632197234`, status active, token **encrypted at rest** (re-stored after the System User token swap; conversation preserved).
- **Dev env vars** (on the dev box `.env.local`): `INBOX_WHATSAPP_ENABLED=true`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `INBOX_TOKEN_ENC_KEY`, plus pre-existing `INTERNAL_CRON_SECRET` + `NEXT_PUBLIC_APP_URL`.
- **Webhook in Meta:** callback `https://dev-lead-crm.zunkireelabs.com/api/webhooks/meta/whatsapp`, subscribed to the **`messages`** field. **Gotcha:** had to subscribe the WABA to the app (`POST /<WABA_ID>/subscribed_apps`) — the use-case "Try it out" flow doesn't auto-subscribe it, so real inbound was silently dropped until then. Publishing the app was also required (unpublished apps only receive dashboard *test* webhooks, not real messages).
- **Dev auto-drain cron** (added to VPS root crontab, authorized by Sadin): `*/1 * * * *` hits `/api/internal/inbox/process` (reads `INTERNAL_CRON_SECRET` from `.env.local` at runtime). So inbound drains within ~1 min on dev. **This is why inbound lags up to ~60s on dev → Phase 3b makes it ~1–2s.**

### Prod-promotion checklist (when ready)
1. `git checkout main && git merge --no-ff stage && git push` (mig 044 already on shared DB — code-only).
2. Set the 4 WhatsApp env vars on the **prod** box (System User token works for both envs since it's account-scoped).
3. The `inbox-process.yml` workflow auto-runs on prod once on main (no prod VPS cron needed) — but it targets the **dev** URL; **add a prod-URL drain** (prod VPS cron or a prod workflow) so prod inbound processes.
4. Connect the channel on prod (Settings → Channels) and update the Meta webhook to the **prod** callback (or run separate apps/numbers per env).
5. A real **privacy policy page** + **real business number** + **Business Verification** for production WhatsApp (test number → 5 recipients only).

---

## What it is

A **Global** (all-industries) omnichannel inbox: CRM users see and reply to their company's messaging-app conversations (WhatsApp / Messenger / Instagram) in one 3-pane view — conversation list · chat thread + composer · contact/lead profile. Reference: Meta Business Suite / Respond.io.

Two load-bearing requirements:
1. **Robust foundation, provable today** — without waiting weeks on Meta app review.
2. **Foundationally AI-native** — built so AI agents can later read + send messages and propose draft replies for human approval, through the *same* path a human uses. v1 builds the seams, not the agent.

---

## Product decisions (confirmed with Sadin, 2026-06-11)

- **A — Data model:** NEW channel-agnostic `inbox_channels` / `conversations` / `messages` tables (mig 044). Email tables (`email_threads`/`emails`) untouched; `'email'` reserved in the provider enum so email can fold in later additively.
- **B — AI depth:** Seams only. `author_type='ai_agent'`, `status='draft'` (human-approval), `ai_metadata` JSONB, `conversations.ai_autonomy` (off/suggest/autonomous), 4 inbox tools declared in the manifest. No live model in v1.
- **C — Access:** All tenant members can view + reply; **counselors scoped** to conversations whose linked lead is assigned to them (enforced in the API layer on every endpoint incl. PATCH). Channel mutations are admin-only.
- **D — Lead linkage:** Auto-link inbound by phone single-match (`normalizePhone` trailing-10-digit); 0 or >1 matches → unlinked; human/AI "Convert to lead." Never auto-creates a lead.

---

## Architecture (what's in the code)

| Layer | Where | Notes |
|---|---|---|
| Schema | `supabase/migrations/044_unified_inbox.sql` | 3 tables, 3-policy RLS, indexes, `messages` added to `supabase_realtime` publication (guarded) |
| Adapter seam | `src/lib/inbox/adapters/{types,index,sandbox,whatsapp,messenger,instagram}.ts` | `ChannelAdapter` interface + registry; code never branches on provider name (reads capability flags) |
| Inbound | `src/app/api/webhooks/sandbox/route.ts` (+ `meta/[provider]/route.ts` shape) → `events` queue → `src/lib/inbox/process-inbound.ts` (drained by `src/app/api/internal/inbox/process/route.ts`) | Fast-ack webhook → async processor: find-or-create conversation, idempotent message insert, phone auto-link, unread bump |
| Send (AI-native core) | `src/lib/inbox/send-message.ts` | ONE `sendMessage()` for human + AI; draft-flip path; session-window guard |
| HTTP API | `src/app/(main)/api/v1/inbox/conversations/**` | list (counselor-scoped) · get · messages GET/POST · draft approve · PATCH |
| UI | `src/app/(main)/(dashboard)/inbox/page.tsx` + `src/components/dashboard/inbox/{InboxUI,ConversationList,MessageThread,ContactPanel}.tsx` | 3-pane; live via `postgres_changes` on `messages` |
| Nav | `src/components/dashboard/shell.tsx` | `MessageSquare` in `UNIVERSAL_NAV_MIDDLE` |
| AI tools (declared) | `src/app/(main)/api/v1/integrations/crm/tools/route.ts` | `list_conversations` · `get_conversation` · `send_message` · `draft_reply` |

---

## v1 = WORKING (verified live on sandbox)

Inbound message → conversation + thread → human reply sends · same sender groups into one conversation · phone dedup (no false links) · convert-to-lead creates + links · realtime list/thread updates · role scoping · AI seams present (draft/approve, `ai_agent` author, `ai_autonomy`, 4 declared tools). Both gates green (build 83 pages · eslint 0 errors).

### Opus review folded in 7 fixes (4 from code review, 3 only catchable by running it)
1. Conversations response double-wrap → `/inbox` mount crash (envelope fix).
2. PATCH allow-list missing `lead_id` → convert-to-lead never linked.
3. `ContactPanel` convert-to-lead missing required `tenant_id` in body → 422 "Failed to create lead".
4. Processor marked events `'processed'` (invalid enum, CHECK-rejected) → events stayed pending and reprocessed forever → use `'completed'`.
5. `messages` not in `supabase_realtime` publication → no live updates (added, guarded).
6. Dead `attempts: supabase.rpc` no-op line removed.
7. Counselor scoping missing on PATCH → editing could bypass viewing scope (added the ownership check).

---

## ⚠️ Required before a DEPLOYED env actually processes inbound

- **Inbound processor cron.** The webhook only *enqueues*; `POST /api/internal/inbox/process` (Bearer `INTERNAL_CRON_SECRET`) must be drained on a schedule — a **VPS root crontab line per env** (same mechanism as the dev email poll, ~every 1–2 min). Without it, queued inbound messages never appear. Locally we drained manually via the smoke tool.
  - Add to dev VPS crontab when merging to stage; add to prod VPS crontab at prod promotion.
- **Env secrets** (per env): `INBOX_SANDBOX_SECRET` (sandbox HMAC), `INTERNAL_CRON_SECRET` (processor guard). Local `.env.local` has both (added 2026-06-11). Stage/prod need them set.
- **Migration 044** is already applied to the shared Supabase DB. Stage/prod deploys are code-only.

---

## Remaining roadmap (phased)

### Phase 2 — make it operational (small, near-term)
- Inbound processor cron on dev + prod VPS (see above).
- **Notifications on inbound** — `process-inbound.ts` bumps `unread_count` but does NOT fire a bell notification. Reuse `upsertThreadNotification` (`src/lib/notifications.ts:126`, already used by `email.received`) → notify the conversation's assignee / tenant admins, with the same collapse window. Small, high-value.

### Phase 3 — first real channel (the big product step)
- **Connect-a-channel admin UI** (Settings) — today channels are DB-seeded only. Need an OAuth/credential flow + webhook setup so admins can connect a channel.
- **WhatsApp Cloud API go-live** — adapter is *built but `INBOX_WHATSAPP_ENABLED`-flagged off*. Needs: a Meta app, a WhatsApp Business number, Meta app review, webhook subscription, **per-channel access-token encryption-at-rest exercised**, and real testing of the **24h session window + template (HSM) messages** (the send-path guard is already there but only logs in v1).
- **Meta webhook route** — wire real `X-Hub-Signature-256` verification, tenant routing by `phone_number_id`, and **delivery/read status callbacks** (Meta posts statuses to the same webhook → patch `messages` by `provider_message_id`).

### Phase 4 — remaining channels
- **Messenger + Instagram** — currently interface stubs (`sendMessage` throws `NOT_IMPLEMENTED`). Each needs full implementation **+ its own Meta app review**. Handover protocol where relevant.

### Phase 5 — AI agent (the AI-native promise goes live)
- **Agent runtime** — Anthropic SDK + tool-calling loop that actually uses the 4 declared tools. "Suggest reply" button (drops a `draft` into the approval seam) → then `ai_autonomy='autonomous'` mode. Likely ties into the AI Knowledge Layer (`docs/reference/02-…`). Separate brief when picked up.

---

## Known limitations accepted for v1 (backlog, not blockers)
- Composer is **text-only** — inbound attachments are stored as JSONB but not rendered/downloaded; no image/file send, no emoji picker.
- No delivered/read ticks (arrive with Meta status callbacks in Phase 3).
- Realtime subscribes tenant-wide and filters client-side (fine at current scale; per-conversation filter later).
- `unread_count` is a read-modify-write (not atomic) — minor undercount possible under burst.
- Convert-to-lead is a two-step (create then PATCH-link), non-transactional — rare orphan lead if the link call fails.
- Counselors don't see *unlinked* conversations (no lead to check ownership against) — product choice; revisit if counselors should pick up fresh inbound directly.
- Sandbox GET handshake returns the challenge unverified if no secret is configured (POST ingestion is still HMAC-gated, so no data injection without the secret) — dev-only channel.
- No "compose new conversation" — messaging is inbound-driven by design (can't DM a stranger without templates).

---

## Dev smoke (reproducible)
1. Ensure `.env.local` has `INBOX_SANDBOX_SECRET` + `INTERNAL_CRON_SECRET`; restart `npm run dev`.
2. Sandbox channel seeded for Zunkiree Labs: `inbox_channels.id = b0000000-0000-4000-8000-000000000001` (provider `sandbox`, active).
3. Inject + drain: `node scripts/inbox-sandbox-send.mjs "message" [fromId] [phone] [name]` → conversation appears live in `/inbox`; click → reply.
4. Cleanup: `DELETE FROM inbox_channels WHERE id='b0000000-0000-4000-8000-000000000001';` (cascades to its conversations + messages).

## Branch / process
`feature/unified-inbox`: `4f2b56b` (Sonnet foundation, 21 deliverables) → `e7dada2` (6 fixes + smoke tool) → `fb72713` (counselor PATCH lock). Both gates green. **Not pushed.** Next: merge → `stage` (code-only; auto-deploys dev) on Sadin's GO + add the dev cron line; prod a separate explicit GO later.
