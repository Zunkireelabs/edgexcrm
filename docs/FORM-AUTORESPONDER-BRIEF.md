# Sonnet Handoff Brief — Per-Form Email Autoresponder

> **You are Sonnet, the executor.** Implement exactly what's below on a feature branch. **STOP at "Done — ready for review." Do NOT merge, do NOT push to `stage`/`main`, do NOT apply the migration to the shared Supabase, do NOT run prod tooling.** Opus reviews your diff post-hoc and runs the live smoke. (You have self-merged past this gate before — don't.)

---

## What you're building

A **per-form email autoresponder**: a confirmation/receipt email sent to the form submitter on submission, with merge-tags that echo back submitted form-field values. Configured per form in the form builder. Built as a forward-compatible slice of the future Phase 2 automation engine — it reuses the Resend send lane, routes every send through a new shared `automation_email_log` table, and uses one shared merge-tag engine.

### Why (context)
Today the only email a submitter gets is via `email_forward_rules`, keyed by `stage_id` and tenant-wide — so every form landing a lead in `new` sends the *same* email, with no per-form customization and no way to echo the form's own fields. This adds form-owned, dynamic receipts (standard CRM pattern: HubSpot form follow-up emails, Salesforce Web-to-Lead auto-response).

### Locked decisions (do not re-litigate)
- **Storage:** JSONB `autoresponder` column on `form_configs` — NOT a child table. Matches existing `steps`/`branding`/`attribution` pattern, saved via the existing form-config PATCH flow.
- **Fire-mode:** configurable per form — `'every'` submission vs `'first'`-time lead only.
- **Scope:** v1 = subject + HTML body + merge-tags only. **No attachments. No sequences. No delays.**
- **Architecture:** reuse Resend lane + new shared `automation_email_log` (migration **041**) + one extracted merge engine. Do not create a third email subsystem.
- **Industry gating:** inherits the FORM_BUILDER gate (education_consultancy + construction). Add NO new gate.

---

## Branch
Branch off **`stage`**: `feat/form-autoresponder`. Commit trailer on every commit:
```
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```
(The repo's commit-msg hook may rewrite the co-author line — that's expected, leave it.)

---

## Implementation steps

### 1. Migration `041` — shared send log
Create `supabase/migrations/041_automation_email_log.sql`. (039/040 are taken — 041 is the next number. **Write the file only; do NOT apply it to the shared Supabase.** Opus applies to a throwaway/local DB during review.)

```sql
create table automation_email_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  lead_id uuid references leads(id) on delete set null,
  form_config_id uuid references form_configs(id) on delete set null,
  source text not null check (source in ('form_autoresponder','stage_rule')),
  to_email text not null,
  subject text,
  status text not null check (status in ('sent','failed')),
  error text,
  provider_message_id text,
  created_at timestamptz not null default now()
);
create index idx_automation_email_log_tenant on automation_email_log(tenant_id);
create index idx_automation_email_log_lead on automation_email_log(lead_id);

alter table automation_email_log enable row level security;
create policy "members read" on automation_email_log for select
  using (tenant_id in (select get_user_tenant_ids()));
create policy "service all" on automation_email_log for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
```
`source` includes `'stage_rule'` for future use, but **v1 only ever writes `'form_autoresponder'` rows.** Do NOT route the existing stage rules through this log (deferred fast-follow).

