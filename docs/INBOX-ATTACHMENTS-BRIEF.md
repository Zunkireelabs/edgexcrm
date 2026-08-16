# BRIEF — Inbox attachments (WhatsApp media, inbound + outbound)

**For:** Sonnet executor session
**From:** Opus planning session, 2026-08-16
**Parent plan:** `docs/WHATSAPP-ADMIZZ-PHASE0-BRIEF.md` (this is D2/D3, split out as its own PR)
**Prerequisite:** none — independent of the branch-scope PR (`docs/INBOX-BRANCH-SCOPE-BRIEF.md`).
Branch from latest `origin/stage`. If the scope PR has landed by then, rebase onto it.
**Stop at the PR.** No merge, no flag flips, no prod writes.

---

## 1. Why this matters, and why it's bigger than it looks

Admizz is a study-abroad consultancy: the day-to-day work is passport scans, transcripts, offer
letters, fee receipts. A WhatsApp channel that silently drops every file a student sends is not a
partially-useful feature — it loses documents the counselor is actively waiting for, with no error
shown to anyone.

**The current state is not "stored but unrendered" — nothing is captured at all.**
`whatsappAdapter.parseInboundEvent` (`src/lib/inbox/adapters/whatsapp.ts:118-129`) hardcodes
`attachments: []` for every message and only ever reads `msg.text?.body`. The `WAMessage` type
doesn't even model `image` / `document` / `audio`. The `messages.attachments JSONB` column exists
(migration 044) but has been `[]` on every row ever written.
`MessageThread.tsx` reads only `content_text` — there is no render path either.

So a student's passport scan today: arrives at the webhook → parsed to a message with null text and
no attachment → stored → renders as an empty bubble. **Silent data loss.**

---

## 2. The WhatsApp media flow — this is the part people get wrong

Meta does **not** send media inline or as a fetchable URL. Inbound media arrives as an **ID only**:

```jsonc
{ "type": "image",
  "image": { "id": "1234567890", "mime_type": "image/jpeg", "sha256": "…", "caption": "my passport" } }
```

Retrieving the bytes is **two authenticated calls**, both requiring the channel's access token:

1. `GET https://graph.facebook.com/v19.0/<MEDIA_ID>` → returns a short-lived `url` (plus
   `mime_type`, `file_size`, `sha256`).
2. `GET <that url>` **with the `Authorization: Bearer <token>` header** — the URL alone is not
   enough, and it expires in ~5 minutes.

**Consequences you must design for:**
- The media must be fetched and persisted **during inbound processing** — we cannot store the URL
  and resolve it lazily at render time; it will be dead. Fetch once, store our own copy.
- The channel's access token is **encrypted at rest**; decrypt via `src/lib/inbox/crypto.ts` the
  same way `send-message.ts` already does before calling the adapter.
- Media fetch is the one step here that does real network I/O against a third party and can fail
  independently of the message itself — see §5 on failure handling.

Message types to handle: `image`, `document`, `audio`, `video`, `sticker`. A `caption` (when
present) is the message's text — map it to `content_text` so a captioned photo isn't a blank bubble.

---

## 3. Storage — a NEW PRIVATE bucket. Do not use `lead-documents`.

**`lead-documents` is a public bucket** (`storage.buckets.public = true`, verified on both prod and
stage 2026-08-16) and several call sites serve from it with `getPublicUrl()`. Putting inbound
WhatsApp media there would publish **student passport scans and transcripts to anyone with the
URL**, permanently and without auth. That is the single most important constraint in this brief.

Create a new **private** bucket `inbox-media`, modeled on `knowledge-base-files` (private,
`file_size_limit` set):

Bucket creation is **not** a migration — it's a per-environment step, and each environment has a
different mechanism. Do not conflate them:

- **Local — put it in `supabase/seed.sql`, do not hand-create it.** That file already creates the
  three existing buckets (`supabase/seed.sql:50-56`) precisely so every dev gets them
  reproducibly. Add `('inbox-media', 'inbox-media', false)` to that `INSERT … ON CONFLICT DO
  NOTHING` block. **Note the `false`** — `lead-documents` is the one seeded as `true` (public),
  which is exactly the trap this brief exists to avoid; copy the `knowledge-base-files` line, not
  the one above it. A hand-created local bucket is invisible to the next dev and to CI.
