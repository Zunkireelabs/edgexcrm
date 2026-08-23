# Tenant Custom Sending Domain — Manual Phase (Pilot: Admizz)

**Author:** Opus (planning brain) · **Executors:** Sadin (Resend + DNS + DB flip), Sonnet (code) · **Reviewer:** Opus
**Date:** 2026-08-23 · **Pilot tenant:** Admizz Education
**Status:** READY

---

## 1. Goal

Let a paying tenant send EdgeX's tenant-facing automated email from **their own domain**.

Pilot target:
- **Domain:** `admizz.com`
- **From:** `Admizz Education <hello@admizz.com>`
- **Reply-To:** `hello@admizz.com`
- **Replies:** land in Admizz's own mailbox. **No inbound/MX integration in this phase.**

**Deliberately manual.** Domain onboarding is done by us in the Resend dashboard, not self-serve
by the tenant. Self-serve (Resend Domains API + DNS-record UI + verification polling) is a later
phase, justified only once tenant count makes manual onboarding the bottleneck.

---

## 2. What already exists (do NOT rebuild)

| Piece | Location | State |
|---|---|---|
| `tenant_email_settings` table (`from_name`, `from_address`, `reply_to`, `domain_verified`) | mig `045` | ✅ live |
| Two-tier resolver `resolveTenantSender()` | `src/lib/email/sender.ts` | ✅ live |
| Settings API `GET/PUT /api/v1/settings/email-sender` | `src/app/(main)/api/v1/settings/email-sender/route.ts` | ✅ live |
| Settings UI card | `src/components/dashboard/settings/email-sender-card.tsx` (in Communications panel) | ✅ live |
| Resolver wired into form autoresponders | `src/lib/email/form-autoresponder.ts:67` | ✅ live |
| Resolver wired into pipeline email-forward rules | `src/lib/email/email-forward.ts:90` | ✅ live |
| Platform sending domain | `PLATFORM_EMAIL_HOST = "edgex.zunkireelabs.com"` (`src/lib/email/index.ts:20`) | ✅ migrated 2026-08-21 |