### 2. Shared merge engine — `src/lib/email/render-template.ts` (new)
Signature:
```ts
renderTemplate(
  template: string,
  ctx: { lead: Lead; tenant?: { name?: string }; formConfig?: FormConfig; extra?: Record<string, unknown> },
  opts?: { escape?: boolean }
): string
```
Rules:
- Replace `{{token}}` tokens. Build the lookup map as **`lead.custom_fields` first, then standard lead columns on top** (so `first_name, last_name, email, phone, city, country` win on key collision), plus `tenant` → `{{tenant_name}}`, plus `extra`.
- **Missing/empty token → empty string** (do NOT leave `{{token}}` raw — this is public-facing email; that's the opposite of `interpolateTemplate` in `smtp-sender.ts`).
- `opts.escape === true` → HTML-escape **each substituted value** (escape `& < > " '`). The admin's template HTML itself stays unescaped. **This is the #1 correctness item — field values land in an HTML body.**
- Refactor `src/lib/email/email-forward.ts` to call `renderTemplate`: remove the hardcoded `templateVars` object (~lines 71-79) and the two `interpolateTemplate` calls (~96-97), replacing with `renderTemplate(...)`. Preserve existing behavior (the same tokens must still resolve). **Leave `interpolateTemplate` in `smtp-sender.ts` untouched** — the SMTP/Gmail lane still uses it.

### 3. Trigger hook — `src/lib/email/form-autoresponder.ts` (new)
```ts
processFormAutoresponder(
  formConfig: FormConfig,
  lead: Lead,
  opts: { isResubmission: boolean; tenant?: { name?: string } }
): Promise<void>
```
- No-op if `formConfig.autoresponder?.enabled !== true`.
- Fire-mode gate: `'every'` → always; `'first'` → only when `!opts.isResubmission`.
- Skip (no-op) if `lead.email` is falsy/empty.
- Render `subject` with `escape:false`, `body_html` with `escape:true` via `renderTemplate`. Send via the existing Resend client + `EMAIL_FROM` from `src/lib/email/index.ts`, `to: lead.email`.
- After the send attempt, best-effort insert ONE `automation_email_log` row (`source:'form_autoresponder'`, `tenant_id`, `lead_id`, `form_config_id`, `to_email`, `subject`, `status` `'sent'`/`'failed'`, `error`, `provider_message_id` from the Resend response). Wrap in try/catch — log failure must never throw out of the function.
- Fully fire-and-forget — callers `void`/`.catch()` it; it must never reject into the request path.

### 4. Wire into the public submit route
`src/app/api/public/submit/[tenantSlug]/[formSlug]/route.ts`:
- **Must-fix first:** add `autoresponder` to the explicit `form_configs` `.select(...)` (~lines 165-166), or the hook never sees config.
- **Dedup-update path** (~lines 260-358): after the existing `processEmailForwardRules` call, add `void processFormAutoresponder(formConfig, canonical as Lead, { isResubmission: true, tenant })`.
- **New-insert path** (~lines 596-606, after the existing rule call): add `void processFormAutoresponder(formConfig, <new lead incl. custom_fields>, { isResubmission: false, tenant })`. **The lead you pass must include `leadPayload.custom_fields`** — the existing rule call only passes 4 fields, but the autoresponder needs custom_fields for merge-tags. Build/extend the lead object accordingly.
- **Do NOT add the hook** to the email-unique-index race return (~lines 431-473) — it fires neither processor today; keep parity.
- Match the existing fire-and-forget style (no `await` blocking the response).

### 5. Persist config on save
`src/app/(main)/api/v1/form-configs/[id]/route.ts` (~lines 117-130): add an `autoresponder` branch in the PATCH handler mirroring how `attribution` is normalized/persisted. **Normalize server-side** — validate shape `{ enabled: boolean, fire_mode: 'every'|'first', subject: string, body_html: string }`; don't persist a raw client blob. Default `enabled:false`.

### 6. TypeScript type
Add `autoresponder?: { enabled: boolean; fire_mode: 'every' | 'first'; subject: string; body_html: string }` to the `FormConfig` type (wherever `steps`/`branding`/`attribution` are typed — likely `src/types/database.ts`).

### 7. Builder UI — new "Confirmation Email" tab
Shared form builder at `src/industries/_shared/features/form-builder/`:
- New `components/autoresponder-editor.tsx` — mirror `components/attribution-editor.tsx` structure. Controls: enable toggle, fire-mode radio (`every` = "Send on every submission", `first` = "Send only the first time"), subject input, body textarea, and a **merge-tag helper** that lists available tokens: enumerate `state.steps[*].fields[*].name` (these are exactly the `custom_fields` keys) plus the standard set (`first_name, last_name, email, phone, city, country, tenant_name`). Show them as clickable/copyable `{{token}}` chips.
- State wiring (mirror how `attribution` is wired):
  - `lib/types.ts`: add `autoresponder` to `BuilderState`, add `SET_AUTORESPONDER` action.
  - `lib/use-form-builder.ts`: reducer case (mirror `SET_ATTRIBUTION` ~line 116), default in `buildInitialState`, and include `autoresponder` in the `save()` PATCH body (~lines 168-177).
  - `components/form-builder-page.tsx`: add the 5th tab ("Confirmation Email").
- Inline warning in the editor: "A stage-based welcome rule on the entry stage will also fire on submission — both emails may send." Warn, don't block.
- Help text noting this is a transactional receipt (keep content transactional).

---

## Files
**New:** `supabase/migrations/041_automation_email_log.sql`, `src/lib/email/render-template.ts`, `src/lib/email/form-autoresponder.ts`, `src/industries/_shared/features/form-builder/components/autoresponder-editor.tsx`
**Edit:** `src/lib/email/email-forward.ts`, `src/app/api/public/submit/[tenantSlug]/[formSlug]/route.ts`, `src/app/(main)/api/v1/form-configs/[id]/route.ts`, `src/types/database.ts` (FormConfig type), `src/industries/_shared/features/form-builder/lib/types.ts`, `.../lib/use-form-builder.ts`, `.../components/form-builder-page.tsx`

---

## Definition of done (what you verify before stopping)
- [ ] `npm run build` clean.
- [ ] `npx eslint --max-warnings 50 .` → 0 errors.
- [ ] All new files + edits compile; no `any`-casts beyond the `canonical as Lead` already noted.
- [ ] Self-review: confirm BOTH hook call sites pass `custom_fields`; confirm merge values are HTML-escaped in the body; confirm the log insert is wrapped so it can't throw.

**Then STOP and report: branch name, files changed, build + lint results, and anything you were unsure about. Do not merge, push to stage/main, apply the migration to shared Supabase, or run any deploy/prod tooling.** Opus takes over for post-hoc review + live smoke.

## Explicitly out of scope (do not build)
File attachments; routing stage rules through the log; mirroring sends into the lead email timeline; per-submission (vs canonical) merge echo; sequences/delays.