- **Stage — hand-applied, and announce it first.** Stage is a **shared environment**; the SOP
  (§8) requires announcing an out-of-band change to a shared DB before you make it, for the same
  reason it requires announcing a migration. One line in the team channel, then apply. If you do
  not have stage credentials, say so in your report and stop — **do not** work around it by
  testing only on local, because the Meta webhook points at stage and real-device verification
  (§7) cannot happen anywhere else.
- **Prod — not in this PR.** Created at promotion time under Sadin's explicit per-action approval.
- **Record the exact SQL you ran** in the PR description, so stage and prod are provably identical
  rather than two hand-made buckets that happen to share a name.

**Limits — set them explicitly; `seed.sql` currently sets none.** The real buckets carry
`file_size_limit` (`knowledge-base-files` 30 MB, `employee-photos` 5 MB) while the seeded local
copies do not, so local silently accepts files stage would reject. Set `file_size_limit` to 20 MB
on `inbox-media` **in every environment including local** (WhatsApp's own document cap is 100 MB;
we should not ingest 100 MB blobs on a whim). Reject above the cap with a clear error — never
silently truncate. **No public read policy — none, ever.**
- **Paths must be tenant-prefixed.** The storage seam is explicit that storage is not RLS'd the way
  tables are and that "callers stay responsible for passing tenant-prefixed paths"
  (`src/lib/storage/provider.ts:9-11`). Use `<tenant_id>/inbox/<conversation_id>/<message_id>-<n>.<ext>`
  or similar. A path that doesn't start with the tenant id is a cross-tenant bug waiting to happen.

### 3a. The storage seam needs a write method — add it properly

`src/lib/storage/provider.ts` defines `StorageProvider` with `createSignedUploadUrl`,
`getSignedDownloadUrl`, `getBytes`, `remove`. There is **no server-side write** — every existing
upload path goes through a *browser* signed-URL upload, which is useless here because the bytes
originate on our server (fetched from Meta), not in a user's browser.

Add `putBytes(bucket, path, bytes, contentType): Promise<void>` to the interface and implement it
in `SupabaseStorageProvider`. This is a **shared file** — keep the change additive, keep the
existing methods untouched, and extend `provider.test.ts` rather than rewriting it. Do not bypass
the seam with a direct `supabase.storage` call; the whole point of the seam is that the future R2
swap touches one file.

### 3b. Serving media back to the browser

Reads go through `getSignedDownloadUrl` (short-lived), **never** `getPublicUrl`. Note
`roundExpiryToHour` already rounds expiries to the hour so repeat requests are cache-stable — use
the helper's default behavior rather than inventing an expiry.

Access must be **scoped exactly like the conversation it belongs to.** A signed URL minted for a
message the caller cannot see is a scoping bypass. If `docs/INBOX-BRANCH-SCOPE-BRIEF.md` has
landed, reuse the helper it introduces (`src/lib/inbox/scope.ts`); if it hasn't, mirror the same
check and leave a comment pointing at it so the two get unified.

### 3c. Explicitly NOT in this PR: "save to lead documents"

The obvious follow-up — one-click filing a WhatsApp attachment onto the lead's record — is
deliberately deferred, because there is currently **no lead-documents feature to file into**: no
`lead_documents` table, no per-lead document view, and the only bucket named for it is the public
one we're avoiding. Building that properly means designing a private lead-document store first.
Log it as a follow-up; do not improvise it here.

---

## 4. Deliverables

### D1 — Adapter captures media (`src/lib/inbox/adapters/whatsapp.ts`)
Extend the `WAMessage` type to model `image` / `document` / `audio` / `video` / `sticker`. In
`parseInboundEvent`, emit a typed attachment descriptor (media id, mime, filename, caption) into
`attachments` instead of `[]`, and map `caption` → `contentText`. **Parsing stays pure** — no
network calls in the adapter; it only describes what arrived.

