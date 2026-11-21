# BRIEF — Email body: store the format, stop guessing it

**Status:** approved, ready to execute
**Owner:** Sonnet executor session
**Branch off:** `origin/stage`
**Scope:** `src/lib/email/*`, email-rules API routes, two editor surfaces, one migration
**Prereq context:** PR #435 (`3c1f0ef3`, on stage) — this brief fixes a defect that survived it

---

## 1. The problem (verified, not theoretical)

PR #435 let admins paste real designed HTML into two email-body surfaces:

- Form Builder → confirmation email (`form_configs.autoresponder.body_html`, JSONB)
- Settings → Email Rules (`email_forward_rules.body`, TEXT column)

Both send paths run `preserveLineBreaks()` (`src/lib/email/render-template.ts`), which converts
a `\n` to `<br>` unless it directly touches `>` on the left or `<` on the right.

That per-newline rule correctly leaves tag-to-tag whitespace alone (`</td>\n<tr>` survives).
**It does not protect the inside of a `<style>` block.** A newline in CSS sits between `,` and a
space, or `{` and a space — neither neighbor is a bracket, so it converts.

Reproduced against a realistic Beefree/Stripo-style export (30-line sample → 12 injected `<br>`,
essentially all inside the CSS):

```
<style>
.row-1 .column-1 .block-3.paragraph_block td.pad>div,<br>.row-2 ... h1 {<br>  color: #101112;<br>
@media (max-width:700px) {<br>  .desktop_hide table.icons-inner,<br>
```

Browsers treat `<style>` content as raw CSS text, so `<br>` is not parsed as a tag — it corrupts
the selector and kills that rule (and the rest of the comma-list). Net effect on a real pasted
template: **media queries and hover states break in the delivered email.** Mobile layout is the
visible casualty.

Second, format-dependent case: a tag whose attributes span multiple lines gets a `<br>` spliced
*inside* the tag —

```
<table class="nl-container" width="100%" border="0"<br>       cellpadding="0" ...>
```

Most exporters keep tags on one line, so this may not bite today's template. It will bite one later.

**Silent-failure trap:** `html-source-editor.tsx` renders its Preview tab as
`<iframe srcDoc={value}>` — the *raw* value, with no `preserveLineBreaks`. The builder preview
looks perfect while the sent email is corrupted. Only "Send Test Email" tells the truth.

### Why not another heuristic

This is the third attempt at inferring intent from the string: unconditional `\n → <br>` →
`looksLikeHtml()` (false-positived on `John <john@example.com>`) → `preserveLineBreaks()` (leaks
into `<style>`). Each fix relocated the leak. The editor already *knows* the admin is authoring
HTML source — persist that fact instead of re-deriving it at send time.

---

## 2. What to build

Add an explicit, persisted body format to both surfaces. `"html"` means send verbatim; `"text"`
means run the existing `preserveLineBreaks()`.

### 2.1 Migration `213_email_body_format.sql`

> Stage's highest migration is `211`. `212_email_blasts.sql` is already claimed by the in-flight
> `feature/email-blast` branch — **use `213`, do not reuse `212`.**

```sql
ALTER TABLE email_forward_rules
  ADD COLUMN IF NOT EXISTS body_format TEXT NOT NULL DEFAULT 'text'
  CHECK (body_format IN ('text', 'html'));
```

Additive, transactional, `IF NOT EXISTS`, with a rollback line and before/after counts per the
`_TEMPLATE.sql` convention. `'text'` default is deliberate: every existing rule was authored as
plain text and must keep rendering exactly as it does today.

`form_configs.autoresponder` is JSONB — **no migration needed**, just add the key.

### 2.2 Type changes

`src/types/database.ts`:

```ts
autoresponder?: {
  enabled: boolean;
  fire_mode: "every" | "first";
  subject: string;
  body_html: string;
  body_format?: "text" | "html";   // absent === "text" (back-compat)
};
```

Add `body_format` to the `email_forward_rules` row type the same way.

### 2.3 Send paths — all three call sites

Introduce one helper next to `preserveLineBreaks` so the decision lives in exactly one place:

