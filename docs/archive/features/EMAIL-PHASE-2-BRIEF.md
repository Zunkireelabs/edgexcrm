# Email feature — Phase 2 (compose + send + log on lead detail)

> Phase 2 of the 4-phase Email feature plan. Builds on Phase 1's foundation (schema + OAuth + connected_email_accounts). Adds the **first user-facing send capability**: counselor opens a lead → composes → sends from their connected Gmail → email arrives at the recipient → row appears in the Emails sub-tab. No replies, no inbound sync, no threading continuation (those are Phase 3). Phase 2 closes when an Admizz counselor can send a real Gmail email from `/leads/[id]` to a test recipient (e.g. `daniel@theagencytool.com`) and see it in the activity feed within 1 second.

Phase 1 verified live on dev as of 2026-05-31 evening (commits `cd8110a` brief + `c9db7c2` squash + `2952a3f` Docker heap fix; OAuth roundtrip completed; `connected_email_accounts.user_id` populated for `shrestha.sadin007@gmail.com`). Full 4-phase plan: `~/.claude/plans/today-what-feature-i-wobbly-russell.md`.

---

## Goal

Phase 1 made it possible for a user to **connect** a Gmail inbox to edgeX. Phase 2 makes it possible for a user to **use** that connected inbox to send 1:1 email to a lead from within CRM. This is where the actual user value of the email feature begins — Phase 1 was pure plumbing.

The vertical slice for Phase 2:
> Counselor opens lead detail → Activity tab → Emails sub-tab → clicks "Compose Email" → modal opens with To pre-filled from lead.email, From dropdown showing their connected inboxes → writes subject + body (rich text) → clicks Send → modal closes → toast "Sent" → the sent email appears as a row in the Emails sub-tab list within 1 second → recipient actually receives a real Gmail email from the counselor's Gmail address.

No inbox sync yet — if the recipient replies, the reply lands in the counselor's Gmail (not in CRM). Phase 3 closes that loop. Phase 2 is one-way send only.

---

## CRM-expert design framing (carried from approved plan)

1. **One-way send only in v1 of the compose modal.** Don't try to bundle "log past email" into compose. Keep them as two separate actions: `Log past email` (existing button — for backfilling pre-CRM communications) and `Compose Email` (new primary CTA — for sending fresh). Conflating them confuses the user about what's happening (am I sending? am I recording? both?).

2. **The Emails sub-tab list combines sent + logged.** Single chronological list with small badges distinguishing source (✉ Sent vs 📝 Logged). One list, one mental model — counselor sees the lead's communication history regardless of how it got there. This matches HubSpot's pattern.

3. **From dropdown is a hard requirement, even with 1 connected inbox.** Don't auto-hide the From picker if user has only one inbox — show it disabled with the single inbox displayed. This sets the user's mental model that they CAN have multiple, and discoverability of multi-inbox is critical for Sadin's "connect multiple emails" requirement.

4. **TipTap rich text editor, not plain textarea.** The recipient comparison set is HubSpot / Zoho / Front — all of which use rich text. A plain textarea would feel like a 2005 CRM. Bold / italic / link / bullet / numbered list. No images in v2 (defer to v4 — needs upload pipeline).

5. **Counselor scoping is naturally correct.** Each counselor sends from their own Gmail; sent rows have `sender_user_id = counselor.id`. A counselor sees only their own sent emails on a lead's history (per the standard counselor-sees-own pattern). Admin sees all. Same shape as time-entries and the lead activities feed.

---

## Scope

### In scope (Phase 2)

1. **`gmail-client.ts` evolution** — add `sendMessage()` function using `googleapis.gmail.users.messages.send`. Returns Gmail's `messageId` + `threadId` + the RFC `Message-ID` we set on the outgoing message.
2. **`POST /api/v1/email/send`** — new endpoint. Industry-gated. Validates user owns the `from_account_id`. Sends via gmail-client. Persists `email_thread` (new) + `email` (direction='outbound'). Emits `email.sent` event.
3. **`GET /api/v1/email/threads?lead_id=X`** — new endpoint. Returns sent emails attached to a lead, scoped per counselor role.
4. **`<ComposeEmailDialog>`** — new component. Modal with From dropdown + To (pre-filled from lead.email, editable) + CC + BCC + Subject + Body (TipTap). Sticky Send button. Validates non-empty To + Subject + body before enabling Send.
5. **`<FromAccountPicker>`** — new component. Dropdown rendering current user's connected inboxes (via `GET /api/v1/email/inboxes`). Disabled state when only 1 inbox. Inline link "Connect more inboxes" → `/settings#connected-inboxes` when 0 inboxes.
6. **`<TipTapEditor>`** — reusable rich text wrapper. Toolbar: bold / italic / link / bullet / numbered list. Outputs both `html` and `text` (auto-derived from html for the body_text column).
7. **ActivitiesPanel "Emails" sub-tab evolution** — adds Compose CTA + merges sent emails from new `emails` table into the list (alongside legacy `lead_activities WHERE activity_type='email'`). Visually distinguish source (✉ Sent badge for emails from new table, 📝 Logged badge for legacy lead_activities).
8. **Lead-detail wiring** — pass `lead.email`, `lead.first_name`, `lead.last_name` into the compose modal as defaults. The compose body supports merge fields `{{first_name}}` and `{{last_name}}` interpolated at send time (server-side, before calling sendMessage — so what's stored matches what's sent).

