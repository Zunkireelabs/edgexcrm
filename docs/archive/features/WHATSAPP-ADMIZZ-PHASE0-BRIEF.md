# WhatsApp Go-Live for Admizz — Phase 0 Brief (reply-only pilot)

> Phase 0 of the WhatsApp-for-education-consultancy rollout. Parent feature: `docs/UNIFIED-INBOX-BRIEF.md` (the omnichannel inbox this rides on — already shipped to `main`). This brief covers ONLY Phase 0: get Admizz talking on WhatsApp for real, reply-only, piloted on one branch first. Templates (agency-initiated outreach) are Phase 1+, NOT in this brief. AI-agent integration (drafting via the Follow-up Drafter pattern) is Phase 3+, NOT in this brief.

**Status: planning only — no code, no repo changes yet.** Written 2026-08-16 after a status audit of the live boxes + DB (see the session context below). Stop-at-review per the project's Opus/Sonnet split — do not push, PR, or touch prod without an explicit GO.

---

## Where we actually stand (verified against the running system, not just docs)

- **Unified Inbox is fully built and live on `main`** — Global feature, no industry gate, Admizz already has the `/inbox` nav item today.
- **WhatsApp is code-complete but config-dark on prod.** `INBOX_WHATSAPP_ENABLED`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN` are set on stage, **missing on prod** (`INBOX_TOKEN_ENC_KEY` is already on prod). The adapter treats `INBOX_WHATSAPP_ENABLED` as a hard master switch — every method (verify, parse, send) no-ops or throws without it.
- **The only channel that exists anywhere is a dead Meta test number** (`1143343632197234`, capped at 5 recipients) connected to the internal Zunkiree Labs tenant, last activity 2026-06-11. Both stage and prod DBs have the identical row — a leftover from before the 2026-06-21 DB split. **Never connected to Admizz or any real customer.**
- **Meta's webhook is registered only against `dev-lead-crm`'s callback URL** — prod isn't pointed at anything in Meta regardless of env vars.
- **Inbound drain is now `ops-inbox-process`, an Inngest cron at `*/10 min`**, running on both stage and prod since 2026-07-21 (replaced the old dev-only `*/1 min` VPS cron). No code change needed for this — it already covers prod.
- **`/privacy` page already exists and is publicly reachable** — one of the two production-WhatsApp prerequisites is done.
- **Attachments are not functional.** The WhatsApp adapter's `parseInboundEvent` hardcodes `attachments: []` — it doesn't even capture the Meta media ID today, let alone download or render one. `messages.attachments JSONB` column exists (migration 044) but is unused.
- **Branch-manager scoping is missing from the inbox API**, and it's a real, current gap (not hypothetical): every one of the 4 conversation routes hand-rolls the same narrow check —
  ```ts
  if (auth.role === "counselor") { /* filter to their assigned leads */ }
  ```
  — in `conversations/route.ts` (list), `conversations/[id]/route.ts` (get/patch), `conversations/[id]/messages/route.ts`, and `conversations/[id]/draft/route.ts`. None of them use `leadQueryScope()` from `src/lib/api/permissions.ts`, which is the shared primitive every other lead-touching route already uses (`/leads`, `/lead-lists`, `/applications`, `/classes`, `/pipeline`, `/dashboard`, `/insights`, `/check-in`) to resolve `own` / `team` (branch) / `all` visibility correctly. A branch manager today would see **every** Admizz conversation tenant-wide, not just their branch's.

---

## Decisions locked for Phase 0

- **Reply-only.** No outbound-first contact. WhatsApp's own rule: free-form replies only work within 24h of the lead's last inbound message. Templates (the only legal way to message first) are Phase 1, not here.
- **One branch pilot first**, then tenant-wide once clean. This is an **operational** decision (which branch's leads/counselors get the real number first), not a code gate — Phase 0 ships the same code to everyone; the pilot is about rollout sequencing, not a feature flag. Document which branch is the pilot before go-live.
- **No migration needed.** `messages.attachments` already exists as a JSONB column; the branch-scoping fix is pure query logic reusing existing helpers. Zero new `supabase/migrations/` files in this phase.
- **No template work, no AI-agent work.** Explicitly out of scope — see the parent plan's Phase 1/3.

---

## Track A — Meta / ops setup (Sadin, parallel with Track B, starts now)

Meta Business Verification takes real calendar time — start this immediately, don't wait on code.

1. Real Admizz WhatsApp Business number + Meta Business Verification (the test number stays capped at 5 recipients — unusable for a real pilot).
2. Set the 3 missing env vars on **prod**: `INBOX_WHATSAPP_ENABLED=true`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN` (System User token is account-scoped, can reuse the same one already proven on stage — but recommend generating a fresh one scoped to Admizz's real number once it exists).
3. Point Meta's webhook (or a separate app/number setup, if we want prod fully isolated from the dev/test app) at prod's callback: `https://edgex.zunkireelabs.com/api/webhooks/meta/whatsapp`.
4. Connect Admizz's real number via **Settings → Channels** (UI already built, no code needed) — as an Admizz admin, paste `phone_number_id` + access token + display name.
5. Decide + document the pilot branch (KTM / Birgunj / Janakpur) before flipping this on for real leads.

---

## Track B — code deliverables (Sonnet)

### D1. Fix branch-manager scoping across the 4 inbox conversation routes
**Problem:** hand-rolled `role === "counselor"` checks, duplicated 4x, don't handle `leadScope: "team"` (branch manager) at all — they fall through to unscoped tenant-wide.

**Fix, modeled on the pattern already used everywhere else in the app:**
- Extract a single shared helper (new file, e.g. `src/lib/inbox/scope.ts`) that takes `auth: AuthContext` and returns the set of `lead_id`s the caller may see conversations for — built on `leadQueryScope(auth.permissions, auth.userId, auth.branchId)` from `src/lib/api/permissions.ts`, the same primitive `src/app/(main)/api/v1/leads/route.ts` already uses. Reuse `getLeads()` (`src/lib/supabase/queries.ts`) or the narrower `leadIdsForBranch()` / `sharedBranchLeadIdsForAssignee()` (`src/lib/leads/branch-membership.ts`) — pick whichever gives an id-only result cheaply; don't hand-roll new branch logic.
- Swap all 4 routes' `if (auth.role === "counselor") {...}` blocks to call this one helper instead, so `own` (counselor), `team` (branch manager), and `all` (owner/admin) all resolve correctly and identically across list/get/patch/messages/draft — closing the exact class of "list shows it, detail 404s" bug the leads routes explicitly guard against.
- Test: as a branch manager, `/inbox` shows only conversations for leads in their branch; as owner/admin, unchanged (all); as counselor, unchanged (own only, same as today).

### D2. Inbound attachments — capture, store, render
- WhatsApp adapter (`src/lib/inbox/adapters/whatsapp.ts`): stop hardcoding `attachments: []`. Parse the Meta payload's media object (image/document/audio — WhatsApp sends a **media ID**, not a URL) and carry it through `parseInboundEvent`.
- Media download: WhatsApp media requires a separate authenticated Graph API call (media ID → temporary URL → download) — this doesn't arrive inline on the webhook. Fetch it server-side during inbound processing (`src/lib/inbox/process-inbound.ts`), then store it. Reuse the existing signed-URL upload primitive at `src/app/(main)/api/v1/upload/route.ts` rather than building new storage plumbing (the KB/lead-documents storage consolidation, per `docs/reference/02-ARCHITECTURE-AI-KNOWLEDGE-LAYER.md` Phase 1, isn't built yet — don't wait on it, don't duplicate it either; use the existing upload route as-is).
- Persist real shape into `messages.attachments` JSONB — e.g. `[{type, url, filename, mime_type, size}]` — replacing the current always-empty array.
- UI: `src/components/dashboard/inbox/MessageThread.tsx` — render an image preview inline, a generic filename + download link for other types.

