# Per-Tenant Custom Email Sender — Build Brief

**Author:** Opus (planning brain) · **Executor:** Sonnet (separate session, own branch)
**Date:** 2026-06-11 · **Pilot tenant:** Admizz Education (`febeb37c-521c-4f29-adbb-0195b2eede88`)
**Status:** READY FOR SONNET

---

## 1. Goal

Outbound **automation** emails (form autoresponders + pipeline email-forward rules) currently always send as the global constant `EdgeX <noreply@lead-crm.zunkireelabs.com>`. Make the sender identity **per-tenant**.

For Admizz the target is:
- **Display name:** `Admizz Education`
- **From address:** `hello@admizz.com`
- **Reply-To:** `hello@admizz.com`

**Classification: Global feature** (every tenant will want this). NOT industry-scoped — no `src/industries/` folder. Admizz is just the first configured tenant.

---

## 2. The two-tier reality (why the design is shaped this way)

Resend will **not** send from `hello@admizz.com` until `admizz.com` is **domain-verified** in our Resend account (DKIM/SPF DNS records added on Admizz's side). Until then we must NOT put `hello@admizz.com` in the `from:` field — Resend rejects it / it spam-folders.

So the resolver supports two tiers off **one** config row, gated by a `domain_verified` flag:

| Tier | Condition | `from:` | `reply_to:` |
|---|---|---|---|
| **Tier 1** (ships instantly, no DNS) | `domain_verified = false` | `Admizz Education <noreply@lead-crm.zunkireelabs.com>` | `hello@admizz.com` |
| **Tier 2** (after DNS verifies) | `domain_verified = true` | `Admizz Education <hello@admizz.com>` | `hello@admizz.com` |

**Upgrading Tier 1 → Tier 2 is just flipping the boolean — no redeploy.** Admizz gets the branded name + working replies the moment the code ships; the literal `hello@` from-address turns on when their DNS lands. The DNS work runs in parallel (see §8 — that's an Opus/Sadin runbook, not Sonnet's).

---

## 3. Scope (one branch: `feature/tenant-email-sender`)

- **Phase 1** — migration + resolver
- **Phase 2** — wire resolver into the two automation senders
- **Phase 3** — minimal admin Settings card + API route

Self-serve domain verification (Resend Domains API, DNS display, polling) is **deliberately out of scope** — that's the later "scalable part." For the pilot, `domain_verified` is flipped manually (SQL/owner) once Resend confirms.

**Do NOT touch** `send-invite.ts` or `send-lead-assigned.ts` — those are platform/system emails and must stay EdgeX-branded. Sending an invite "from Admizz" would be wrong.

---

## 4. Phase 1 — Schema + resolver

### 4a. Migration `supabase/migrations/045_tenant_email_settings.sql`

```sql
CREATE TABLE IF NOT EXISTS tenant_email_settings (
  tenant_id        UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  from_name        TEXT,            -- e.g. "Admizz Education"
  from_address     TEXT,            -- e.g. "hello@admizz.com" (used ONLY when domain_verified)
  reply_to         TEXT,            -- e.g. "hello@admizz.com"
  domain_verified  BOOLEAN NOT NULL DEFAULT false,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE tenant_email_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view email settings"
  ON tenant_email_settings FOR SELECT
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY "Tenant admins can mutate email settings"
  ON tenant_email_settings FOR ALL
  USING (is_tenant_admin(tenant_id))
  WITH CHECK (is_tenant_admin(tenant_id));

CREATE POLICY "Service role full access to email settings"
  ON tenant_email_settings FOR ALL
  USING (auth.role() = 'service_role');
```

One row per tenant (`tenant_id` is the PK). Dedicated table (not columns on `tenants`) keeps the core table lean, RLS-isolated, and leaves room for future fields (footer, bcc, Resend domain id for the scalable phase).

> ⚠️ **Migration discipline:** write the file and STOP. Do **not** apply it to the shared Supabase DB — Opus applies migrations after review (the shared dev+prod DB rule). Flag in your handoff that 045 is ready to apply.

### 4b. Resolver `src/lib/email/sender.ts` (new file)

```ts
import { createServiceClient } from "@/lib/supabase/server";
import { EMAIL_FROM } from "./index";

const PLATFORM_ADDRESS = "noreply@lead-crm.zunkireelabs.com";

export type ResolvedSender = { from: string; replyTo?: string };

// Strip anything that could break the RFC 5322 header (CR/LF/angle brackets).
function sanitizeName(name: string): string {
  return name.replace(/[\r\n<>]/g, "").trim().slice(0, 120);
}
function isValidEmail(addr: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr);
}

/**
 * Resolve the outbound sender identity for a tenant's AUTOMATION emails.
 * Falls back to the global EdgeX sender on any miss/error — never throws.
 * @param nameOverride optional per-rule display-name override (email-forward rules)
 */
export async function resolveTenantSender(
  tenantId: string,
  opts?: { nameOverride?: string }
): Promise<ResolvedSender> {
  try {
    const supabase = await createServiceClient();
    const { data } = await supabase
      .from("tenant_email_settings")
      .select("from_name, from_address, reply_to, domain_verified")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    const rawName = opts?.nameOverride || data?.from_name || "EdgeX";
    const name = sanitizeName(rawName) || "EdgeX";

    const customAddr =
      data?.from_address && isValidEmail(data.from_address) ? data.from_address : null;

    // Custom address ONLY when the domain is verified. Otherwise brand the name
    // on our verified domain and route replies to the tenant address.
    const address = data?.domain_verified && customAddr ? customAddr : PLATFORM_ADDRESS;

    const replyToRaw = data?.reply_to || customAddr || null;
    const replyTo = replyToRaw && isValidEmail(replyToRaw) ? replyToRaw : undefined;

    return { from: `${name} <${address}>`, replyTo };
  } catch {
    return { from: EMAIL_FROM };
  }
}
```

Key guards (do not drop any):
- **Header-injection safe** — `sanitizeName` strips CR/LF/`<>`.
- **`domain_verified` is the safety gate** — a half-configured tenant can never send from an unverified domain (which would silently fail).
- **Reply-To works in BOTH tiers** — that's what makes Tier 1 useful immediately.
- **Total fallback to `EMAIL_FROM`** on any error so a bad row never kills an autoresponder.

---

## 5. Phase 2 — Wire it in

### 5a. `src/lib/email/form-autoresponder.ts`
Replace the hardcoded `from: EMAIL_FROM` (line ~68). The function already has `lead.tenant_id`.

```ts
const sender = await resolveTenantSender(lead.tenant_id);
// ...
const { data, error } = await resend.emails.send({
  from: sender.from,
  ...(sender.replyTo ? { replyTo: sender.replyTo } : {}),
  to: lead.email,
  subject,
  html: bodyHtml,
});
```

### 5b. `src/lib/email/email-forward.ts`
Replace the `from_name`-only block (lines ~89-92). The per-rule `from_name` becomes a name **override** on top of the tenant default:

```ts
const sender = await resolveTenantSender(lead.tenant_id, { nameOverride: rule.from_name ?? undefined });
// ...
const { data, error: sendError } = await resend.emails.send({
  from: sender.from,
  ...(sender.replyTo ? { replyTo: sender.replyTo } : {}),
  to: lead.email!,
  subject,
  html: body,
});
```
(Confirm the tenant id var in scope — use whatever holds the lead's tenant. Resolve once before the send.)

> **Resend SDK field name:** verify whether the installed `resend` version expects `replyTo` (camelCase) or `reply_to` in `emails.send()`. Match the version in `package.json`. Get this right — a wrong key silently drops the Reply-To.

---

## 6. Phase 3 — Minimal admin Settings card + API

Goal: let an admin set name / from / reply-to without raw SQL. Keep it minimal — **no** self-serve domain verification here.

### 6a. API `src/app/(main)/api/v1/settings/email-sender/route.ts`
- `GET` — return the tenant's `tenant_email_settings` row (or empty defaults). Auth required.
- `PUT` — upsert `from_name`, `from_address`, `reply_to` for `auth.tenantId`. **Admin-only** (`auth.role` owner/admin, mirror how `email-rules` routes gate). Set `updated_by = auth.userId`, `updated_at = now()`.
- **`domain_verified` is NOT writable through this route** — it's backend/Opus-controlled. Ignore it if sent.
- Validate `from_address`/`reply_to` are well-formed emails (reuse the regex). Use `scopedClient(auth)` for the read; the upsert can use scoped client (tenant_id auto-injected) — supply `tenant_id` explicitly on insert since it's the PK.

### 6b. UI card `src/components/dashboard/settings/email-sender-card.tsx`
- Render in the Settings page near `email-rules-manager`. Admin-only (hide for non-admins).
- Fields: **Display name**, **From address**, **Reply-To**.
- A read-only **status badge**: `domain_verified ? "Verified — sending from your domain" : "Pending verification — sending as your name from EdgeX, replies go to you"`.
- A short helper line under From address: *"To send from your own domain we need to verify it — your admin will receive DNS records to add."* (Sets expectations; the actual verification flow is the later scalable phase.)
- Save → `PUT`, toast on success, optimistic display update.

---

## 7. Test plan (safe smoke — shared dev+prod DB)

Per the safe-live-smoke protocol: use a **real test recipient you control** for the autoresponder (the email goes to the *submitter*). Test recipient = `sadin@zunkireelabs.com` (NOT the system-context userEmail — that's a client). Do NOT use `@zunkiree.invalid` here (you need to actually receive + inspect the From/Reply-To headers).

1. **Build gates** — `npm run build` clean + `npx eslint --max-warnings 50 .` → 0 errors. (Opus re-runs both before any merge.)
2. **Tier 1 (no DNS):** seed Admizz row `from_name="Admizz Education"`, `from_address="hello@admizz.com"`, `reply_to="hello@admizz.com"`, `domain_verified=false`. Submit a test lead (recipient `sadin@zunkireelabs.com`) to an Admizz form with autoresponder enabled → confirm inbox shows **From: Admizz Education**, address `noreply@lead-crm...`, **Reply-To: hello@admizz.com**. Check `automation_email_log` row = `sent`.
3. **Tier 2 (simulate verified):** flip `domain_verified=true` → resend → From now `Admizz Education <hello@admizz.com>`. (Only do this against a *verified* domain — see §8; before DNS lands, a Tier-2 send to a real mailbox may bounce/spam, so keep `domain_verified=false` until Resend confirms.)
4. **Fallback:** a tenant with no row → still sends as `EdgeX <noreply@...>` (unchanged behavior). Verify Prime/another tenant's autoresponder is untouched.
5. **Platform emails untouched:** invite + lead-assigned still EdgeX.
6. Clean up any test lead rows (guarded, tenant-scoped).

**STOP at review.** Do not merge to stage, do not apply migration 045, do not push. Hand back to Opus with: branch name, files changed, gate output, and confirmation 045 is written-but-unapplied.

---

## 8. Admizz domain verification runbook (Opus/Sadin — runs in PARALLEL, not Sonnet)

This is the real-world dependency that makes Tier 2 real. **Not a code task.**

1. **Coordinate first — `hello@admizz.com` is almost certainly a live Google Workspace mailbox** Admizz reads replies in. Adding Resend is *additive* (Resend uses its own DKIM selector), but **SPF must be appended, not replaced** — admizz.com's existing `v=spf1 ... include:_spf.google.com ...` needs Resend's include added, not overwritten. Get whoever runs admizz.com DNS in the loop.
2. **Add `admizz.com` as a domain in the Resend dashboard** (our single Resend account) → Resend emits DKIM (CNAME/TXT), SPF, and DMARC records.
3. **Send those records to Admizz's IT** to add to `admizz.com` DNS (append to SPF).
4. **Wait for Resend to show "Verified"** (minutes–days, DNS propagation).
5. **Flip `tenant_email_settings.domain_verified = true`** for Admizz → Tier 2 live, no redeploy.

Deliverability note: best practice is a sending **subdomain** (e.g. `mail.admizz.com`) to keep automation reputation off the corporate root domain. If Admizz wants the bare `hello@admizz.com` visible, verify the root and use Resend's custom return-path — fine, just flag the trade-off to Sadin.

---

## 9. Definition of done (for Opus review)

- [ ] `045_tenant_email_settings.sql` written (NOT applied), RLS correct.
- [ ] `resolveTenantSender` with all four guards (sanitize, valid-email, verified-gate, total fallback).
- [ ] Both automation senders wired; invite + lead-assigned untouched.
- [ ] Settings card + API; admin-gated; `domain_verified` not user-writable.
- [ ] Both gates green; Tier 1 smoke proven with a real recipient.
- [ ] Stopped at review — nothing merged/applied/pushed.

---

## 10. Sonnet handoff prompt

> Build the per-tenant custom email sender per `docs/CUSTOM-EMAIL-SENDER-BRIEF.md`. Work on a new branch `feature/tenant-email-sender` off `stage`. Scope = Phases 1–3 in the brief (migration 045 + `src/lib/email/sender.ts` resolver + wire into `form-autoresponder.ts` and `email-forward.ts` + a minimal admin Settings card & `GET/PUT /api/v1/settings/email-sender`). Do NOT touch `send-invite.ts` / `send-lead-assigned.ts`. Honor every guard in §4b. **Write migration 045 but do NOT apply it** to the shared Supabase DB. Run `npm run build` and `npx eslint --max-warnings 50 .` (0 errors) before you stop. **Stop at review — do not merge to stage, do not apply the migration, do not push to any shared branch.** Report: branch name, files changed, gate output, and that 045 is written-but-unapplied. Confirm the Resend SDK reply-to field name against the installed version.