```ts
export function renderEmailBody(
  template: string,
  ctx: Parameters<typeof renderTemplate>[1],
  format: "text" | "html" | null | undefined
): string {
  const rendered = renderTemplate(template, ctx, { escape: true });
  return format === "html" ? rendered : preserveLineBreaks(rendered);
}
```

Keep `{ escape: true }` in both branches — that escapes substituted **token values**, not the
template, and it is the fix for the injection gap #435 closed in `email-forward.ts`. Do not drop it.

Update every current caller:

| File | Line (stage) | Change |
|---|---|---|
| `src/lib/email/form-autoresponder.ts` | 57 | `renderEmailBody(ar.body_html, renderCtx, ar.body_format)` |
| `src/lib/email/email-forward.ts` | 89 | `renderEmailBody(rule.body, renderCtx, rule.body_format)` |
| `src/app/(main)/api/v1/settings/email-rules/[id]/test/route.ts` | 73 | honor `rule.body_format` — see below |

The test route currently does `preserveLineBreaks(rule.body.replace(/\{\{\w+\}\}/g, "Sample"))`.
It must make the same format decision as the real send path, or the test email again stops
matching what ships. It also prepends a yellow "This is a test email" banner `<div>` — when
`body_format === 'html'` the body is a full `<!DOCTYPE html>` document, and prepending a `<div>`
before `<!DOCTYPE>` produces an invalid document that some clients render oddly. **For
`body_format === 'html'`, put the notice in the subject line instead** (e.g. prefix `[TEST] `) and
send the body untouched. Keep the existing banner behavior for `'text'`.

### 2.4 API routes — persist and validate

`src/app/(main)/api/v1/settings/email-rules/route.ts` (POST) and `[id]/route.ts` (PATCH):
accept `body_format`, validate it is `'text' | 'html'`, reject anything else with
`apiValidationError`. Keep the existing 100k `maxLength` cap on `body` that #435 added.

Whatever route persists `form_configs.autoresponder` must pass `body_format` through in the JSONB.

### 2.5 UI — two surfaces

`src/industries/_shared/features/email/components/html-source-editor.tsx`:

- Add `format` + `onFormatChange` props.
- Add a small **Rich text / HTML source** toggle in the existing `TabsList` row.
- In `'text'` mode: hide the Source/Preview tabs, show the plain textarea, and render the
  Preview through `preserveLineBreaks(value)` so preview matches send.
- In `'html'` mode: current behavior (Source/Preview tabs, raw `srcDoc`).
- **Keep `forceMount` on both `TabsContent` panels.** #435 fixed a real bug there — Radix unmounts
  inactive panels by default, which nulls the textarea ref and silently breaks the merge-tag
  insert-at-cursor buttons. Do not regress it.
- Under the Preview in `'html'` mode, keep the existing "structural preview only" caption and add
  that line breaks are sent verbatim in HTML mode.

Wire the toggle into both consumers:
- `src/industries/_shared/features/form-builder/components/autoresponder-editor.tsx`
- `src/components/dashboard/settings/email-rules-manager.tsx`

Default an **existing** record with no stored format to `'text'`. Default a **new** record created
via the HTML editor to whatever the toggle shows; `'text'` is the safer initial position.

---

## 3. Back-compat requirement (non-negotiable)

Every email authored before this change must render **byte-identically** after it. `body_format`
absent or `'text'` → the exact current `preserveLineBreaks` path. Verify this with tests, not by
inspection.

---

## 4. Tests

Extend `src/lib/email/render-template.test.ts`:

- `renderEmailBody(..., 'html')` leaves a `<style>` block's newlines untouched — assert the
  `td.pad>div,` comma-list selector survives intact with zero `<br>` inside `<style>`.
- `renderEmailBody(..., 'html')` leaves a multi-line-attribute `<table ...>` tag intact.
- `renderEmailBody(..., 'text')` and `renderEmailBody(..., undefined)` and
  `renderEmailBody(..., null)` all produce exactly what `preserveLineBreaks(renderTemplate(...))`
  produces today (back-compat lock).