### D3. Outbound attachments — send a file from the composer
- Composer gets a file-picker affordance (mirrors what's already there for text).
- Upload the file, then send via Meta's Graph API media-message flow (upload media to Meta first to get a media ID, then reference it in the send call) — `src/lib/inbox/send-message.ts` / `adapters/whatsapp.ts`.
- Still subject to the existing 24h-window guard — no change to that logic.

### D4. Cleanup (small, do alongside D1–D3)
- Once Admizz's real channel exists, the stale Zunkiree-Labs test-number channel/conversation shouldn't be deleted (different tenant, harmless) but flag it in the PR so nobody mistakes it for real Admizz traffic during smoke testing.

---

## Explicitly out of scope for Phase 0
- Template/HSM support, template composer, Meta template submission — Phase 1.
- "Compose new conversation" (starting a thread with someone who hasn't messaged in) — blocked by WhatsApp's own rules until Phase 1 templates exist.
- Any AI/agent involvement (draft-assist, propose-and-approve) — Phase 3, and when it lands it should extend the existing Follow-up Drafter / agent-spine pattern (`src/industries/education-consultancy/ai/agents/follow-up-drafter.ts`), not reintroduce the old dead "AI seam" from the June integrations manifest.
- Near-instant inbound (Phase 3b, ~1-2s) — current `*/10 min` Inngest drain is fine for a reply-only pilot.
- Per-branch WhatsApp numbers — one number per tenant stays correct architecture.

---

## Verification (before calling Phase 0 done)
1. `npm run build` clean, `npx eslint --max-warnings 50` clean, `npm run test` green.
2. As a branch manager: `/inbox` list, single-conversation GET, messages, and draft endpoints all correctly scope to their branch only — verify with a conversation belonging to a different branch (should 404/empty, not leak).
3. As a counselor: unchanged behavior (regression check).
4. As owner/admin: unchanged (sees everything).
5. Real device test: message the real Admizz number from a personal WhatsApp → appears in `/inbox` within ~10 min → reply → arrives on the phone.
6. Send an image and a document from a real phone to the Admizz number → both render/download correctly in the thread.
7. Send an image/file from the composer → arrives correctly on the real phone.
8. Confirm the >24h guard still fires correctly (`OUTSIDE_SESSION_WINDOW`, no stuck `queued` row) — no regression from the attachment work.
9. Tenant isolation: a second tenant cannot see Admizz's channel or conversations.

---

## SONNET HANDOFF PROMPT
> Build **Phase 0 of the WhatsApp-for-Admizz rollout** per `docs/WHATSAPP-ADMIZZ-PHASE0-BRIEF.md`, on a branch off `stage`. Two deliverables:
>
> **D1 — branch-manager scoping fix**: the 4 inbox conversation routes (`src/app/(main)/api/v1/inbox/conversations/route.ts`, `[id]/route.ts`, `[id]/messages/route.ts`, `[id]/draft/route.ts`) each hand-roll a `role === "counselor"` check with no branch-manager (`leadScope:"team"`) handling. Extract one shared helper that resolves visible lead IDs via `leadQueryScope()` (`src/lib/api/permissions.ts`) the same way `src/app/(main)/api/v1/leads/route.ts` already does, and use it in all 4 routes. No migration needed.
>
> **D2/D3 — WhatsApp attachments (inbound + outbound)**: the WhatsApp adapter (`src/lib/inbox/adapters/whatsapp.ts`) hardcodes `attachments: []` on inbound — fix `parseInboundEvent` to capture the Meta media ID, download it via a Graph API call during `process-inbound.ts`, store it via the existing `/api/v1/upload` signed-URL route (don't build new storage plumbing), and persist real `[{type,url,filename,mime_type,size}]` shape into `messages.attachments` (column already exists, mig 044). Render inline (image preview / file+download link) in `src/components/dashboard/inbox/MessageThread.tsx`. Add a composer file-picker for outbound send, uploading to Meta first to get a media ID before sending (`send-message.ts`). The existing 24h-window guard is unchanged — don't touch that logic, just make sure attachment sends still respect it.
>
> Do NOT build template/HSM support, a "compose new conversation" flow, or any AI/agent wiring — those are later phases, explicitly out of scope here. Verify per the brief's Verification section (build + eslint + test all green, branch-manager/counselor/owner scoping matrix, real-device attachment round-trip if a test number is available, 24h-guard regression check). No migration file needed. Commit trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Then STOP and summarize for review — no push, no PR, no prod/env changes (Track A's env vars and channel connection are Sadin's ops actions, not this branch's job).