### D2 — Resolve + persist during inbound processing (`src/lib/inbox/process-inbound.ts`)
For each attachment descriptor: decrypt the channel token → resolve the media id → download with
the bearer header → `putBytes` into `inbox-media` under a tenant-prefixed path → write the final
shape into `messages.attachments`:

```jsonc
[{ "type":"image", "bucket":"inbox-media", "path":"<tenant>/inbox/…", "filename":"passport.jpg",
   "mime_type":"image/jpeg", "size": 84213, "provider_media_id":"1234567890" }]
```

Store our own `path`, never a Meta URL (they expire). Enforce the size cap before download where
`file_size` is available, and after where it isn't.

### D3 — Render inbound (`src/components/dashboard/inbox/MessageThread.tsx`)
Images render as an inline preview (click to open full size); everything else renders as a
filename + type + size with a download action. Both fetch their signed URL on demand from a new
scoped endpoint — do not embed signed URLs in the server-rendered payload, where they'd leak into
the page source and outlive the view.

### D4 — Outbound send (composer + `send-message.ts` + adapter)
File picker in the composer. Outbound is the mirror image of inbound: **upload the bytes to Meta
first** (`POST /<PHONE_NUMBER_ID>/media`, multipart, returns a media id), then send a message
referencing that id. Store our own copy in `inbox-media` too, so the thread renders consistently
and history survives Meta's retention.

The existing **24h session-window guard is unchanged** — do not touch that logic. Media sends are
subject to it exactly like text sends; verify a media send outside the window still fails cleanly
with `OUTSIDE_SESSION_WINDOW` and leaves no stuck `queued` row.

---

## 5. Failure handling — do not let a media failure eat the message

Media fetch is third-party network I/O inside the inbound path. If it throws and the whole event
fails, the queue retries and the **text of the message is lost or duplicated** for a reason that
has nothing to do with the message.

Required behavior: **persist the message first, attach media best-effort.** A failed media fetch
records the attachment with an error marker (so the UI can show "attachment failed" rather than
nothing) and leaves the message itself intact and `completed`. Never swallow the error silently —
log it with the conversation and provider media id. Note the existing processor marks events
`'completed'` (not `'processed'` — that was a real bug fixed in the June review); don't regress it.

---

## 6. Out of scope
- Template / HSM support, "compose new conversation" — later phase.
- Any AI/agent wiring.
- "Save to lead documents" (§3c).
- Phase 3b near-instant inbound.
- Messenger / Instagram adapters — but **keep everything provider-agnostic**; media is a
  capability, not a WhatsApp-ism. Do not put WhatsApp-shaped assumptions in shared code.
- No migration. `messages.attachments` already exists. If you think you need a schema change, stop
  and say so in your report rather than writing one.

---

## 7. Verification

Stage is a **fully working WhatsApp environment today** — env vars set, Meta webhook pointed at
`dev-lead-crm`, test-number channel live in the stage DB, and Sadin's own number is a verified
recipient. So this is verifiable end-to-end with a real phone; do not settle for mocked payloads.

1. `npm run build`, `npx eslint --max-warnings 50`, `npm run test` — all green.
2. **Real device, inbound:** send from a verified phone to the test number — a photo, a PDF, and a
   photo *with a caption*. All three appear in `/inbox`: image inline, PDF as a downloadable file,
   caption rendered as the message text (not a blank bubble).
3. **Storage check (psql):** objects land in `inbox-media`, paths are tenant-prefixed, and
   `messages.attachments` holds the documented shape with a real `path` (not a Meta URL).
4. **Privacy check — the one that matters most:** confirm `inbox-media` is **private**, and that a
   raw object URL without a signature returns 403/401. Confirm nothing was written to
   `lead-documents`.
5. **Scoping:** a user who cannot see the conversation cannot mint a signed URL for its attachments
   (403), and signed URLs are not present in server-rendered HTML.
6. **Real device, outbound:** send an image and a PDF from the composer — both arrive on the phone
   and render correctly in our thread.