### Out of scope (later phases — DO NOT build in Phase 2)

- **Phase 3**: inbound polling worker; thread display; reply-from-CRM; reply matching (In-Reply-To → From-match); `email.received` event; Gmail API `users.history.list` integration.
- **Phase 4**: contact-detail Email tab (mirror); account 360 activity feed integration; subject search on Emails sub-tab; unread-reply badges; parent CC auto-populate for education leads.
- **Attachments**: Gmail API send supports attachments via multipart MIME, but adds complexity. Deferred to Phase 4 (with the parent CC + polish work).
- **Send-later / scheduling**: defer to v2+.
- **Templates / template library**: defer to v2+. Only `{{first_name}}` and `{{last_name}}` merge fields in Phase 2.
- **Open/click tracking pixels**: defer indefinitely (privacy law surface).
- **Reply-prefix subject ("Re: ...")**: Phase 3 (when reply-from-CRM is wired). Phase 2 sends fresh threads only — every send is a NEW `email_thread` row.
- **Threading via `threadId` param on `gmail.users.messages.send`**: Phase 3. Phase 2 omits `threadId` from the send call so Gmail creates a fresh thread each time.

---

## Architecture

### No schema changes

Phase 1's migration 025 already provides everything Phase 2 needs:
- `connected_email_accounts.user_id` ← used to validate from-account ownership
- `email_threads (gmail_thread_id, lead_id, subject, last_message_at, message_count)` ← one new row per send
- `emails (thread_id, direction='outbound', from_*, to_emails[], subject, body_html, body_text, gmail_message_id, rfc_message_id, sent_at, sender_user_id)` ← one new row per send
- `events` ← `email.sent` events emitted via `emitEvent()`

No new migrations needed.

### `gmail-client.ts` evolution

File: `src/industries/education-consultancy/features/email/lib/gmail-client.ts` (extends Phase 1's exports).

Add **one new function**:

```ts
export async function sendMessage(
  account: ConnectedEmailAccount,
  args: {
    from: string;          // counselor's gmail address (account.email)
    fromName?: string;     // optional display name
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    bodyHtml: string;
    bodyText?: string;     // derived from html if not provided
    threadId?: string;     // Phase 3 — omit for Phase 2 (always new thread)
    inReplyTo?: string;    // Phase 3 — omit for Phase 2
    references?: string[]; // Phase 3 — omit for Phase 2
  }
): Promise<{
  gmail_message_id: string;
  gmail_thread_id: string;
  rfc_message_id: string;  // the Message-ID header we set on outgoing
}>
```

**Implementation outline**:

1. Refresh access token if needed (use existing `refreshAccessTokenIfNeeded()`).
2. Construct RFC 822 message bytes — use `nodemailer`'s `MailComposer` (already a dependency from Phase 1's smtp-sender, no new install needed). Pass `messageId` explicitly (UUID-based) so we know what `rfc_message_id` to store:
   ```ts
   import MailComposer from "nodemailer/lib/mail-composer";
   const rfcMessageId = `<${crypto.randomUUID()}@edgex-crm.com>`;
   const mail = new MailComposer({
     from: fromName ? `"${fromName}" <${from}>` : from,
     to: to.join(", "),
     cc: cc?.join(", "),
     bcc: bcc?.join(", "),
     subject,
     html: bodyHtml,
     text: bodyText ?? htmlToText(bodyHtml),
     messageId: rfcMessageId,
     inReplyTo,         // undefined in Phase 2
     references,        // undefined in Phase 2
   });
   const raw = await new Promise<Buffer>((resolve, reject) =>
     mail.compile().build((err, msg) => err ? reject(err) : resolve(msg))
   );
   ```
3. Base64-URL-encode the raw bytes:
   ```ts
   const encoded = raw.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
   ```
4. Call `gmail.users.messages.send`:
   ```ts
   const client = createOAuth2Client(account.refresh_token);
   const gmail = google.gmail({ version: "v1", auth: client });
   const result = await gmail.users.messages.send({
     userId: "me",
     requestBody: { raw: encoded /*, threadId omitted in Phase 2 */ },
   });
   ```
5. Return:
   ```ts
   return {
     gmail_message_id: result.data.id!,
     gmail_thread_id: result.data.threadId!,
     rfc_message_id: rfcMessageId,
   };
   ```

**`htmlToText()` helper**: tiny stub — strip HTML tags via regex (`html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()`). Sufficient for v2's text fallback (plain-text email clients are vanishing); fancier conversion can come later if needed.