- Token escaping still applies in **both** modes: a lead field value of
  `<img src=x onerror=alert(1)>` comes out escaped in `'html'` mode too.
- Keep every existing `preserveLineBreaks` case in the file passing — do not delete that function
  or its tests; `'text'` mode still uses it.

---

## 5. Verification before opening the PR

Per `feedback_no_pr_without_local_verification` — green unit tests are not sufficient for a UI
phase.

1. `npm run test` green, `npm run build` clean, `npx eslint --max-warnings 50` clean.
2. Apply `213` to the **local** Supabase stack only (`./scripts/local-db-setup.sh` flow).
   **Do not touch stage or prod DBs** — the migration rides the deploy pipeline.
3. On local `npm run dev`, as an `education_consultancy` tenant:
   - Form Builder → confirmation email → toggle **HTML source** → paste a real multi-line export
     containing a `<style>` block with a media query → save → reload → confirm it round-trips.
   - Submit the public form → inspect the row in `automation_email_log` and the outbound HTML →
     **assert zero `<br>` inside `<style>`**.
   - Settings → Email Rules → same toggle → "Send Test Email" → confirm the received mail matches
     the Preview tab.
   - An **existing** plain-text rule and an **existing** plain-text autoresponder still render with
     their line breaks intact and show the toggle in **Rich text**.
4. **Screenshots required** in the PR: the toggle in both positions, and the received HTML email
   rendering correctly on mobile width (the media query is the whole point).

---

## 6. Guardrails

- **No database access.** No migrations applied to stage or prod, no ad-hoc SQL, no Supabase MCP
  writes. Write the migration file; the pipeline applies it. (`CLAUDE.md` — Do Not Touch The Database.)
- Branch from the **latest** `origin/stage`; rebase onto it again right before merge.
- **Stop at review.** Open the PR to `stage` and hand the report back. Do **not** self-merge, do not
  promote to `main`, do not apply migrations. (`feedback_sonnet_oversteps_review_gate`.)
- Land this as **one branch, one PR** covering the whole fix — migration + send paths + routes + UI
  + tests together. Do not merge incremental slices separately.
  (`feedback_finish_features_end_to_end`.)
- Use migration number **213**. Do not reuse `212`.

---

## 7. Interim workaround (already communicated, unblocks today)

Until this ships, an admin pasting a pretty-printed template must **minify it to a single line**
first. No newlines → nothing for `preserveLineBreaks` to act on. This is a genuine workaround, not
a mask over a wrong diagnosis. Note in the PR description that it stops being necessary once
`body_format` lands.

**Prod promotion of #435 should wait** for either this fix or a documented minify-only instruction
to the tenant.

---

## 8. ADDENDUM — fix the autoresponder PATCH clobber (same branch, before merge)

**Added after review of PR #437. Land this on `feature/email-body-format`, not a follow-up PR.**

### The defect

`src/app/(main)/api/v1/form-configs/[id]/route.ts` PATCH replaces the entire `autoresponder`
JSONB object from whatever the caller sent:

```ts
if (body.autoresponder !== undefined) {
  const raw = (body.autoresponder ?? {}) as Record<string, unknown>;
  const normalized: FormConfig["autoresponder"] = {
    enabled: Boolean(raw.enabled ?? false),
    fire_mode: raw.fire_mode === "first" ? "first" : "every",
    subject: typeof raw.subject === "string" ? raw.subject.slice(0, 998) : "",
    body_html: typeof raw.body_html === "string" ? raw.body_html.slice(0, 100_000) : "",
    body_format: raw.body_format === "html" ? "html" : "text",
  };
  updatePayload.autoresponder = normalized;
}
```

Any caller that sends a **partial** `autoresponder` object silently destroys the keys it omitted.
Concretely, `PATCH { autoresponder: { enabled: false } }` wipes `subject` and `body_html` to `""`,
resets `fire_mode` to `"every"`, and — the reason this matters now — **downgrades `body_format`
from `"html"` back to `"text"`. The next send then re-runs `preserveLineBreaks` over the admin's
pasted HTML and re-corrupts the `<style>` block, silently undoing everything this branch fixes.**

