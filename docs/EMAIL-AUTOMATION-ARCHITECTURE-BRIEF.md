# Email & Workflow Automation — Architecture Brief (Native, Orca-ready)

**Date:** 2026-06-08
**Author:** Opus planning session (with Sadin)
**Status:** In-flight architecture brief. The spine for the automation work; execute phase by phase. Archive to `docs/archive/research/` once Phase 2 ships.

> **Goal:** "email automation per pipeline" — fire an email (and later other actions) when a lead enters a pipeline stage — built **truly native** and designed so **Orca** (the AI agent OS) can own and drive it. This brief is the result of investigating what exists today + deciding the architecture.

---

## 1. Diagnosis — what exists today and why it's "not working"

A native v0 automation already exists and **is set up**, but is unconfigured + weak:

- **`email_forward_rules`** table + Settings UI (`email-rules-manager.tsx`) + processor `processEmailForwardRules()` (`src/lib/email/email-forward.ts`).
- **2 active rules** exist: Prime Ceramics "Welcome", Admizz "Welcome" — each bound to a pipeline stage.
- **Trigger is wired:** kanban drag (`PipelineBoard.tsx:487`) → `PATCH /api/v1/leads/[id]` → on `stage_id` change → `processEmailForwardRules()` (route lines ~291-300).
- **Why it doesn't work:** it sends via **Resend**, and **`RESEND_API_KEY` is NOT set on production** → silent no-op (warns, returns, email lost). *Direct cause.*
- **Even if the key were set, it's weak:** Resend-only (generic `noreply@`, **not threaded** into the lead's CRM email history), fire-and-forget (no retry/log/visibility), **stage-change-only** (no other triggers, no delays/sequences), and the `email_account_id` Gmail link is unused.

**Existing substrate we build ON (not from scratch):**
- **Events** are emitted natively (`lead.status_changed`, `lead.created`, `lead.assigned`, …) via `emitEvent()` into an `events` table whose **`status` / `attempts` / `processed_at` columns are unused** — designed for a consume-and-process queue, never wired. (Also the long-standing "wire events → consumer" TODO.)
- **Native threaded send exists:** `gmail-client.sendMessage()` sends from a connected inbox **and threads into `email_threads`/`emails`** (the lead's CRM conversation). Per-user OAuth; `GOOGLE_CLIENT_*` already set on prod.
- **Cron execution pattern exists:** the email-poll worker (GH Actions + VPS crontab → `/api/internal/email/poll`, bearer `INTERNAL_CRON_SECRET`). A "process automations" worker is the same shape.
- **Webhook dispatcher works:** `emitEvent` → `dispatchWebhookEvent` (HMAC-signed, retried, logged to `webhook_deliveries`). 0 endpoints registered. (STATUS-BOARD's "dispatcher isn't consuming" note is outdated — it dispatches synchronously from emitEvent.)

---

## 2. Decisions

- **Engine = native.** Reject n8n as the automation platform — it can't be owned by Orca and lives outside the repo. Build a native engine on the existing event substrate.
- **n8n = optional outbound connector**, not the engine. Native automations get a `webhook` action; via the existing webhook dispatcher, an automation can fire an n8n flow for channels we don't build natively (WhatsApp, Slack, SMS, external sync). Demoted from brain to one delivery arm.
- **Sender identity = Gmail connected inbox (primary, threaded) + Resend (fallback).** Promote the email/inbox-connect feature from **education-only → universal**. Tenants connect a sending inbox; automation emails thread into the lead + come from the real address. Resend (key + sending domain) for tenants with no inbox.
- **Supersede `email_forward_rules`** with the new model; migrate the 2 existing rules; retire the Resend-only processor.

---

## 3. Architecture — three native layers + a worker

1. **Triggers** — events (exist). Enrich payloads with `pipeline_id` + stage slug so matching is cheap.
2. **Automations (the brain seam — data):** an `automations` table. A trigger (event type + conditions) → an ordered list of steps (actions). Tenant-scoped, version-controlled-as-data.
3. **Actions (the hands — typed tools):** each action is a typed, tool-callable function:
   - `send_email` (template; Gmail threaded send, Resend fallback)
   - `wait` (delay N minutes/days → enables sequences)
   - `create_task`, `notify`, `move_stage`, `assign`
   - `webhook` (→ n8n / external channel)
   - *(later)* `orca_draft_email` / `orca_action` (AI-driven)
4. **Worker** — `/api/internal/automations/process` (cron, same auth pattern as email-poll):
   - Consumes `events` rows `status='pending'` → match active automations by trigger+conditions → run/enqueue steps → mark `processed`/`failed` with `attempts`. **This finally wires events → consumer.**
   - Drains a **`scheduled_actions`** due-queue for `wait`/sequence steps.
   - Writes an **`automation_runs`** log (step results, errors) for visibility.

### Data model (sketch — refine in Phase 2)
- `automations(id, tenant_id, name, is_active, trigger_event, conditions jsonb, steps jsonb, created_at, updated_at)`
- `scheduled_actions(id, tenant_id, automation_id, lead_id, run_at, step jsonb, status, attempts)`
- `automation_runs(id, tenant_id, automation_id, lead_id, trigger_event_id, status, step_results jsonb, error, created_at)`
- Reuse `events.status/attempts/processed_at` for the consume loop.

---

## 4. The Orca seam (why native matters)

Because **automations are data** and **actions are typed tools**, Orca plugs in three ways with no re-architecture:
1. **Authors/optimizes** automations (the AI configures the deterministic engine).
2. **Invokes actions directly** as an agent ("send this lead a personalized follow-up now").
3. **Is an action** inside an automation ("when lead → stage X, have Orca draft + send a tailored email").

→ Build the **action layer as a tool registry** (typed input/output) from Phase 1, even before Orca exists. n8n gives none of this.

---

## 5. Phasing

- **Phase 1 — make it work, natively & robustly (MVP).** Stage→email via the **connected inbox (threaded)** + Resend fallback; a **delivery/status log** (kill silent fire-and-forget); promote inbox-connect to universal (so non-education tenants can send); set `RESEND_API_KEY` on prod for fallback. Keep the existing rules UI for now. **Outcome:** Prime/Admizz get real, threaded automation emails, with visibility.
- **Phase 2 — the engine.** `automations` + `scheduled_actions` + `automation_runs` tables; the event-queue worker (wire events→consumer); the **scheduler** (waits/sequences); more triggers (lead.created, etc.) + actions (task/notify/move_stage/webhook); a builder UI superseding `email-rules-manager`. Migrate the 2 v0 rules.
- **Phase 3 — Orca-ready.** Formalize the action **tool registry** + an AI-draft-email action; Orca reads/authors automations + invokes actions; the `webhook` action covers n8n channels.

---

## 6. Open decisions / setup needed

- **Promote email/inbox feature to universal** — confirm (recommended). Touches the manifest gating (it's `FEATURES.EMAIL`, education-only today).
- **Resend** — do we have a Resend account + a verified sending domain for the fallback? (Or run Gmail-only initially and add Resend later.) Need the key on prod regardless if we want fallback.
- **Phase 1 pilot tenant** — Admizz already has 1 connected inbox (can demo threaded automation immediately). Prime needs to connect an inbox (after universal promotion) or use Resend fallback.
- **"Send as" identity** — tenant-level automation sender vs assigned-counselor's inbox (decide in Phase 1 detail).

---

## 7. What this supersedes

`email_forward_rules` + `processEmailForwardRules` (Resend-only, fire-and-forget) → replaced by the native `automations`/action engine with threaded send + a delivery log. Keep the table until the 2 rules are migrated, then retire the legacy processor.