### `POST /api/v1/email/send` — new endpoint

File: `src/app/(main)/api/v1/email/send/route.ts`.

```ts
export async function POST(request: Request) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.EMAIL)) return apiForbidden();

  // Parse + validate
  const body = await request.json();
  const validation = validate(body, {
    from_account_id: [required("from_account_id"), uuid()],
    to: [required("to"), arrayOf(emailFormat()), minLength(1)],
    cc: [optional(arrayOf(emailFormat()))],
    bcc: [optional(arrayOf(emailFormat()))],
    subject: [required("subject"), maxLength(500)],
    body_html: [required("body_html"), minLength(1)],
    lead_id: [optional(uuid())],
    contact_id: [optional(uuid())],
  });
  if (!validation.valid) return apiValidationError(validation.errors);

  const db = await scopedClient(auth);

  // Verify user owns the from_account
  const { data: account, error: acctErr } = await db
    .from("connected_email_accounts")
    .select("*")
    .eq("id", body.from_account_id)
    .eq("user_id", auth.userId)
    .single();
  if (acctErr || !account) return apiForbidden(); // 403 disguised — never reveal that the account exists for another user

  // Merge-field interpolation (server-side, so stored content matches sent content)
  // If lead_id provided, fetch lead.first_name + lead.last_name and replace {{first_name}} {{last_name}}
  let { subject, body_html } = body;
  let lead: { first_name?: string; last_name?: string } | null = null;
  if (body.lead_id) {
    const { data: l } = await db.from("leads").select("first_name, last_name").eq("id", body.lead_id).single();
    if (l) {
      lead = l;
      const replace = (s: string) =>
        s.replace(/\{\{\s*first_name\s*\}\}/g, l.first_name ?? "")
         .replace(/\{\{\s*last_name\s*\}\}/g, l.last_name ?? "");
      subject = replace(subject);
      body_html = replace(body_html);
    }
  }

  // Send via Gmail
  let result: Awaited<ReturnType<typeof sendMessage>>;
  try {
    result = await sendMessage(account, {
      from: account.email,
      fromName: account.display_name ?? undefined,
      to: body.to,
      cc: body.cc ?? [],
      bcc: body.bcc ?? [],
      subject,
      bodyHtml: body_html,
    });
  } catch (err) {
    logger.error({ err, from_account_id: account.id }, "Gmail send failed");
    return apiServiceUnavailable("Failed to send via Gmail. Check inbox connection in Settings.");
  }

  // Persist: thread first (Phase 2 = always new thread; no thread continuation yet)
  const { data: thread, error: threadErr } = await db.from("email_threads").insert({
    tenant_id: auth.tenantId,
    connected_email_account_id: account.id,
    gmail_thread_id: result.gmail_thread_id,
    lead_id: body.lead_id ?? null,
    contact_id: body.contact_id ?? null,
    subject,
    last_message_at: new Date().toISOString(),
    message_count: 1,
  }).select().single();
  if (threadErr) return apiInternalError(); // hard error — Gmail sent but DB write failed; counselor will see Send-failed toast; ops will see this in logs

  // Persist: the outbound message row
  const { data: email, error: emailErr } = await db.from("emails").insert({
    tenant_id: auth.tenantId,
    thread_id: thread.id,
    connected_email_account_id: account.id,
    direction: "outbound",
    from_email: account.email,
    from_name: account.display_name,
    to_emails: body.to,
    cc_emails: body.cc ?? [],
    bcc_emails: body.bcc ?? [],
    subject,
    body_html,
    body_text: null, // optional; we let display-side derive from html
    gmail_message_id: result.gmail_message_id,
    rfc_message_id: result.rfc_message_id,
    in_reply_to: null,
    rfc_references: [],
    sent_at: new Date().toISOString(),
    sender_user_id: auth.userId,
  }).select().single();
  if (emailErr) return apiInternalError();

  // Emit event for activity feeds
  await emitEvent({
    tenantId: auth.tenantId,
    type: "email.sent",
    entityType: "email",
    entityId: email.id,
    payload: {
      thread_id: thread.id,
      lead_id: body.lead_id ?? null,
      contact_id: body.contact_id ?? null,
      subject,
      from_account_id: account.id,
      sender_user_id: auth.userId,
      to_emails: body.to,
    },
  });

  return apiSuccess({ thread_id: thread.id, email_id: email.id, gmail_message_id: result.gmail_message_id });
}
```

### `GET /api/v1/email/threads?lead_id=X` — new endpoint

File: `src/app/(main)/api/v1/email/threads/route.ts`.

Returns sent emails attached to a lead (Phase 2 only outbound; Phase 3 expands to inbound). Counselor-scoped (`sender_user_id = auth.userId` if `auth.role === "counselor"`).