7. **Failure path:** simulate a media-resolve failure (bad token or unreachable Graph host) and
   confirm the message still persists with an error-marked attachment, the event completes, and the
   error is logged — no lost text, no infinite retry.
8. **Regression:** text-only messages behave exactly as before; the 24h guard still fires.

---

## 8. Report back
What you built, the §7 results (especially 4 and 7), and anything here that proved wrong in
practice — particularly the Graph API media shapes in §2, which are written from the documented
contract and should be corrected against what the live test number actually returns.

---

## SONNET HANDOFF PROMPT

> Build **inbox attachments (WhatsApp media, inbound + outbound)** per `docs/INBOX-ATTACHMENTS-BRIEF.md`. Branch from latest `origin/stage`.
>
> **The gap:** `whatsappAdapter.parseInboundEvent` (`src/lib/inbox/adapters/whatsapp.ts:118`) hardcodes `attachments: []` and only reads `msg.text?.body` — inbound media is **not captured at all**, so student passport scans and transcripts are silently lost. `MessageThread.tsx` reads only `content_text`; there's no render path either. `messages.attachments JSONB` exists (mig 044) and has been empty on every row ever written.
>
> **Key mechanic:** Meta sends a media **ID**, not a URL. Getting bytes = `GET /v19.0/<MEDIA_ID>` → short-lived url → `GET <url>` **with the bearer token**, expiring in ~5 min. So media must be fetched and persisted during inbound processing (`process-inbound.ts`), never resolved lazily at render. Decrypt the channel token via `src/lib/inbox/crypto.ts` as `send-message.ts` already does.
>
> **Storage — the critical constraint:** do **NOT** use the `lead-documents` bucket. It is **public** (verified on prod + stage), and putting passport scans there would publish student PII to anyone with the URL. Create a new **private** `inbox-media` bucket modeled on `knowledge-base-files`, 20 MB `file_size_limit`, never a public read policy. Not a migration — per-environment, and each environment differs: **local goes in `supabase/seed.sql`** (add to the existing bucket block at :50-56 with `public = false` — copy the `knowledge-base-files` line, NOT the `lead-documents` one, which is seeded public); **stage is hand-applied and must be announced first** (shared environment, SOP §8) — if you lack stage credentials, say so and stop rather than testing only on local, since the Meta webhook points at stage and real-device verification can't happen elsewhere; **prod is not in this PR.** Record the exact SQL in the PR description. Paths must be tenant-prefixed. Serve only via `getSignedDownloadUrl`, never `getPublicUrl`, and scope signed-URL minting exactly like the conversation itself.
>
> `src/lib/storage/provider.ts` has no server-side write — add `putBytes()` to the `StorageProvider` interface + `SupabaseStorageProvider` (additive only; it's a shared file; extend `provider.test.ts`). Don't bypass the seam with a direct `supabase.storage` call.
>
> **Deliverables:** adapter captures typed media descriptors + maps `caption`→`contentText` (parsing stays pure, no network in the adapter); processor resolves/downloads/stores and writes the real attachments shape; MessageThread renders images inline and files as download links via on-demand signed URLs; composer file-picker for outbound (upload to Meta first for a media id, store our own copy too). The 24h window guard is unchanged — media sends respect it exactly like text.
>
> **Failure handling:** persist the message FIRST, attach media best-effort. A failed media fetch must not lose or duplicate the message text — record an error-marked attachment, complete the event, log it. Don't regress the `'completed'` event status.
>
> **Do NOT** build templates, "compose new conversation", "save to lead documents", Phase 3b, or any AI wiring. No migration. Keep it provider-agnostic — media is a capability, not a WhatsApp-ism.
>
> **Verify with a real phone, not mocks** — stage is a live WhatsApp env (env vars set, webhook on dev-lead-crm, test channel in the stage DB, Sadin's number verified). Run the full §7 matrix, especially #4 (prove `inbox-media` is private and a raw unsigned URL 403s, and that nothing landed in `lead-documents`) and #7 (media-failure path). Commit trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Then STOP and summarize for review — no merge, no prod writes.