The dashboard UI always sends the complete object, so this does not fire today. It is a live trap
for the integration API, any future caller, and any partial-save the UI might add later.

**Fix all five keys, not just `body_format`.** A merge that rescues only the new field while
leaving `subject`/`body_html` clobberable is arbitrary — the shape of the bug is the whole-object
replacement, so fix the shape.

### The fix

The handler **already** does a tenant-scoped fetch near the top of PATCH:

```ts
.from("form_configs").select("id, slug").eq("id", id).eq("tenant_id", auth.tenantId).single();
if (!existing) return apiNotFound("Form config");
```

Add `autoresponder` to that existing `select` — **no second query, already tenant-scoped, already
404s correctly.** Then merge per key, overwriting only what the caller actually provided:

```ts
if (body.autoresponder !== undefined) {
  const prev = (existing.autoresponder ?? {}) as Partial<NonNullable<FormConfig["autoresponder"]>>;
  // Explicit null means "reset to defaults" — preserve today's behavior for that case.
  const isReset = body.autoresponder === null;
  const raw = (body.autoresponder ?? {}) as Record<string, unknown>;
  const base = isReset
    ? { enabled: false, fire_mode: "every" as const, subject: "", body_html: "", body_format: "text" as const }
    : prev;

  const normalized: FormConfig["autoresponder"] = {
    enabled: raw.enabled !== undefined ? Boolean(raw.enabled) : (base.enabled ?? false),
    fire_mode:
      raw.fire_mode !== undefined
        ? (raw.fire_mode === "first" ? "first" : "every")
        : (base.fire_mode ?? "every"),
    subject:
      typeof raw.subject === "string" ? raw.subject.slice(0, 998) : (base.subject ?? ""),
    body_html:
      typeof raw.body_html === "string" ? raw.body_html.slice(0, 100_000) : (base.body_html ?? ""),
    body_format:
      raw.body_format !== undefined
        ? (raw.body_format === "html" ? "html" : "text")
        : (base.body_format ?? "text"),
  };
  updatePayload.autoresponder = normalized;
}
```

Requirements this must satisfy:

- **Keep the length caps** (998 / 100_000) on any caller-supplied value. Don't re-cap the
  previously stored value — it was already capped on the way in.
- **`autoresponder: null` still resets to defaults.** That's today's behavior; don't turn an
  explicit clear into a no-op.
- **An absent key means "leave alone", not "reset".** That's the entire point.
- **A form with no autoresponder yet** (`existing.autoresponder` is null/undefined) must still work
  — `prev` falls back to `{}` and each `?? default` supplies the old default.

### Tests (add to the existing suite)

These are route-level, so follow whatever pattern the repo already uses for API-route tests; if
there is none for this route, extract the normalization into a small exported pure function
(e.g. `normalizeAutoresponder(prev, raw)`) in the same file and unit-test that directly. Prefer the
pure-function extraction — it's testable without mocking Supabase.

- Partial PATCH `{ enabled: false }` against a stored `body_format: 'html'` record → `body_format`
  stays `'html'`, `subject` and `body_html` unchanged, `enabled` becomes `false`.
- Partial PATCH `{ body_html: '<html>…' }` → `body_format` unchanged.
- Full PATCH from the UI (all five keys) → behaves exactly as it does today.
- `autoresponder: null` → all five keys reset to defaults.
- Record with no prior autoresponder + partial PATCH → old defaults applied, no crash.
- Length caps still enforced on caller-supplied `subject` / `body_html`.

### Verification

- `npm run test`, `npm run build`, `npx eslint --max-warnings 50` all clean.
- On local dev: save an HTML-mode confirmation email, then toggle the form's **Active** switch (or
  any save path that doesn't touch the email body) → reopen the autoresponder editor → confirm it
  is **still in HTML source mode with the body intact**. That's the regression this prevents, and
  it's a click-through, not a unit test.

### Guardrails (unchanged)

Same branch, same PR (#437). Do not open a second PR. Rebase onto latest `origin/stage` before the
final push. **Stop at review — do not merge or promote.** No DB access; migration 213 stays unapplied
to stage/prod.