**The entitlement gate already exists.** `domain_verified` is explicitly not settable through the
settings route (comment in `route.ts`: *"domain_verified is NOT settable through this route —
backend/Ops only"*). A tenant admin can type a from-address, but until **we** flip
`domain_verified`, the resolver keeps them on Tier 1. That is exactly the paid-add-on gate — no new
entitlement column is needed for this phase.

### Resolver behaviour (unchanged)

| Tier | Condition | `from:` | `reply_to:` |
|---|---|---|---|
| **Tier 1** | `domain_verified = false` | `Admizz Education <noreply@edgex.zunkireelabs.com>` | `hello@admizz.com` |
| **Tier 2** | `domain_verified = true` | `Admizz Education <hello@admizz.com>` | `hello@admizz.com` |

Tier 1 → Tier 2 is a boolean flip. No redeploy.

---

## 3. Sender-path audit — the actual code gap

Seven `resend.emails.send()` call sites exist. Classification:

| Call site | Audience | Correct sender | Today | Action |
|---|---|---|---|---|
| `form-autoresponder.ts:70` | Lead (external) | Tenant | resolver | ✅ none |
| `email-forward.ts:93` | Lead (external) | Tenant | resolver | ✅ none |
| `send-consent.ts:43` | **Student (external)** | **Tenant** | `EMAIL_FROM` hardcoded | **🔧 FIX — Task A** |
| `settings/email-rules/[id]/test/route.ts:66` | Admin testing a rule | **Tenant** (must mirror prod) | `PLATFORM_EMAIL_ADDRESS` hardcoded | **🔧 FIX — Task B** |
| `send-invite.ts:46` | New EdgeX user | Platform | `EMAIL_FROM` | ✅ keep EdgeX |
| `send-lead-assigned.ts:58` | Internal staff | Platform | `EMAIL_FROM` | ✅ keep EdgeX |
| `send-lead-assigned.ts:114` | Internal staff | Platform | `EMAIL_FROM` | ✅ keep EdgeX |

Rationale for the "keep EdgeX" rows: invites and internal assignment pings are product/system mail
about EdgeX itself and link into the EdgeX dashboard. Sending those "from Admizz" would be wrong.

**Task B matters more than it looks:** today the rule-test button always sends from the platform
address, so once Admizz is on Tier 2, "Send test" would show a *different* sender than the real
rule fires with — an admin would reasonably conclude the feature is broken.

---

## 4. Sonnet's work (branch `feature/tenant-sender-consent-test`)

Small, self-contained. No migration. No DB access.

### Task A — route consent emails through the resolver

`src/lib/email/send-consent.ts`
1. Add `tenantId: string` to `SendConsentEmailParams`.
2. `import { resolveTenantSender } from "./sender";`
3. Before the send: `const sender = await resolveTenantSender(tenantId);`
4. Change the send call to mirror the existing wired pattern exactly:
   ```ts
   from: sender.from,
   ...(sender.replyTo ? { replyTo: sender.replyTo } : {}),
   ```
5. Drop the now-unused `EMAIL_FROM` import if nothing else in the file uses it.

`src/app/(main)/api/v1/leads/[id]/consent/route.ts:287` — add `tenantId: auth.tenantId,` to the
`sendConsentEmail({...})` call. (`auth.tenantId` is already in scope at that call site.)

### Task B — make the rule-test email mirror the real send

`src/app/(main)/api/v1/settings/email-rules/[id]/test/route.ts`
Replace lines 62–64:
```ts
const fromAddress = rule.from_name
  ? `${rule.from_name} <${PLATFORM_EMAIL_ADDRESS}>`
  : EMAIL_FROM;
```
with:
```ts
const sender = await resolveTenantSender(auth.tenantId, {
  nameOverride: rule.from_name ?? undefined,
});
```
and in the send call use `from: sender.from,` plus the same
`...(sender.replyTo ? { replyTo: sender.replyTo } : {})` spread. Clean up now-unused imports
(`EMAIL_FROM`, `PLATFORM_EMAIL_ADDRESS`) if nothing else in the file references them.

### Tests
- Unit-test `sendConsentEmail` Tier 1 vs Tier 2 by mocking `resolveTenantSender`, asserting `from`
  and the presence/absence of `replyTo`.
- Assert `send-invite` and `send-lead-assigned` still send as `EMAIL_FROM` (regression guard — this
  is the pair most likely to get "helpfully" migrated later by mistake).

### Gates before handing back
- `npm run build` clean
- `npx eslint --max-warnings 50` clean
- `npm run test` green
- **Local dev verification with a screenshot** — per standing rule, green unit tests are not
  "tested". Run a consent send locally and show the resulting `from`.

### Hard stops
- **No database access.** Do not apply migrations, do not run SQL, do not touch stage or prod DB.
- Stop at PR-to-`stage`, opened but **not merged**. Opus reviews before merge.
- Branch from the latest `origin/stage`; rebase right before merge.

---

## 5. Sadin's manual runbook (Resend + DNS)

Do these in order. Steps 1–3 are safe and reversible; step 5 is the go-live switch.

**1. Add the domain in Resend** — Resend dashboard → Domains → Add Domain → `admizz.com`.

**2. Add the DNS records Resend displays** to `admizz.com` DNS. Typically a DKIM `TXT` and an SPF
record.

> ⚠️ **Do not add an MX record at the root of `admizz.com`.** Root MX controls where all of
> Admizz's normal inbound mail goes — adding or replacing it would break their existing email.
> Any MX record Resend asks for must be scoped to the sending subdomain it names (e.g.
> `send.admizz.com`). If Resend appears to ask for a root MX, stop and check with me first.

**3. Wait for Resend to show `Verified`.** Usually minutes; DNS propagation can take longer.
Screenshot the Verified state.

**4. Tenant config** — as an Admizz admin in EdgeX: Settings → Communications → Email Sender:
- Display name: `Admizz Education`
- From address: `hello@admizz.com`
- Reply-To: `hello@admizz.com`

This is safe to do *before* verification — until step 5, the resolver keeps sending from
`noreply@edgex.zunkireelabs.com` with the Admizz display name and Admizz reply-to. Admizz gets
branded mail with working replies immediately; only the literal from-address waits on DNS.

**5. Flip the switch — after steps 3 and 4 both confirmed:**
```sql
-- Expected before: domain_verified = false for Admizz. After: true. Exactly 1 row.
BEGIN;
SELECT tenant_id, from_name, from_address, reply_to, domain_verified
  FROM tenant_email_settings
 WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'admizz');

UPDATE tenant_email_settings
   SET domain_verified = true, updated_at = now()
 WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'admizz');
-- verify 1 row updated, then COMMIT;
COMMIT;
```
Apply to **stage** first, verify, then **prod**. Rollback is the same statement with `false`.

> This session cannot run that SQL — repo hard rule, no DB access of any kind. It goes through
> Sadin or the normal pipeline.

**6. Smoke after the flip** — submit a real Admizz form → confirm the autoresponder arrives from
`Admizz Education <hello@admizz.com>`, replying goes to Admizz's mailbox, and the message does not
land in spam (check the receiving client's "signed by" / authentication results show `admizz.com`).

---

## 6. Known tradeoff, stated once

Verifying the **root** `admizz.com` rather than a `send.` subdomain means EdgeX's sending
reputation attaches to Admizz's primary domain. Standard practice for low-volume transactional mail
and fine here; it would matter if Admizz later blasts high-volume marketing through the same
domain. Noted, not blocking.

---

## 7. Explicitly out of scope

- Self-serve domain onboarding (Resend Domains API, DNS-record UI, verification polling).
- Inbound/MX — replies to `hello@admizz.com` go to Admizz's mailbox, not into the EdgeX inbox.
- Bulk email campaigns from the tenant domain. The education `campaigns` feature is the
  contest/predict-and-win surface, not email marketing; the blast surface is Outreach, which is
  still log-only (`markDraftSent` — it records a send without sending). Making Outreach actually
  send is separate, tracked work and must land before "campaigns from admizz.com" is real.
- A dedicated paid-entitlement column — `domain_verified` serves that role for now.
