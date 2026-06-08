# Email feature — Phase 3 (inbound polling + thread display + reply-from-CRM)

> Phase 3 of the 4-phase Email feature plan. Closes the loop on the inbox: makes the system bi-directional. Phase 2 sent → recipient received → end of story. Phase 3 picks the story back up: recipient replies → reply lands in CRM within ~5 min → counselor sees the reply in the lead's Emails sub-tab → counselor clicks Reply → composes from CRM → recipient sees the reply continue the Gmail thread. After Phase 3, the connected Gmail is a real CRM inbox, not a one-way send pipe.
>
> Phase 1 verified live on dev 2026-05-31 evening (`c9db7c2`); Phase 2 shipped to stage same day (`977fc44`, smoke verified). Full 4-phase plan: `~/.claude/plans/today-what-feature-i-wobbly-russell.md`. Phase 3 is the biggest single increment — three coupled capabilities in one phase because none of them stand alone usefully.

---

## Goal

Counselor sends email from CRM (Phase 2 already does this) → recipient replies → reply arrives in the counselor's connected Gmail → polling worker picks it up within 5 min → matches it to the original CRM thread via Gmail `threadId` (primary) or RFC `In-Reply-To`/`References` (fallback) → persists as inbound `emails` row → emits `email.received` event → counselor sees it on the lead's Emails sub-tab as part of the same thread. Counselor clicks Reply → composes (empty body, pre-filled To + "Re: ..." subject) → sends → reply continues the Gmail thread (recipient's email client groups it correctly) → new outbound `emails` row on the same thread.

### Vertical slice
> Admizz counselor opens lead → Emails sub-tab → sees a thread with one sent message ✉ → recipient replies from their Gmail → ~5 min later counselor refreshes (or navigates back) → thread now shows the inbound reply ⬅ in the same `<EmailThreadCard>` → counselor clicks "Reply" on the thread → `<ComposeEmailDialog>` opens with From locked to the thread's account, To pre-filled with the reply sender, subject "Re: ..." → counselor writes a fresh body → Send → recipient receives the reply in the same Gmail thread → CRM thread grows by one outbound message.

Phase 3 closes when this end-to-end loop runs cleanly on dev for an Admizz counselor with a real test recipient (e.g. `<your-test-email>`).

---

## CRM-expert design framing (locked in pre-write — do not re-litigate)

1. **Three capabilities ship together.** Inbound polling without thread display + reply UI is a black-box backend with no user surface. Thread display without polling has nothing inbound to show. Reply-from-CRM without thread display has nowhere to put the Reply button. They're tightly coupled; ship all three or wait.

2. **Only persist matched inbound.** Connected Gmail receives the counselor's whole personal inbox; we DO NOT want to suck all of it into CRM (privacy + storage + noise). Inbound persists only when it matches a known `email_threads` row via Gmail `threadId` (primary) or RFC `In-Reply-To`/`References` (fallback). Unmatched inbound is silently dropped. "Cold inbound" (someone emails the counselor without ever filling a form first) won't surface — acceptable for v1; Admizz's actual workflow is form-first. Phase 4 could add an "attribute orphan email to lead" UI if demand surfaces.

3. **Thread display, not flat list.** Phase 2's Emails sub-tab is a flat list of single messages. Phase 3 evolves to grouped-by-thread: subject + participants + last_message_at + message_count header; expand to see individual messages oldest→newest with inbound/outbound visually distinct; Reply button at the bottom of the expanded thread.

4. **Empty body on reply (no quoted block).** Gmail-style quoted blocks are real engineering work (HTML serialization, `...` collapse, deep-thread edge cases). The CRM thread display already shows the original above. The recipient's email client groups messages via `In-Reply-To` + `References` headers so they see thread context too. Skip the quoted block for v1; complexity defer to Phase 4+ if real complaints surface.

5. **Reply must use the same `from_account_id` as the thread.** A counselor with two connected inboxes can't reply to a thread on inbox A from inbox B — the recipient would see a different sender; Gmail wouldn't thread it correctly; CRM would have a thread spanning two accounts. Server validates; client locks the From picker to the thread's account when in reply mode.

---

## Decisions locked in (from pre-write discussion 2026-05-31 night)

| # | Decision | Rationale |
|---|---|---|
| 1 | **Cron lives in GitHub Actions** (not Supabase Edge Function / pg_cron) | Visible in repo, easy to disable/inspect, no new deploy surface, ~8.6k invocations/month within free quota |
| 2 | **Polling cadence: every 5 min** | Counselor workflow is deliberate, not chat; 5-min latency is fine; cuts API volume 60% vs 2-min |
| 3 | **Only persist matched inbound** | Privacy + storage + noise; orphan attribution is a Phase 4 maybe |
| 4 | **Match strategy: Gmail `threadId` primary → RFC `In-Reply-To` fallback → `References` chain fallback** | threadId is exact for Gmail-to-Gmail; In-Reply-To is vendor-independent for future Outlook swap |
| 5 | **Reply body: empty (no quoted block)** | Complexity defer; thread display + RFC headers cover context |
| 6 | **Polling endpoint at `/api/internal/email/poll`** (NOT `/api/v1/`) | Internal surface; bearer-auth via env var; not part of public API contract |
| 7 | **`sender_user_id` stays NULL on inbound rows** | Sender is not a CRM user. Counselor scoping changes to query by `connected_email_accounts.user_id` (covers both directions) |
| 8 | **No schema changes** | Phase 1's mig 025 already has `direction='inbound'`, `received_at`, `in_reply_to`, `rfc_references[]`. `email_sync_state` ready. `email_threads` increments naturally. Phase 3 is pure code |
| 9 | **GH Actions workflow polls dev only** | Prod added as part of the prod-promotion bundle, separate cron file or matrix |
| 10 | **Per-account error isolation in polling loop** | One account's OAuth-revoked failure shouldn't block other accounts' polls |
| 11 | **History API gap: bootstrap on 404** | If `last_history_id` is too old (>7 days, Gmail's retention), set new baseline from `getProfile().historyId`, skip the gap (messages lost during the gap won't be matched) |
| 12 | **Concurrency: 5 accounts in flight at a time** | `Promise.allSettled` over chunks; per-account errors don't fail the batch |

---

## Scope

### In scope (Phase 3)

1. **`gmail-client.ts` evolution** — 3 new functions: `listHistory()`, `getMessage()`, and full `sendMessage()` extension (wire up the previously-unused `threadId` / `inReplyTo` / `references` params).
2. **`POST /api/internal/email/poll`** — new endpoint. Bearer-auth via `INTERNAL_CRON_SECRET` env var. Iterates connected accounts, polls Gmail per-account, persists matched inbound, updates `email_sync_state`, emits `email.received` events.
3. **`POST /api/v1/email/send` extension** — accepts optional `reply_context: { thread_id, in_reply_to, references[] }`. When present: validates thread ownership + same-account constraint; reuses thread instead of creating new; passes reply headers to `sendMessage`; updates `email_threads.message_count` + `last_message_at`.
4. **`GET /api/v1/email/threads` rewrite** — returns threads grouped (PostgREST embed: `email_threads(*, emails(*))` or `emails(*, email_threads!inner(...))` grouped client-side — see Architecture for the call). Counselor scoping changes from `sender_user_id` to `connected_email_accounts.user_id` (covers inbound). Returns both directions now.
5. **`<EmailThreadCard>`** — new component replacing Phase 2's `<SentEmailCard>`. Collapsible thread header (subject + participants + count badge + last activity time); expanded view shows messages oldest→newest with inbound/outbound visual distinction; Reply button at the bottom (or top of expanded view).
6. **`<ComposeEmailDialog>` extension** — accepts optional `replyContext` prop. When provided: From picker locked to the thread's account; To pre-filled from the message-being-replied-to; subject pre-filled "Re: ..."; body empty; passes reply_context through on submit.
7. **`useEmailThreads(leadId)` hook** — replaces `useSentEmails`. Returns `{ threads: EmailThread[], loading, refresh, setThreads }` where `EmailThread = { ...thread_row, messages: Email[] }`.
8. **`ActivitiesPanel` Emails sub-tab evolution** — renders `<EmailThreadCard>` per thread instead of `<SentEmailCard>` per message. Optimistic prepend still works (on send: prepend new thread OR find-and-update existing thread).
9. **GitHub Actions cron workflow** — `.github/workflows/email-poll.yml` — 5-min cron, POSTs to dev's `/api/internal/email/poll` with bearer auth.
10. **`emitEvent('email.received', ...)`** — fired by the polling worker for each new inbound; payload mirrors `email.sent` shape (thread_id, lead_id, contact_id, from_email, subject, email_id, received_at).
11. **`INTERNAL_CRON_SECRET` env var** — added to `.env.local` template and the prod-rollout STATUS-BOARD checklist alongside the existing `GOOGLE_*` vars.

### Out of scope (defer to Phase 4)

- **Contact-detail Email tab** — mirror of the lead-detail Email sub-tab on `/contacts/[id]` (education_consultancy view).
- **Account 360 activity feed integration** — surface `email.sent` / `email.received` events in the Account 360 Activity tab.
- **Subject search** on the Emails sub-tab.
- **Unread badges** — would need a `read_at` column on emails + UI to mark-as-read. Defer.
- **Parent CC merge field** for education leads (auto-CC parent's email if present on lead).
- **Attachments** — Gmail API supports via multipart MIME but adds upload pipeline complexity. Defer.
- **Quoted-block on reply body** — see decision 5.
- **Orphan inbound attribution UI** — see decision 3.
- **Push notifications via Gmail watch + Pub/Sub** — replaces polling with near-real-time delivery; only justifies infra investment past ~50 connected accounts.
- **Send-later / scheduling**, **templates**, **open/click tracking pixels** — all deferred indefinitely (v2+ surface).

---

## Architecture

### Zero schema changes

Phase 1's `025_email_send_foundation.sql` already created everything Phase 3 needs:

- **`emails`**: `direction CHECK ('outbound', 'inbound')` — inbound is a valid value. `received_at TIMESTAMPTZ` — populated on inbound. `in_reply_to TEXT` — populated on inbound from the RFC header. `rfc_references TEXT[]` — populated on inbound from the RFC References header. `sender_user_id UUID NULL` — stays NULL on inbound (sender is not a CRM user).
- **`email_threads`**: `message_count` increments. `last_message_at` updates. `gmail_thread_id` used for primary matching.
- **`email_sync_state`**: `last_history_id`, `last_synced_at`, `last_error`, `consecutive_error_count` — maintained by the polling worker.

Confirmed by re-reading the migration. **No migration 028+.**

### `gmail-client.ts` evolution

File: `src/industries/education-consultancy/features/email/lib/gmail-client.ts`.

**Add three functions, extend one.** All new functions accept an account, refresh the token if needed (calling existing `refreshAccessTokenIfNeeded`), and return refreshed credentials so the caller can persist if non-null (same pattern as Phase 2's `sendMessage`).

#### `listHistory(account, startHistoryId): Promise<{ historyId, messageAddedIds, refreshed_credentials, expired? }>`

```ts
export async function listHistory(
  account: ConnectedEmailAccount,
  startHistoryId: string,
): Promise<{
  historyId: string;
  messageAddedIds: string[];
  refreshed_credentials: { access_token: string; expiry_date: number } | null;
  expired?: true;  // set when startHistoryId is too old
}> {
  const refreshed = await refreshAccessTokenIfNeeded(account);
  const client = createOAuth2Client(account.refresh_token);
  if (refreshed) {
    client.setCredentials({
      refresh_token: account.refresh_token,
      access_token: refreshed.access_token,
      expiry_date: refreshed.expiry_date,
    });
  }
  const gmail = google.gmail({ version: "v1", auth: client });
  try {
    const res = await gmail.users.history.list({
      userId: "me",
      startHistoryId,
      historyTypes: ["messageAdded"],
      maxResults: 100,
    });
    // history field can be absent if no changes
    const messageAddedIds: string[] = [];
    for (const entry of res.data.history ?? []) {
      for (const msgAdded of entry.messagesAdded ?? []) {
        if (msgAdded.message?.id) messageAddedIds.push(msgAdded.message.id);
      }
    }
    return {
      historyId: res.data.historyId ?? startHistoryId,
      messageAddedIds: Array.from(new Set(messageAddedIds)),  // dedupe
      refreshed_credentials: refreshed,
    };
  } catch (err) {
    // 404 = historyId too old (Gmail retains ~7 days of history)
    const status = (err as { code?: number }).code;
    if (status === 404) {
      return { historyId: "", messageAddedIds: [], refreshed_credentials: refreshed, expired: true };
    }
    throw err;
  }
}
```

#### `getMessage(account, messageId): Promise<ParsedMessage>`

```ts
export interface ParsedMessage {
  gmail_message_id: string;
  gmail_thread_id: string;
  rfc_message_id: string | null;
  in_reply_to: string | null;
  references: string[];
  from_email: string;
  from_name: string | null;
  to_emails: string[];
  cc_emails: string[];
  subject: string;
  body_html: string;
  body_text: string;
  received_at: string;  // ISO timestamp
}

export async function getMessage(
  account: ConnectedEmailAccount,
  messageId: string,
): Promise<{ message: ParsedMessage; refreshed_credentials: { access_token: string; expiry_date: number } | null }> {
  const refreshed = await refreshAccessTokenIfNeeded(account);
  const client = createOAuth2Client(account.refresh_token);
  if (refreshed) {
    client.setCredentials({
      refresh_token: account.refresh_token,
      access_token: refreshed.access_token,
      expiry_date: refreshed.expiry_date,
    });
  }
  const gmail = google.gmail({ version: "v1", auth: client });
  const res = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });
  return { message: parseGmailMessage(res.data), refreshed_credentials: refreshed };
}
```

`parseGmailMessage()` walks `data.payload` extracting headers (`From`, `To`, `Cc`, `Subject`, `Message-ID`, `In-Reply-To`, `References`, `Date`) and the body parts (`text/html` preferred → fall back to `text/plain` → decode base64url). Parses `From` into `from_name` + `from_email` (RFC822 syntax: `"Display Name" <addr@host>` or `addr@host`). Parses `To`/`Cc` into string arrays. References header parses into array of `<id@host>` tokens. Helper file `gmail-parser.ts` in the feature folder.

#### `sendMessage(account, args)` — extend Phase 2's signature

Phase 2 already declared the params; just unused. Phase 3 wires them through:

```ts
// Phase 2 signature (unchanged shape; threadId/inReplyTo/references now USED)
export async function sendMessage(
  account: ConnectedEmailAccount,
  args: {
    from: string;
    fromName?: string;
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    bodyHtml: string;
    bodyText?: string;
    threadId?: string;       // Phase 3: passed to gmail.users.messages.send.requestBody
    inReplyTo?: string;      // Phase 3: set as In-Reply-To header via MailComposer
    references?: string[];   // Phase 3: set as References header via MailComposer
  },
): Promise<{ gmail_message_id, gmail_thread_id, rfc_message_id, refreshed_credentials }>
```

In the function body:
- `MailComposer` constructor extends to accept `inReplyTo` + `references` (nodemailer supports both — see its docs).
- `gmail.users.messages.send({ userId: "me", requestBody: { raw: encoded, threadId: args.threadId } })` — if `threadId` is provided, Gmail threads the new message into that conversation; otherwise creates a new thread.

### `/api/internal/email/poll` endpoint

File: `src/app/api/internal/email/poll/route.ts` (NOT under `/api/v1/`).

```ts
export async function POST(request: Request) {
  // Auth: bearer secret
  const authHeader = request.headers.get("authorization");
  const expected = `Bearer ${process.env.INTERNAL_CRON_SECRET}`;
  if (!authHeader || authHeader !== expected) {
    return apiUnauthorized();
  }

  const supabase = await createServiceClient();  // poll is system-level, no auth context

  // Load all active accounts (whose owner is still in tenant_users)
  const { data: accounts } = await supabase
    .from("connected_email_accounts")
    .select("*, tenant_users!inner(user_id)")  // inner join filters to accounts with a still-active tenant user
    .order("created_at");

  if (!accounts || accounts.length === 0) {
    return apiSuccess({ accounts_polled: 0, new_inbound_count: 0, errors: 0 });
  }

  // Poll in chunks of 5
  const CONCURRENCY = 5;
  let totalNewInbound = 0;
  let totalErrors = 0;

  for (let i = 0; i < accounts.length; i += CONCURRENCY) {
    const chunk = accounts.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map((account) => pollOneAccount(supabase, account))
    );
    for (const r of results) {
      if (r.status === "fulfilled") totalNewInbound += r.value.newInboundCount;
      else totalErrors += 1;
    }
  }

  return apiSuccess({
    accounts_polled: accounts.length,
    new_inbound_count: totalNewInbound,
    errors: totalErrors,
  });
}
```

#### `pollOneAccount(supabase, account)` — per-account loop

```ts
async function pollOneAccount(supabase, account) {
  // Load sync state (create baseline if first poll)
  const { data: existingState } = await supabase
    .from("email_sync_state")
    .select("*")
    .eq("connected_email_account_id", account.id)
    .maybeSingle();

  let lastHistoryId = existingState?.last_history_id;

  // First-time poll: bootstrap baseline (set to current profile.historyId; skip historical messages)
  if (!lastHistoryId) {
    const refreshed = await refreshAccessTokenIfNeeded(account);
    const client = createOAuth2Client(account.refresh_token);
    if (refreshed) client.setCredentials({ refresh_token: account.refresh_token, access_token: refreshed.access_token, expiry_date: refreshed.expiry_date });
    const profile = await google.gmail({ version: "v1", auth: client }).users.getProfile({ userId: "me" });
    lastHistoryId = String(profile.data.historyId);
    await supabase.from("email_sync_state").upsert({
      connected_email_account_id: account.id,
      last_history_id: lastHistoryId,
      last_synced_at: new Date().toISOString(),
      consecutive_error_count: 0,
      last_error: null,
    }, { onConflict: "connected_email_account_id" });
    // Persist refreshed token if applicable
    if (refreshed) {
      await persistRefreshedToken(supabase, account.id, refreshed);
    }
    return { newInboundCount: 0 };
  }

  try {
    const { historyId, messageAddedIds, refreshed_credentials, expired } = await listHistory(account, lastHistoryId);

    if (refreshed_credentials) {
      await persistRefreshedToken(supabase, account.id, refreshed_credentials);
    }

    // History gap: bootstrap from current profile.historyId
    if (expired) {
      const client = createOAuth2Client(account.refresh_token);
      const profile = await google.gmail({ version: "v1", auth: client }).users.getProfile({ userId: "me" });
      await supabase.from("email_sync_state").update({
        last_history_id: String(profile.data.historyId),
        last_synced_at: new Date().toISOString(),
        consecutive_error_count: 0,
        last_error: "history_expired_bootstrapped",
      }).eq("connected_email_account_id", account.id);
      return { newInboundCount: 0 };
    }

    if (messageAddedIds.length === 0) {
      await supabase.from("email_sync_state").update({
        last_history_id: historyId,
        last_synced_at: new Date().toISOString(),
        consecutive_error_count: 0,
        last_error: null,
      }).eq("connected_email_account_id", account.id);
      return { newInboundCount: 0 };
    }

    // For each new messageId: fetch, match, persist if matched
    let newInboundCount = 0;
    for (const messageId of messageAddedIds) {
      try {
        const { message: parsed, refreshed_credentials: r2 } = await getMessage(account, messageId);
        if (r2) await persistRefreshedToken(supabase, account.id, r2);

        // Skip if this is a message we sent (our own outbound that Gmail's history surfaces as messageAdded too)
        if (parsed.from_email.toLowerCase() === account.email.toLowerCase()) continue;

        // Match to a thread
        const thread = await matchInboundToThread(supabase, account, parsed);
        if (!thread) continue;  // orphan — don't persist

        // Persist inbound row
        const { data: emailRow } = await supabase.from("emails").insert({
          tenant_id: account.tenant_id,
          thread_id: thread.id,
          connected_email_account_id: account.id,
          direction: "inbound",
          from_email: parsed.from_email,
          from_name: parsed.from_name,
          to_emails: parsed.to_emails,
          cc_emails: parsed.cc_emails,
          bcc_emails: [],
          subject: parsed.subject,
          body_html: parsed.body_html,
          body_text: parsed.body_text,
          gmail_message_id: parsed.gmail_message_id,
          rfc_message_id: parsed.rfc_message_id,
          in_reply_to: parsed.in_reply_to,
          rfc_references: parsed.references,
          received_at: parsed.received_at,
          sender_user_id: null,
        }).select("id").single();

        // Update thread metadata
        await supabase.from("email_threads").update({
          message_count: thread.message_count + 1,
          last_message_at: parsed.received_at,
          updated_at: new Date().toISOString(),
        }).eq("id", thread.id);

        // Emit event
        await emitEvent({
          tenantId: account.tenant_id,
          type: "email.received",
          entityType: "email",
          entityId: emailRow!.id,
          payload: {
            thread_id: thread.id,
            lead_id: thread.lead_id,
            contact_id: thread.contact_id,
            from_email: parsed.from_email,
            subject: parsed.subject,
            received_at: parsed.received_at,
            from_account_id: account.id,
          },
        });

        newInboundCount += 1;
      } catch (msgErr) {
        logger.error({ err: msgErr, messageId, account_id: account.id }, "Failed to process inbound message");
        // Don't fail the whole poll — skip this message, continue
      }
    }

    await supabase.from("email_sync_state").update({
      last_history_id: historyId,
      last_synced_at: new Date().toISOString(),
      consecutive_error_count: 0,
      last_error: null,
    }).eq("connected_email_account_id", account.id);

    return { newInboundCount };
  } catch (err) {
    logger.error({ err, account_id: account.id }, "Poll failed for account");
    await supabase.from("email_sync_state").update({
      last_synced_at: new Date().toISOString(),
      last_error: String(err).substring(0, 500),
      consecutive_error_count: (existingState?.consecutive_error_count ?? 0) + 1,
    }).eq("connected_email_account_id", account.id);
    throw err;  // propagate to allSettled — counted as error in caller
  }
}
```

#### `matchInboundToThread(supabase, account, parsed): Promise<EmailThread | null>`

```ts
async function matchInboundToThread(supabase, account, parsed) {
  // Primary: Gmail threadId
  const { data: byThreadId } = await supabase
    .from("email_threads")
    .select("*")
    .eq("connected_email_account_id", account.id)
    .eq("gmail_thread_id", parsed.gmail_thread_id)
    .maybeSingle();
  if (byThreadId) return byThreadId;

  // Fallback 1: In-Reply-To header
  if (parsed.in_reply_to) {
    const { data: parentEmail } = await supabase
      .from("emails")
      .select("thread_id")
      .eq("rfc_message_id", parsed.in_reply_to)
      .eq("connected_email_account_id", account.id)
      .maybeSingle();
    if (parentEmail) {
      const { data: thread } = await supabase
        .from("email_threads")
        .select("*")
        .eq("id", parentEmail.thread_id)
        .maybeSingle();
      if (thread) return thread;
    }
  }

  // Fallback 2: References chain (in order — most recent first)
  for (const refId of [...parsed.references].reverse()) {
    const { data: parentEmail } = await supabase
      .from("emails")
      .select("thread_id")
      .eq("rfc_message_id", refId)
      .eq("connected_email_account_id", account.id)
      .maybeSingle();
    if (parentEmail) {
      const { data: thread } = await supabase
        .from("email_threads")
        .select("*")
        .eq("id", parentEmail.thread_id)
        .maybeSingle();
      if (thread) return thread;
    }
  }

  return null;
}
```

#### `persistRefreshedToken(supabase, accountId, refreshed)`

Fire-and-forget pattern — same as Phase 2. Don't fail the poll if persist fails (token still works for this tick; next poll will refresh again).

```ts
async function persistRefreshedToken(supabase, accountId, refreshed) {
  await supabase
    .from("connected_email_accounts")
    .update({
      access_token: refreshed.access_token,
      token_expiry: new Date(refreshed.expiry_date).toISOString(),
    })
    .eq("id", accountId);
}
```

### `/api/v1/email/send` extension — reply support

File: `src/app/(main)/api/v1/email/send/route.ts`. Extend Phase 2's POST handler with optional `reply_context` in the body.

```ts
// New request body shape (reply_context optional, fresh compose unchanged):
{
  from_account_id, to, cc, bcc, subject, body_html, lead_id?, contact_id?,
  reply_context?: {
    thread_id: string,
    in_reply_to: string,        // the rfc_message_id of the message being replied to
    references: string[],       // accumulated reference chain
  }
}
```

Server changes (after the existing from_account validation):

```ts
let thread: { id: string; message_count: number; connected_email_account_id: string; lead_id: string | null; contact_id: string | null; gmail_thread_id: string } | null = null;

if (body.reply_context) {
  const { data: t, error } = await db
    .from("email_threads")
    .select("id, message_count, connected_email_account_id, lead_id, contact_id, gmail_thread_id")
    .eq("id", body.reply_context.thread_id)
    .single();
  if (error || !t) return apiNotFound("Email thread");

  // Same-account constraint: counselor with 2 inboxes can't reply on inbox A from inbox B
  if (t.connected_email_account_id !== body.from_account_id) {
    return apiError("REPLY_ACCOUNT_MISMATCH", "Reply must be sent from the thread's original account.", 400);
  }
  thread = t;
}

// Pass reply headers to sendMessage
let result;
try {
  result = await sendMessage(account, {
    from: account.email,
    fromName: account.display_name ?? undefined,
    to: body.to,
    cc: isStringArray(body.cc) ? body.cc : [],
    bcc: isStringArray(body.bcc) ? body.bcc : [],
    subject,
    bodyHtml,
    threadId: thread?.gmail_thread_id,
    inReplyTo: body.reply_context?.in_reply_to,
    references: body.reply_context?.references ?? [],
  });
} catch (err) { /* ...existing handling... */ }

// Persist: reuse thread if reply, else create new
let threadId: string;
if (thread) {
  threadId = thread.id;
  await db.from("email_threads").update({
    message_count: thread.message_count + 1,
    last_message_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", thread.id);
} else {
  const { data: newThread } = await db.from("email_threads").insert({
    connected_email_account_id: account.id,
    gmail_thread_id: result.gmail_thread_id,
    lead_id: body.lead_id ?? null,
    contact_id: body.contact_id ?? null,
    subject,
    last_message_at: new Date().toISOString(),
    message_count: 1,
  }).select("id").single();
  if (!newThread) return apiInternalError();
  threadId = newThread.id;
}

// Insert emails row (in_reply_to + rfc_references populated for replies)
const { data: emailRow } = await db.from("emails").insert({
  thread_id: threadId,
  connected_email_account_id: account.id,
  direction: "outbound",
  // ...existing fields...
  in_reply_to: body.reply_context?.in_reply_to ?? null,
  rfc_references: body.reply_context?.references ?? [],
  // ...
}).select("id").single();

// Event emit: same shape as Phase 2; add reply flag in payload
await emitEvent({
  tenantId: auth.tenantId,
  type: "email.sent",
  entityType: "email",
  entityId: emailRow!.id,
  payload: {
    thread_id: threadId,
    is_reply: !!body.reply_context,
    /* ...existing fields... */
  },
});
```

### `/api/v1/email/threads` rewrite

File: `src/app/(main)/api/v1/email/threads/route.ts`. Three changes:

1. **Return threads with embedded messages** (not flat messages with embedded thread):
   ```ts
   db.from("email_threads")
     .select("*, emails(id, direction, from_email, from_name, to_emails, cc_emails, subject, body_html, sent_at, received_at, sender_user_id, in_reply_to, rfc_references, gmail_message_id, rfc_message_id)")
     .order("last_message_at", { ascending: false });
   ```

2. **Counselor scoping change** — from `sender_user_id` to `connected_email_account.user_id` (covers inbound):
   ```ts
   if (auth.role === "counselor") {
     const { data: ownAccounts } = await db
       .from("connected_email_accounts")
       .select("id")
       .eq("user_id", auth.userId);
     const ownAccountIds = (ownAccounts ?? []).map((a) => a.id);
     if (ownAccountIds.length === 0) return apiSuccess([]);  // counselor has no accounts
     query = query.in("connected_email_account_id", ownAccountIds);
   }
   ```

3. **Lead/contact filter applies to thread-level (not embedded)**:
   ```ts
   if (leadId) query = query.eq("lead_id", leadId);
   if (contactId) query = query.eq("contact_id", contactId);
   ```

Response shape (changed from Phase 2's flat-list):
```json
{
  "data": [
    {
      "id": "thread-uuid",
      "gmail_thread_id": "...",
      "lead_id": "...",
      "contact_id": null,
      "subject": "Welcome, Mamata",
      "message_count": 3,
      "last_message_at": "2026-06-01T11:00:00Z",
      "connected_email_account_id": "...",
      "created_at": "...",
      "updated_at": "...",
      "emails": [
        { "id": "...", "direction": "outbound", "subject": "Welcome, Mamata", "body_html": "<p>...</p>", "sent_at": "2026-06-01T10:23Z", "sender_user_id": "counselor-uuid", ... },
        { "id": "...", "direction": "inbound", "subject": "Re: Welcome, Mamata", "body_html": "<p>Thanks!</p>", "received_at": "2026-06-01T10:45Z", "sender_user_id": null, "from_email": "mamata@example.com", ... },
        { "id": "...", "direction": "outbound", "subject": "Re: Welcome, Mamata", "body_html": "<p>Glad to hear...</p>", "sent_at": "2026-06-01T11:00Z", "sender_user_id": "counselor-uuid", ... }
      ]
    }
  ]
}
```

Embedded `emails` are NOT ordered by PostgREST by default — client-side sorts by `COALESCE(sent_at, received_at)` asc within each thread.

### UI components

#### `<EmailThreadCard>` — new (replaces Phase 2's `<SentEmailCard>`)

File: `src/industries/education-consultancy/features/email/components/email-thread-card.tsx`.

Collapsed view (default):
- Subject (truncate) + ✉ badge if outbound-only OR ⬅ badge if any inbound + "N messages" pill
- Participant pills (deduplicated `from_email` set excluding the account's own email)
- Time-ago of last message (relative — "5m ago", "2h ago", etc.)
- Chevron to expand

Expanded view:
- Sorted messages oldest→newest
- Each message: avatar (initial of from_name) + from line + to/cc summary + timestamp + body
- Inbound: left-aligned, blue-tint background
- Outbound: right-aligned (or just visually distinct), neutral background; counselor's name shown via sender_user_id lookup (passed from parent via `teamMemberEmails` map)
- **Reply button** at the bottom — `onClick: () => onReply(thread, lastMessage)`

Props:
```ts
{
  thread: EmailThread;
  currentUserId: string;
  teamMemberEmails: Record<string, string>;
  ownConnectedInboxes: Array<{ id: string; email: string }>;
  onReply: (thread: EmailThread, lastMessage: Email) => void;
}
```

#### `<ComposeEmailDialog>` — extend Phase 2

Add optional `replyContext` prop:
```ts
interface ComposeEmailDialogProps {
  // ...existing Phase 2 props...
  replyContext?: {
    thread: EmailThread;
    lastMessage: Email;
  };
}
```

When `replyContext` is set:
- From picker **locked** to `replyContext.thread.connected_email_account_id` (rendered as disabled Select even with 2+ inboxes)
- To pre-filled with `replyContext.lastMessage.from_email`
- Subject pre-filled with `"Re: " + lastMessage.subject` (only prefix if subject doesn't already start with "Re:")
- Body empty
- On Send: include `reply_context: { thread_id, in_reply_to, references }` in the POST payload (build references chain client-side from `lastMessage.rfc_references` + `lastMessage.rfc_message_id`)

#### `useEmailThreads(leadId)` hook — replaces `useSentEmails`

File: `src/industries/education-consultancy/features/email/hooks/use-email-threads.ts`.

```ts
export interface EmailThread {
  id: string;
  connected_email_account_id: string;
  gmail_thread_id: string;
  lead_id: string | null;
  contact_id: string | null;
  subject: string;
  last_message_at: string;
  message_count: number;
  emails: Email[];  // sorted client-side
  created_at: string;
  updated_at: string;
}

export interface Email {
  id: string;
  direction: "outbound" | "inbound";
  from_email: string;
  from_name: string | null;
  to_emails: string[];
  cc_emails: string[];
  subject: string;
  body_html: string;
  sent_at: string | null;
  received_at: string | null;
  sender_user_id: string | null;
  in_reply_to: string | null;
  rfc_references: string[];
  rfc_message_id: string | null;
  gmail_message_id: string;
}

export function useEmailThreads(leadId: string) {
  const [threads, setThreads] = useState<EmailThread[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/email/threads?lead_id=${encodeURIComponent(leadId)}`);
      if (res.ok) {
        const json = await res.json();
        // Sort embedded messages oldest→newest per thread
        const sorted = (json.data ?? []).map((t: EmailThread) => ({
          ...t,
          emails: [...t.emails].sort((a, b) => {
            const aTime = a.sent_at ?? a.received_at ?? "";
            const bTime = b.sent_at ?? b.received_at ?? "";
            return aTime.localeCompare(bTime);
          }),
        }));
        setThreads(sorted);
      }
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => { refresh(); }, [refresh]);
  return { threads, setThreads, loading, refresh };
}
```

#### `ActivitiesPanel` Emails sub-tab evolution

File: `src/components/dashboard/lead/activities/activities-panel.tsx`.

Phase 2's combined-list (sent emails ✉ + logged emails 📝) restructures:
- Threads from new `useEmailThreads` render via `<EmailThreadCard>` per thread
- Logged emails from `lead_activities` continue to render via existing `<ActivityCard>` with 📝 Logged badge — but now placed BELOW the threads section, in their own "Past activity" subheader. Justification: threads are the active conversation surface; logged emails are backfill / historical record.
- Compose CTA stays at the top (industry-gated as in Phase 2)
- On Send success in compose: prepend a new thread (fresh compose) OR find-and-update the existing thread (reply) via `setThreads`. Optimistic.

Reply flow wiring:
```tsx
const handleReply = (thread: EmailThread, lastMessage: Email) => {
  setReplyContext({ thread, lastMessage });
  setComposeOpen(true);
};

const handleSent = (result, optimisticEmail) => {
  if (replyContext) {
    // Reply: find and update existing thread
    setThreads(prev => prev.map(t =>
      t.id === replyContext.thread.id
        ? { ...t, emails: [...t.emails, optimisticEmail], message_count: t.message_count + 1, last_message_at: optimisticEmail.sent_at! }
        : t
    ));
  } else {
    // Fresh compose: prepend a new thread (we get the thread_id back from the API)
    const newThread: EmailThread = {
      id: result.thread_id,
      // ...stub other fields from the optimistic data...
      emails: [optimisticEmail],
      message_count: 1,
      last_message_at: optimisticEmail.sent_at!,
      // ...
    };
    setThreads(prev => [newThread, ...prev]);
  }
  setReplyContext(null);
};
```

### GitHub Actions cron workflow

File: `.github/workflows/email-poll.yml`.

```yaml
name: Email Poll (dev)

on:
  schedule:
    - cron: '*/5 * * * *'   # every 5 min
  workflow_dispatch:         # manual trigger for testing

jobs:
  poll:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - name: POST dev poll endpoint
        run: |
          response=$(curl -sS -w "\n%{http_code}" -X POST \
            -H "Authorization: Bearer ${{ secrets.INTERNAL_CRON_SECRET_DEV }}" \
            -H "Content-Type: application/json" \
            https://dev-lead-crm.zunkireelabs.com/api/internal/email/poll)
          http_code=$(echo "$response" | tail -n1)
          body=$(echo "$response" | sed '$d')
          echo "HTTP $http_code"
          echo "Body: $body"
          [ "$http_code" = "200" ] || exit 1
```

**Prod workflow (added later, as part of prod promotion bundle)**: identical except the URL points to `lead-crm.zunkireelabs.com` and the secret is `INTERNAL_CRON_SECRET_PROD` (separate secret so revoking dev's doesn't affect prod).

**GH Actions cron caveat**: schedule isn't precise. Can lag by up to 15 min during high-load periods. Documented; acceptable for a 5-min cadence (worst case = 20-min latency on first reply visibility).

### New env vars

```
INTERNAL_CRON_SECRET=<32-byte hex string>
```

- Added to `.env.local` on dev (`/home/zunkireelabs/devprojects/lead-gen-crm-dev/.env.local`)
- Added to `.env.local` on prod (when promoting) (`/home/zunkireelabs/devprojects/lead-gen-crm/.env.local`)
- Added to GitHub repo secrets as `INTERNAL_CRON_SECRET_DEV` and (eventually) `INTERNAL_CRON_SECRET_PROD`
- Generate with `openssl rand -hex 32` per environment (different secret per env so dev compromise doesn't affect prod)
- After adding to `.env.local`: `docker compose up -d --force-recreate app` (NOT restart — same Phase 1 lesson)

---

## File-by-file changes

### Add

1. `src/industries/education-consultancy/features/email/lib/gmail-client.ts` — **EXTEND**: add `listHistory()`, `getMessage()`, extend `sendMessage()` to wire threadId + inReplyTo + references. Phase 1 + 2 exports stay.
2. `src/industries/education-consultancy/features/email/lib/gmail-parser.ts` — **NEW**: `parseGmailMessage(messageData) → ParsedMessage`. Walks payload, extracts headers + body parts, parses From/To/Cc per RFC822.
3. `src/app/api/internal/email/poll/route.ts` — **NEW**: the polling endpoint per the spec above.
4. `src/app/api/internal/email/poll/lib.ts` — **NEW**: extracts `pollOneAccount`, `matchInboundToThread`, `persistRefreshedToken` helpers (kept in a `lib.ts` next to the route for testability; route file is thin).
5. `src/industries/education-consultancy/features/email/components/email-thread-card.tsx` — **NEW**: thread display component.
6. `src/industries/education-consultancy/features/email/hooks/use-email-threads.ts` — **NEW**: replaces `use-sent-emails.ts`.
7. `.github/workflows/email-poll.yml` — **NEW**: cron workflow per the YAML above.

### Modify

8. `src/app/(main)/api/v1/email/send/route.ts` — accept optional `reply_context` in body; thread-reuse logic; same-account constraint; pass reply headers to sendMessage.
9. `src/app/(main)/api/v1/email/threads/route.ts` — return threads with embedded messages; counselor scoping via `connected_email_accounts.user_id`; lead/contact filter on thread-level.
10. `src/industries/education-consultancy/features/email/components/compose-email-dialog.tsx` — accept optional `replyContext` prop; lock From picker; pre-fill To + Subject; pass reply_context in submit.
11. `src/components/dashboard/lead/activities/activities-panel.tsx` — replace `<SentEmailCard>` rendering with `<EmailThreadCard>`; logged emails move to "Past activity" subheader below threads; wire Reply flow.

### Delete

12. `src/industries/education-consultancy/features/email/hooks/use-sent-emails.ts` — replaced by `use-email-threads.ts`. (Confirm no other call sites first — should be only `<ActivitiesPanel>`.)
13. `src/industries/education-consultancy/features/email/components/sent-email-card.tsx` — replaced by `<EmailThreadCard>`. (Same call-site check.)

### Don't touch

- Phase 1 + 2 endpoints under `/api/v1/email/inboxes/*` and the legacy email-rules surface.
- Migration 025 — already complete for Phase 3.
- `useConnectedInboxes` hook — still used by `<InboxConnector>` and `<FromAccountPicker>`.
- `<InboxConnector>`, `<FromAccountPicker>`, `<TipTapEditor>` — used as-is.

---

## API request/response examples

### `POST /api/internal/email/poll`

Request:
```
POST /api/internal/email/poll HTTP/1.1
Authorization: Bearer <INTERNAL_CRON_SECRET>
Content-Type: application/json

{}
```

Response (200):
```json
{
  "data": {
    "accounts_polled": 3,
    "new_inbound_count": 1,
    "errors": 0
  }
}
```

Response (401 if bearer missing/wrong):
```json
{ "error": { "code": "UNAUTHORIZED", "message": "Authentication required" } }
```

### `POST /api/v1/email/send` (reply form)

Request body (reply):
```json
{
  "from_account_id": "8a7c...",
  "to": ["mamata.roka@example.com"],
  "subject": "Re: Welcome, Mamata",
  "body_html": "<p>Glad to hear from you! Let me know if you'd like to schedule a call.</p>",
  "lead_id": "9f3e...",
  "reply_context": {
    "thread_id": "thread-uuid",
    "in_reply_to": "<incoming-rfc-id@example.com>",
    "references": ["<original-outbound-rfc-id@edgex-crm.com>", "<incoming-rfc-id@example.com>"]
  }
}
```

Response (200): same shape as Phase 2 (`{ thread_id, email_id, gmail_message_id }`). The returned `thread_id` matches `reply_context.thread_id`.

Error: 400 `REPLY_ACCOUNT_MISMATCH` if `from_account_id` differs from the thread's `connected_email_account_id`.

### `GET /api/v1/email/threads?lead_id=X`

Response (200): see the threaded shape above (threads with embedded `emails[]` sorted ASC client-side).

---

## Patterns to reuse

- **Industry gate**: same `getFeatureAccess(auth.industryId, FEATURES.EMAIL)` pattern on `/api/v1/email/send` + `/api/v1/email/threads`. The polling endpoint is NOT industry-gated — it's system-level and iterates all accounts; the per-account loop respects the account's tenant naturally via `account.tenant_id`.
- **`scopedClient(auth)`**: used in `/api/v1/email/send` + `/threads` per Phase 2's pattern. NOT used in `/api/internal/email/poll` (system-level, uses `createServiceClient` since there's no auth context).
- **`emitEvent()`**: same shape as Phase 2's `email.sent` payload — `email.received` mirrors with `received_at` instead of `sent_at`. Used by polling worker for each new inbound.
- **Bearer-token endpoints**: pattern lifted from existing integrations API (`/api/v1/integrations/...`) — `Authorization: Bearer <token>` validated server-side.
- **Optimistic UI**: same prepend-on-send pattern as Phase 2. Replies update existing thread in-place; fresh sends prepend new thread.
- **Counselor scoping via account ownership**: pre-fetch own account IDs → `.in()` filter. Single extra query at endpoint entry; ≤5 rows for any realistic counselor.
- **MailComposer extension**: nodemailer's `MailComposer` already supports `inReplyTo` (sets `In-Reply-To` header) and `references` (sets `References` header). No new dependency.
- **Dynamic import**: `<EmailThreadCard>` and `<ComposeEmailDialog>` continue to be dynamically imported on lead detail so the email feature doesn't bloat the first-paint bundle.

---

## Verification matrix

### Local gates
- [ ] `npm run build` clean — both new routes register (`/api/internal/email/poll`, `/api/v1/email/threads` returning new shape doesn't matter to build).
- [ ] `npx eslint --max-warnings 50 .` stays at 17 baseline.

### End-to-end Phase 3 loop (the closing test)
- [ ] As Admizz admin, send an email from a lead to a test recipient (e.g. `<your-test-email>`). Confirm Phase 2 still works.
- [ ] Recipient replies from their email client.
- [ ] Within 5–10 min, the inbound reply appears in the lead's Emails sub-tab in the same thread (`<EmailThreadCard>` expanded shows both messages, sorted oldest→newest, inbound visually distinct).
- [ ] DB checks:
  - New `emails` row with `direction='inbound'`, `thread_id` matching the original, `gmail_message_id` populated, `rfc_message_id` populated, `in_reply_to` populated, `rfc_references` populated, `received_at` populated, `sender_user_id` NULL.
  - `email_threads` row's `message_count` incremented to 2, `last_message_at` updated.
  - `events` row `email.received` with payload (`thread_id`, `lead_id`, `from_email`, `subject`, etc.).
  - `email_sync_state.last_history_id` advanced, `last_synced_at` recent, `last_error` NULL.
- [ ] Click Reply on the thread → `<ComposeEmailDialog>` opens with From locked, To pre-filled, Subject "Re: ...".
- [ ] Send the reply with a fresh body.
- [ ] Recipient receives the reply IN THE SAME GMAIL THREAD (verify by viewing in their email client; threading should "just work" via `In-Reply-To` + `References` headers).
- [ ] CRM thread now shows 3 messages.

### Polling behavior
- [ ] `workflow_dispatch` from GH Actions → endpoint returns 200 + summary JSON.
- [ ] Without bearer → 401.
- [ ] With wrong bearer → 401.
- [ ] First poll for a new account (no `email_sync_state` row) → bootstraps with current `historyId`, `new_inbound_count: 0` (correct — we don't backfill historical inbound).
- [ ] Subsequent polls advance `last_history_id`.
- [ ] Simulate history expiration: `UPDATE email_sync_state SET last_history_id = '1' WHERE connected_email_account_id = '<id>'`. Next poll bootstraps cleanly (last_error = 'history_expired_bootstrapped'), no errors, no false matches.
- [ ] Simulate per-account error: temporarily revoke OAuth in Google Cloud Console for one account. Next poll: that account logs error + increments `consecutive_error_count`; other accounts unaffected; endpoint returns 200 with `errors: 1`.

### Reply matching
- [ ] Recipient replies via Gmail → matched via `gmail_thread_id` (primary path).
- [ ] Recipient replies via non-Gmail client (e.g. Outlook.com) where Gmail's `threadId` differs → matched via `In-Reply-To` header (fallback 1).
- [ ] Multi-message thread with intermediate forwards → `References` chain match works (fallback 2). Test by replying-to-the-reply.
- [ ] Cold inbound (someone emails the counselor's address without ever filling a form) → silently dropped, NOT persisted, NOT surfaced.
- [ ] Counselor sends two separate threads to same recipient, recipient replies to both → each reply matches its own thread correctly.

### Counselor scoping
- [ ] As Admizz admin: GET `/api/v1/email/threads?lead_id=X` returns all threads on the lead (sent by any counselor).
- [ ] As counselor user: GET returns only threads on connected accounts they own (covers both their outbound + inbound on those accounts).
- [ ] Counselor A and Counselor B both send to same lead → each sees only their own thread.
- [ ] Same lead, same thread — counselor B does NOT see counselor A's thread even if both are on the same lead.

### Industry gating
- [ ] Zunkireelabs admin: `/api/v1/email/threads` returns 403; `/api/v1/email/send` returns 403; `<EmailThreadCard>` not rendered on `/leads/[id]` (no compose CTA, sub-tab still shows logged emails only).
- [ ] Polling endpoint: not industry-gated (system-level); iterates accounts regardless of tenant's industry. Verify accounts in non-education tenants aren't polled wastefully — actually, the polling endpoint SHOULD only poll accounts in education_consultancy tenants. Add a filter on the account-loading query: `.in("tenant_id", <education-tenant-ids>)`. Simpler: filter by tenant.industry_id via join. Update the spec — add this gate.

### Token refresh
- [ ] Manually expire `token_expiry` on a connected account in DB. Next poll: `listHistory` → `refreshAccessTokenIfNeeded` returns refreshed creds → persist to DB. Verify `connected_email_accounts.access_token` + `token_expiry` updated.
- [ ] Manually revoke refresh_token in Google Cloud Console. Next poll for that account: 401 from Google → caught in per-account try/catch → `consecutive_error_count` increments → no DB writes for that account this tick → other accounts continue.

### Code-review checklist (carried from prior phases)
1. **PostgREST embed FK disambiguation**: RELEVANT for `/email/threads` new shape (`email_threads.emails(...)` — forward FK on `emails.thread_id → email_threads.id`; no reverse FK exists between these two; unambiguous). Embedded `emails` on `email_threads` should work without explicit FK name.
2. **PATCH preserves POST invariants**: N/A (no PATCH endpoints in Phase 3).
3. **New page components need a route shell**: N/A (no new top-level pages).
4. **`.select()` after insert/update**: RELEVANT. Polling worker's `emails` insert uses `.select("id").single()` for the event emit. Reply endpoint's `email_threads` update doesn't need to return a row.
5. **Radix Select empty-string sentinel**: RELEVANT for `<FromAccountPicker>` (already done in Phase 2). In reply mode, the Select is `disabled` with a specific account UUID as value — no empty-string sentinel.
6. **Cross-cutting predicate audits**: DONE. New `from("emails")` reads in the polling worker scope by `connected_email_account_id` (per-account loop). New reads in `/threads` scope by `tenant_id` (auto via scopedClient) + lead_id/contact_id at the thread level + counselor by account ownership. Grep `from("emails")` post-implementation.
7. **Page-padding stacks with shell**: N/A.
8. **NEW for Phase 3 — bearer-secret env-var presence**: the `/api/internal/email/poll` route MUST handle missing `INTERNAL_CRON_SECRET` env defensively (don't accept any bearer if env is unset — fail-closed, return 401). Without this, a misconfigured dev with empty env would accept any request.
9. **NEW for Phase 3 — concurrency safety on `email_sync_state.last_history_id`**: per-account polling is serial within `pollOneAccount`; concurrent polls of the same account can't happen (GH Actions runs once per tick, single endpoint call iterates all accounts). No locking needed. If we ever add a second poll trigger (manual + scheduled overlap), add a row-level lock.

---

## Workflow handoff

1. Sadin pastes the prompt below into a fresh Sonnet session.
2. Sonnet implements on `feat/email-phase-3-poll-reply` branched off latest `stage`. Runs local gates. Commits + pushes.
3. Opus reviews against this brief + 9-item checklist + verification matrix. Drafts any fixback prompts.
4. After fixback (if any), Opus squash-merges to `stage`. Sadin sets `INTERNAL_CRON_SECRET` on the dev server + adds `INTERNAL_CRON_SECRET_DEV` to GitHub Actions repo secrets.
5. Sadin smokes the end-to-end loop per verification matrix above.
6. Opus archives this brief to `docs/archive/features/EMAIL-PHASE-3-BRIEF.md`, writes the dated SESSION-LOG entry, and starts Phase 4 brief.

---

## Sonnet handoff prompt

Paste the block below to a fresh Sonnet session.

```
You're implementing Phase 3 of the education_consultancy Email feature on a feature branch. Read /Users/sadinshrestha/Projects/edgeXcrm/docs/EMAIL-PHASE-3-BRIEF.md end-to-end before touching any code — it's the full spec including the rationale (Decisions locked in section is non-negotiable), the API contracts, the file-by-file changes, the patterns to reuse, and the verification matrix.

Phase 3 ships THREE coupled capabilities in one phase: (a) inbound polling via a /api/internal/email/poll endpoint hit by GitHub Actions cron every 5 min, (b) full thread display in the lead's Emails sub-tab via a new <EmailThreadCard>, (c) reply-from-CRM via extending <ComposeEmailDialog> with a replyContext prop + extending POST /api/v1/email/send to accept reply_context. Phase 3 closes when an Admizz counselor sends → recipient replies → reply appears in CRM within 5–10 min → counselor replies from CRM → recipient sees reply in the same Gmail thread.

Phase 1 + 2 are shipped + smoke-verified on stage (squashes c9db7c2 + 977fc44). gmail-client.ts has 4 functions (createOAuth2Client, getProfileEmail, refreshAccessTokenIfNeeded, sendMessage). Phase 3 ADDS 2 functions (listHistory, getMessage) and EXTENDS sendMessage to wire up the previously-stubbed threadId + inReplyTo + references params. No new dependency.

NO SCHEMA CHANGES. Phase 1's migration 025 already provides everything Phase 3 needs: emails.direction='inbound' enum, received_at, in_reply_to, rfc_references[], sender_user_id NULL; email_threads.message_count + last_message_at increment naturally; email_sync_state is ready.

Workflow:
1. From the repo root, fetch latest stage and branch off it:
   git fetch origin && git checkout -b feat/email-phase-3-poll-reply origin/stage
2. Implement the changes per the brief, in this order:
   a. EXTEND gmail-client.ts with listHistory(), getMessage(), and the sendMessage extension (wire threadId + inReplyTo + references). Add gmail-parser.ts as a sibling helper for parseGmailMessage().
   b. Build /api/internal/email/poll/route.ts + /lib.ts (per-account polling, matchInboundToThread, persistRefreshedToken). Bearer-auth via INTERNAL_CRON_SECRET env var; fail-closed if env unset. Filter accounts to education_consultancy tenants only (per the per-tenant gate in the verification matrix — join on tenants.industry_id).
   c. EXTEND POST /api/v1/email/send to accept optional reply_context: { thread_id, in_reply_to, references[] }. Validate same-account constraint (return 400 REPLY_ACCOUNT_MISMATCH if mismatch). Reuse thread instead of creating new when reply.
   d. REWRITE GET /api/v1/email/threads to return threads with embedded messages (PostgREST embed: select("*, emails(...)")). Change counselor scoping from sender_user_id to connected_email_accounts.user_id (covers both directions). Lead/contact filter moves to thread-level.
   e. Build <EmailThreadCard>, <useEmailThreads> hook, extend <ComposeEmailDialog> with replyContext prop. Lock From picker when in reply mode. Build References chain client-side from lastMessage's rfc_references + rfc_message_id.
   f. EVOLVE ActivitiesPanel Emails sub-tab — replace <SentEmailCard> rendering with <EmailThreadCard>; move logged emails (lead_activities) to a "Past activity" subheader below the threads; wire handleReply + updated handleSent (find-and-update for reply, prepend-new for fresh compose).
   g. Add .github/workflows/email-poll.yml — 5-min cron + workflow_dispatch + bearer-auth POST to dev's /api/internal/email/poll.
3. Verify locally:
   - npm run build (clean)
   - npx eslint --max-warnings 50 . (clean — must stay at 17 baseline)
   - Manual: hit /api/internal/email/poll with the dev bearer (curl with the dev INTERNAL_CRON_SECRET) → 200 + summary
   - Manual: send a fresh email from a lead → confirm Phase 2 path still works → recipient replies → ~5 min → confirm inbound arrives, reply UI works
   - 403 spot-check as Zunkireelabs admin (no threads visible; send returns 403)
4. Self-check against the 8-item code-review checklist (the 7 prior + the 2 new in this brief).
5. Commit with clear message ending with:
   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
6. Push the branch. DON'T merge — Opus reviews and squash-merges to stage.

Critical constraints from the brief:
- Schema is unchanged. Don't touch supabase/migrations/.
- INTERNAL_CRON_SECRET is required for the polling endpoint to function — fail-closed if env is unset (return 401, never accept any request). Generate with `openssl rand -hex 32` (a strong default; Sadin will set the actual value in .env.local + GH secrets).
- Per-account polling is wrapped in try/catch so one account's failure (OAuth revoked, network error, etc.) doesn't block others. Use Promise.allSettled over chunks of 5.
- History API 404 = bootstrap path. Set last_history_id to current profile.historyId, skip the gap, log last_error='history_expired_bootstrapped', return 0 new inbound for the tick.
- DO NOT persist orphan inbound. If matchInboundToThread returns null (no threadId match + no In-Reply-To match + no References match), silently drop.
- DO NOT persist the counselor's own sent messages that Gmail's history surfaces as messageAdded — skip with `if (parsed.from_email.toLowerCase() === account.email.toLowerCase()) continue;`
- Counselor scoping change on /email/threads: pre-fetch own account IDs via a 2-query approach (cleaner than PostgREST inner join), then `.in("connected_email_account_id", ownAccountIds)`. If counselor has 0 connected accounts, return empty array immediately.
- Reply same-account constraint: a counselor with 2 connected inboxes can't reply on inbox A from inbox B. Server enforces; client locks the From picker.
- Subject "Re: " prefix only if subject doesn't already start with "Re:" (case-insensitive). Skip the prefix on continued reply chains.
- The polling endpoint MUST gate accounts by industry (only poll accounts whose tenant.industry_id === 'education_consultancy'). Without this, Zunkireelabs's connected_email_accounts (from the legacy email-forward feature) would also be polled wastefully.
- Build References chain for reply correctly: lastMessage.rfc_references is the chain so far; new chain = [...lastMessage.rfc_references, lastMessage.rfc_message_id]. Dedupe if the same id appears twice.

Self-flag in your handoff any of:
- Cases where MailComposer's inReplyTo/references API doesn't match what the brief assumes
- Any reply matching edge case you encountered that the brief didn't cover
- Threading/Gmail-API behavior that contradicted the brief's assumptions
- Anything that felt fragile but you couldn't justify hardening in scope

If you find a real ambiguity, surface it in your handoff back to Opus rather than guessing. Especially: the embedded `emails(...)` PostgREST shape on email_threads — if PostgREST grumbles about the embed without an explicit FK name, switch to `emails!emails_thread_id_fkey(...)` and document.
```