```ts
export async function GET(request: Request) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.EMAIL)) return apiForbidden();

  const url = new URL(request.url);
  const leadId = url.searchParams.get("lead_id");
  const contactId = url.searchParams.get("contact_id");
  if (!leadId && !contactId) return apiValidationError({ query: ["lead_id or contact_id required"] });

  const db = await scopedClient(auth);
  let query = db
    .from("emails")
    .select("id, thread_id, direction, from_email, from_name, to_emails, cc_emails, subject, body_html, sent_at, sender_user_id, email_threads!inner(id, lead_id, contact_id)")
    .order("sent_at", { ascending: false });

  if (leadId) query = query.eq("email_threads.lead_id", leadId);
  if (contactId) query = query.eq("email_threads.contact_id", contactId);

  // Counselor scoping
  if (auth.role === "counselor") query = query.eq("sender_user_id", auth.userId);

  const { data, error } = await query;
  if (error) return apiInternalError();
  return apiSuccess(data ?? []);
}
```

> **PostgREST embed FK disambiguation note**: `emails` has a forward FK to `email_threads(id)`; no reverse FK exists, so `emails.email_threads(...)` is unambiguous. The `!inner` tells PostgREST to require the join (excludes orphan emails — there shouldn't be any but defensive).

### UI components

#### `<ComposeEmailDialog>` (new)

File: `src/industries/education-consultancy/features/email/components/compose-email-dialog.tsx`.

Modal triggered from `<EmailsSubTab>`. Props:
```ts
{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTo?: string;                         // pre-fill from lead.email
  defaultSubject?: string;                    // empty in Phase 2 (Phase 3 sets "Re: ..." for replies)
  defaultBodyHtml?: string;                   // empty in Phase 2
  leadId?: string;
  contactId?: string;
  leadFirstName?: string | null;              // for {{first_name}} helper hint
  leadLastName?: string | null;
  onSent: (result: { thread_id: string; email_id: string }) => void;
}
```

Layout (mirrors HubSpot's compose modal):
- **Header**: "New email"
- **From row**: `<FromAccountPicker>` (full width, just an inbox selector)
- **To row**: editable text input (comma-separated emails)
- **Cc / Bcc collapsible**: hidden by default; "Cc Bcc" toggle in top-right of To row
- **Subject row**: text input
- **Body**: `<TipTapEditor>` with toolbar
- **Footer**: helper text "Use {{first_name}} and {{last_name}} to personalize" + "Cancel" + "Send"

Validation (client-side):
- Send button disabled if: no inboxes connected, To empty, Subject empty, body empty.

On Send:
- POST `/api/v1/email/send` with payload
- On success: toast "Email sent to X", close modal, call `onSent(result)`
- On failure: toast error with the message from the API, keep modal open with form intact (so user doesn't lose their work)

#### `<FromAccountPicker>` (new)

File: `src/industries/education-consultancy/features/email/components/from-account-picker.tsx`.

Renders a Radix Select bound to `useConnectedInboxes()` hook (which calls `GET /api/v1/email/inboxes`).

Three states:
- **0 inboxes**: show disabled Select with placeholder "No inboxes connected" + below it a Link to `/settings#connected-inboxes` saying "Connect a Gmail inbox in Settings". Send button in the parent modal stays disabled.
- **1 inbox**: show enabled Select pre-selected to that inbox; visually clear that it's the only option.
- **>1 inboxes**: enabled Select pre-selected to the first one (sorted by `email` alphabetical or by `created_at` desc — pick one; document); user picks.

> **Radix Select empty-string warning** (from existing code-review checklist): Don't use `value=""` as a sentinel — Radix throws at render. Use the inbox ID directly as the value.

#### `<TipTapEditor>` (new, reusable)

File: `src/industries/education-consultancy/features/email/components/tiptap-editor.tsx`.

Installs new dependencies:
```
npm install @tiptap/react @tiptap/starter-kit @tiptap/extension-link
```

Wraps `useEditor` from TipTap. Toolbar: Bold / Italic / Link / Bulleted list / Numbered list. Outputs HTML on change via `onUpdate(({ editor }) => setBodyHtml(editor.getHTML()))`. Min height 200px, scrollable for long messages.

Bundle impact: TipTap + starter-kit is ~150KB minified+gzipped. Imported only by the compose modal, which is dynamically loaded — won't affect first paint on `/leads/[id]`.

#### `<EmailsSubTab>` evolution

File: `src/components/dashboard/lead/activities/activities-panel.tsx` (existing — extend the existing "emails" SubTab).

Current behavior: filters `loggedActivities` (from `lead_activities`) by `activity_type === "email"`. Shows them via `<ActivityCard>` with a Log Email button at the top.

Phase 2 evolution:
1. Add a **second fetch** alongside the existing `fetchActivities`: `fetchSentEmails(leadId)` calling `GET /api/v1/email/threads?lead_id=<id>`. Stored in a new state var.
2. The "emails" sub-tab now renders a **combined list**:
   - Emails from new `emails` table → render via new `<SentEmailCard>` component with ✉ Sent badge
   - Logged emails from `lead_activities` → render via existing `<ActivityCard>` with 📝 Logged badge added
   - Merged + sorted by date desc (sent_at for new, completed_at for legacy)
3. Above the list, two CTAs:
   - Primary: **Compose Email** button → opens `<ComposeEmailDialog>` (industry-gated — only renders for education_consultancy tenants via `getFeatureAccess`)
   - Secondary: **Log past email** (rename existing "Log Email") → opens existing `<LogActivityModal>` with type="email"
4. On send-success from the compose modal: `setSentEmails(prev => [newEmail, ...prev])` — optimistic prepend, no refetch needed.
5. Counselor mode: shows only own sent emails (server enforces); admin: shows all.

If `industryId !== "education_consultancy"`, the Compose CTA is NOT rendered (legacy Log Email behavior preserved for non-education tenants). The Phase 2 work is education-only per the brief.

---

## File-by-file changes

### Add

1. `src/industries/education-consultancy/features/email/lib/gmail-client.ts` — **EXTEND**: add `sendMessage()` + a small `htmlToText()` helper. Phase 1 exports (`createOAuth2Client`, `getProfileEmail`, `refreshAccessTokenIfNeeded`) stay unchanged.
2. `src/app/(main)/api/v1/email/send/route.ts` — new endpoint per the contract above.
3. `src/app/(main)/api/v1/email/threads/route.ts` — new endpoint per the contract above.
4. `src/industries/education-consultancy/features/email/components/compose-email-dialog.tsx` — the compose modal.
5. `src/industries/education-consultancy/features/email/components/from-account-picker.tsx` — From dropdown.
6. `src/industries/education-consultancy/features/email/components/tiptap-editor.tsx` — rich text editor wrapper.
7. `src/industries/education-consultancy/features/email/components/sent-email-card.tsx` — list row for sent emails (mirrors existing `<ActivityCard>` shape so the merged list reads consistently).
8. `src/industries/education-consultancy/features/email/hooks/use-connected-inboxes.ts` — wraps `GET /api/v1/email/inboxes` with SWR-like pattern (fetch on mount, re-fetch on demand). Used by both `<InboxConnector>` (Phase 1 already exists; switch it to this hook) AND `<FromAccountPicker>`.
9. `src/industries/education-consultancy/features/email/hooks/use-sent-emails.ts` — wraps `GET /api/v1/email/threads?lead_id=X` for the EmailsSubTab.
10. `package.json` + `package-lock.json` — `npm install @tiptap/react @tiptap/starter-kit @tiptap/extension-link`.

### Modify

11. `src/components/dashboard/lead/activities/activities-panel.tsx` — evolve the Emails sub-tab per the design above. Combined list, two CTAs, conditional Compose CTA gated by `industryId === "education_consultancy"`. Pass the new compose props (defaultTo, leadId, etc.) from lead data.
12. `src/components/dashboard/lead/lead-detail-v2.tsx` (or wherever ActivitiesPanel is rendered from) — pass `industryId` + `lead.email` + `lead.first_name` + `lead.last_name` through to `<ActivitiesPanel>`. May already pass some of these; confirm at implementation time.
13. `src/industries/education-consultancy/features/email/components/inbox-connector.tsx` — switch from inline fetch to the new `useConnectedInboxes()` hook (so the list shared across components stays consistent on send/disconnect/reconnect).

### NOT modified (preserve)

- `src/lib/email/smtp-sender.ts` — legacy `sendGmailOAuth2Email` stays as-is (used by email-forward feature). Phase 2 send is in `gmail-client.ts`.
- Migration 025 (Phase 1) — schema is sufficient; no migration in Phase 2.
- Legacy `lead_activities` writes (`/api/v1/leads/[id]/activities` POST) — preserved unchanged for the "Log past email" path.

---

## API request/response examples

### `POST /api/v1/email/send`

Request body:
```json
{
  "from_account_id": "8a7c...",
  "to": ["mamata.roka@example.com"],
  "cc": [],
  "bcc": [],
  "subject": "Welcome, {{first_name}}",
  "body_html": "<p>Hi {{first_name}},</p><p>Thanks for your interest in...</p>",
  "lead_id": "9f3e..."
}
```

Response (200):
```json
{
  "data": {
    "thread_id": "tid-uuid",
    "email_id": "eid-uuid",
    "gmail_message_id": "190abcdef..."
  }
}
```

Error responses:
- 401 — unauthenticated
- 403 — not education_consultancy tenant OR from_account_id doesn't belong to current user
- 400 — validation errors (per-field details)
- 503 — Gmail API call failed (token expired / Gmail down / quota exceeded)
- 500 — Gmail send succeeded but DB persist failed (rare; logged for ops)

### `GET /api/v1/email/threads?lead_id=X`

Response (200):
```json
{
  "data": [
    {
      "id": "eid-1",
      "thread_id": "tid-1",
      "direction": "outbound",
      "from_email": "counselor@admizz.com",
      "from_name": "Counselor Name",
      "to_emails": ["mamata.roka@example.com"],
      "cc_emails": [],
      "subject": "Welcome, Mamata",
      "body_html": "<p>Hi Mamata,...</p>",
      "sent_at": "2026-06-01T10:23:45Z",
      "sender_user_id": "user-uuid",
      "email_threads": { "id": "tid-1", "lead_id": "lid", "contact_id": null }
    }
  ]
}
```

---

## Patterns to reuse

- **Industry gate**: `src/industries/_loader.ts` — `getFeatureAccess(auth.industryId, FEATURES.EMAIL)`. Same pattern as Phase 1's `/inboxes/*` endpoints.
- **`scopedClient(auth)`**: `src/lib/supabase/scoped.ts` — auto-injects `tenant_id` filter on all `emails`/`email_threads` queries. The new endpoints use it; the existing `connected_email_accounts` queries continue to use it.
- **`emitEvent()`**: `src/lib/api/audit.ts` — exact pattern from Account 360 v2 emit sites (e.g. `time_entry.approved`). Payload shape mirrors how other event types are structured (entity_type + entity_id + payload with cross-references).
- **Validation helpers**: `src/lib/api/validation.ts` — `validate()`, `required()`, `maxLength()`, etc. May need a small `arrayOf(emailFormat())` validator if not yet present — add to validation.ts.
- **Compose modal chrome**: `src/components/dashboard/lead/activities/log-activity-modal.tsx` is the closest precedent (a Dialog with form fields). Mirror its size, header, footer button placement.
- **Toast pattern**: `import { toast } from "sonner"` — used throughout. Success + error patterns from `<InboxConnector>` (Phase 1).
- **Counselor scoping precedent**: `src/app/(main)/api/v1/leads/route.ts` and `src/app/(main)/api/v1/tasks/route.ts` — `if (auth.role === "counselor") <filter by self>`. The `/email/threads` endpoint mirrors this.
- **Card chrome on the list rows**: `<ActivityCard>` in `src/components/dashboard/lead/activities/activity-card.tsx` — `<SentEmailCard>` should match its visual shape so the merged list reads consistently.
- **HMAC-state pattern** (from Phase 1) — N/A for Phase 2 (no new OAuth roundtrips).

---

## Decisions locked in (do not re-litigate during implementation)

- **One-way send only.** No replies, no thread continuation, no inbound sync in Phase 2. Every send creates a new `email_thread`. Phase 3 adds the rest.
- **Don't pass `threadId` to `gmail.users.messages.send`.** Phase 2 always creates a new thread. Phase 3 will pass `threadId` for replies.
- **Set `Message-ID` explicitly** when constructing the RFC 822 message (UUID-based, format `<uuid@edgex-crm.com>`). Don't let Gmail generate it — we need to know what `rfc_message_id` to store, and parsing the sent message to retrieve Gmail's auto-generated Message-ID is an extra round-trip.
- **Server-side merge field interpolation.** Replace `{{first_name}}` and `{{last_name}}` in subject + body_html on the server BEFORE calling sendMessage. What gets stored in `emails.body_html` is exactly what was sent. Client doesn't preview the interpolation (Phase 4 polish if requested).
- **TipTap, not plain textarea or react-quill.** Already decided; React 19 compatible.
- **`MailComposer` from `nodemailer/lib/mail-composer`** for RFC 822 construction. Already a dependency from Phase 1's smtp-sender; no new install.
- **No attachments.** Out of scope.
- **`<FromAccountPicker>` always renders** even when user has 1 inbox (disabled, but visible). Mental model + discoverability of multi-inbox.
- **Compose CTA on Emails sub-tab is industry-gated.** Only education_consultancy tenants see it. Non-education tenants keep the existing Log Email behavior unchanged.
- **Counselor scoping on `/email/threads` is mandatory.** Counselor sees only own sent emails on a lead. Admin sees all.
- **Body_text column intentionally null on insert.** Display side derives from body_html. Saves cycles; we can backfill if needed for search.

---

## Verification

Before pushing for review:

- [ ] `npm run build` clean locally (Node heap is at 4096MB since Phase 1's Dockerfile bump — TipTap install should not push it over).
- [ ] `npx eslint --max-warnings 50 .` clean locally (must stay at 17 baseline).
- [ ] **No new migration**: confirm `supabase/migrations/` has no new file numbered higher than 025 (Phase 1's mig).
- [ ] **`gmail-client.ts` exports**: `createOAuth2Client`, `getProfileEmail`, `refreshAccessTokenIfNeeded` (from Phase 1) + `sendMessage` (Phase 2). No leakage of `listHistory` or `getMessage` — those are Phase 3.
- [ ] **`<FromAccountPicker>` 3 states** verified:
  - 0 inboxes → Send disabled in parent modal, helper text + link to Settings shown
  - 1 inbox → Select shows that inbox, disabled (visually clear)
  - 2+ inboxes → Select enabled with first option pre-selected
- [ ] **`<ComposeEmailDialog>`**:
  - Opens with To pre-filled from lead.email
  - To, Subject, Body all required (Send disabled until non-empty)
  - Cc / Bcc collapsible (hidden by default; toggle reveals)
  - Body editor renders TipTap with toolbar
  - On Send: toast success, modal closes, new row appears immediately in the EmailsSubTab list
  - On Send failure: toast error, modal stays open with form intact
- [ ] **`POST /api/v1/email/send` end-to-end**:
  - Login as Admizz admin → open a lead with email `daniel@theagencytool.com` (or other test addr) → compose → send
  - Recipient receives a real Gmail email FROM `shrestha.sadin007@gmail.com` (the connected inbox)
  - DB: `email_threads` has one new row with `lead_id` set, `connected_email_account_id` set, `gmail_thread_id` populated
  - DB: `emails` has one new row, `direction='outbound'`, `gmail_message_id` populated, `rfc_message_id` populated (matches the `Message-ID` header in the sent email)
  - DB: `events` has a new `email.sent` event with the right payload shape
- [ ] **Merge field interpolation**: send with subject `Welcome, {{first_name}}` and body containing `{{last_name}}` → the actual delivered email contains the interpolated values (not the literal `{{...}}`), and the stored `emails.subject` + `emails.body_html` also contain the interpolated values.
- [ ] **Counselor scoping on `/email/threads`**:
  - As Admizz admin, GET `/api/v1/email/threads?lead_id=X` returns all emails sent on that lead by anyone in the tenant
  - As counselor user, GET returns only emails where `sender_user_id = self.userId`
  - Verify with at least 2 different senders sending to the same lead
- [ ] **Industry gating**:
  - Zunkireelabs admin → `POST /api/v1/email/send` returns 403
  - Zunkireelabs admin → Emails sub-tab on a lead does NOT show the Compose CTA (legacy Log Email still works)
- [ ] **From-account ownership**:
  - User A tries to send from User B's `from_account_id` → 403 (the `.eq("user_id", auth.userId)` check on the connected_email_accounts query catches it)
- [ ] **Token-expired path**:
  - Manually expire an inbox's `token_expiry` in the DB (`UPDATE connected_email_accounts SET token_expiry = '2020-01-01' WHERE id = '...'`)
  - Attempt to send → `refreshAccessTokenIfNeeded` should refresh transparently → send succeeds
  - Verify: `connected_email_accounts.access_token` + `token_expiry` updated in DB after send
- [ ] **All 7 code-review checklist items** considered:
  - **PostgREST embed FK disambiguation** — RELEVANT for `/email/threads` query (`emails!email_threads`). No reverse FK exists; explicit `!inner` clarifies. Verify with a sample query that the join returns expected shape and counselor scoping clauses apply correctly.
  - **PATCH preserves POST invariants** — N/A (no PATCH endpoints in Phase 2).
  - **New page components need a route shell** — N/A (no new top-level pages; compose modal is a Dialog inside existing lead detail).
  - **`.select()` after insert/update** — RELEVANT. Both `email_threads` insert AND `emails` insert use `.select().single()` to return the inserted row. The shape returned must include `id` so the second insert can reference `thread_id`. The endpoint returns `{ thread_id, email_id, gmail_message_id }` matching what the client uses for optimistic insertion.
  - **Radix Select empty-string sentinel** — RELEVANT for `<FromAccountPicker>`. Do NOT use `value=""` — use the inbox ID (a non-empty UUID) directly. Disabled state should not rely on `value=""`.
  - **Cross-cutting predicate audits** — DONE. New `from("emails")` reads scope by `tenant_id` (auto via scopedClient) + lead_id/contact_id via thread join + counselor by sender_user_id. No other code reads `from("emails")` yet (Phase 1 created the table empty); Phase 2 introduces all read paths. Confirm by grepping `from("emails")` across `src/` post-implementation.
  - **Page-padding stacks with shell** — N/A (no page wrapper changes).

---

## Workflow handoff

1. Sadin pastes the prompt below into a fresh Sonnet session.
2. Sonnet implements on `feat/email-phase-2-send` branched off latest `stage`, runs local gates, commits, pushes.
3. Opus reviews against this brief + 7-item checklist + verification matrix, drafts any fixback prompts, squash-merges to `stage` once clean.
4. Sadin smokes on `dev-lead-crm.zunkireelabs.com` per verification matrix above (compose → send → recipient receives → row appears → DB rows correct).
5. Opus archives this brief to `docs/archive/features/EMAIL-PHASE-2-BRIEF.md` and starts Phase 3 brief.

---

## Sonnet handoff prompt

Paste the block below to a fresh Sonnet session.

```
You're implementing Phase 2 of the education_consultancy Email feature on a feature branch. Read /Users/sadinshrestha/Projects/edgeXcrm/docs/EMAIL-PHASE-2-BRIEF.md end-to-end before touching any code — it's the full spec including the rationale (Decisions locked in section is non-negotiable), the API contracts, the file-by-file changes, the patterns to reuse, and the verification matrix.

This is SEND-ONLY. No replies, no inbound sync, no threading continuation. Every send creates a new email_thread row. Phase 3 will add the reply / sync / threading work. Phase 2 closes when an Admizz admin can compose + send a real Gmail email from a lead, recipient receives it, and the sent row appears in the Emails sub-tab list within 1 second.

Phase 1 is already shipped + verified on stage (squash c9db7c2, smoke complete 2026-05-31 evening). connected_email_accounts is user-scoped, OAuth flow works, gmail-client.ts exports the 3 Phase 1 functions. Don't re-implement Phase 1.

Workflow:
1. From the repo root, fetch latest stage and branch off it:
   git fetch origin && git checkout -b feat/email-phase-2-send origin/stage
2. Implement the changes per the brief, in this order:
   a. Run npm install @tiptap/react @tiptap/starter-kit @tiptap/extension-link and commit the package change.
   b. EXTEND src/industries/education-consultancy/features/email/lib/gmail-client.ts with the sendMessage() function (uses googleapis.gmail.users.messages.send + nodemailer's MailComposer for RFC 822 construction). Set Message-ID explicitly. Don't pass threadId — Phase 2 always creates fresh threads.
   c. Build POST /api/v1/email/send (industry-gated, scopedClient, merge field interpolation server-side, persist thread + email, emit email.sent event).
   d. Build GET /api/v1/email/threads?lead_id=X (industry-gated, counselor-scoped, PostgREST embed via emails!email_threads(...)).
   e. Build the 4 new UI components: ComposeEmailDialog, FromAccountPicker, TipTapEditor, SentEmailCard.
   f. Build the 2 new hooks: useConnectedInboxes (also wire InboxConnector to use it), useSentEmails.
   g. EVOLVE src/components/dashboard/lead/activities/activities-panel.tsx — add Compose CTA + merge sent emails into the Emails sub-tab list. Compose CTA is industry-gated (only renders for education_consultancy).
   h. Verify lead-detail-v2.tsx (or wherever ActivitiesPanel is rendered) passes industryId + lead.email + lead.first_name + lead.last_name down.
3. Verify locally before pushing:
   - npm run build (clean)
   - npx eslint --max-warnings 50 . (clean — must stay at 17 baseline)
   - Manual end-to-end: Admizz admin → open lead → compose → send → confirm real Gmail email arrives + sent row appears in Emails sub-tab + email_threads + emails rows in DB + email.sent event in events
   - 403 spot-check as Zunkireelabs admin: POST /api/v1/email/send returns 403; Compose CTA NOT visible on Emails sub-tab
4. Self-check against the verification checklist at the bottom of the brief.
5. Commit with clear message ending with:
   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
6. Push the branch. DON'T merge — Opus reviews and squash-merges to stage.

Critical constraints from the brief:
- Schema is unchanged. Use the tables migration 025 already created (email_threads, emails, email_sync_state).
- sendMessage() is in src/industries/education-consultancy/features/email/lib/gmail-client.ts — DO NOT touch src/lib/email/smtp-sender.ts. The legacy sendGmailOAuth2Email stays untouched (used by email-forward feature).
- RFC 822 construction via nodemailer/lib/mail-composer (already a dependency from Phase 1's smtp-sender, no new install needed).
- Set Message-ID explicitly as <uuid@edgex-crm.com> format. Don't let Gmail generate it.
- Server-side merge field interpolation: replace {{first_name}} and {{last_name}} in subject + body_html BEFORE calling sendMessage. Stored content matches sent content.
- Counselor scoping on GET /email/threads: if auth.role === "counselor", .eq("sender_user_id", auth.userId).
- The from_account_id must belong to auth.userId. Verify with .eq("user_id", auth.userId) on the connected_email_accounts query. Return 403 (not 404) if mismatch — never leak existence of another user's account.
- Compose CTA on Emails sub-tab is gated by industryId === "education_consultancy". Non-education tenants keep the existing Log Email button only.
- Don't pass threadId param to gmail.users.messages.send — Phase 2 always creates new threads. Phase 3 will add it for replies.
- FromAccountPicker has 3 distinct states (0 / 1 / 2+ inboxes). The 0-state must include a Link to /settings#connected-inboxes so the user can fix it without leaving lead detail.
- TipTap editor: starter-kit + link extension only. No images in Phase 2 (defer to Phase 4).
- Optimistic UI: after Send succeeds, prepend the new sent row to the EmailsSubTab list without refetching. The endpoint returns email_id + thread_id which the client uses to construct the optimistic row.

If you find a real ambiguity or an issue with the approach, surface it in your handoff back to Opus rather than guessing. Especially: if MailComposer's API doesn't match what the brief assumes (e.g. it requires a different call shape than .compile().build()), surface it before plowing through.
```
