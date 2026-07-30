# Reply-To Display Name — Build Brief (Phase 2, slice 0)

**Size:** ~20 lines of behaviour change across 3 files. **No migration. No new dependency. No UI.**
**Branch:** `feature/email-replyto-display-name` (off `origin/stage`@`3a819941`).

---

## 1. The problem, exactly

When a lead hits **Reply** on an EdgeX-sent email, their Gmail compose window shows:

```
reply+s005b2a252e769a3c5dcbc893e8f2beea386f657b25@lead-crm.zunkireelabs.com
```

A 45-character hex blob where a human name should be. That is what every lead of every tenant
currently sees the moment they reply.

It is **not** a limitation of the token design — it is an inconsistency inside one file:

| Header | Built at | Form | Lead sees |
|---|---|---|---|
| `From` | `gmail-client.ts:194` | `"${args.fromName}" <${args.from}>` | ✅ a human name |
| `Reply-To` | `send/route.ts:250` → `gmail-client.ts:205` | `minted.address`, bare | ❌ raw token |

So the lead is greeted by a name on the way in and a hex blob on the way back out.

**Fix:** RFC 5322 name-addr form — `Reply-To: "Admizz Education" <reply+s…@lead-crm.zunkireelabs.com>`.
The token is unchanged and still routes; it is simply wearing a name. This is what HubSpot does.

---

## 2. Verified before writing this brief — do NOT re-derive

1. **Inbound parsing already handles it.** `parseInboundAddress` (`src/lib/email/inbound/tokens.ts:142`)
   does `raw.match(/<([^>]+)>/)` and parses the angle-addr before anything else. An inbound
   `To: "Admizz Education" <reply+s…@…>` resolves **identically** to a bare address.
   **This was the only thing that could have made the change unsafe, and it is already handled.**
   Do not add parsing code.

2. **MailComposer's object form escapes correctly.** Verified by executing it:
   ```
   from:    {name:'A "Q" Ltd', address:'a@b.com'}       → From: "A \"Q\" Ltd" <a@b.com>
   replyTo: {name:'Admizz Education, Ltd', address:…}   → Reply-To: "Admizz Education, Ltd" <…>
   ```
   Both the embedded `"` and the `,` are handled. **Use the object form. Do not hand-quote.**

3. **The brand name costs zero extra queries.** `send/route.ts:203-206` *already* selects from
   `tenant_email_settings` (for `inbound_enabled`) inside the exact block that mints the token.
   Add one column to that existing `.select()`.

4. **`sanitizeName()` already exists** — `src/lib/email/sender.ts:7` — strips `[\r\n<>]` and caps at
   120 chars. That is precisely the header-injection guard this needs. It is currently
   module-private.

---

## 3. Decision taken (Sadin, 2026-07-28) — do not re-litigate

**The display name is the TENANT / BRAND name, not the individual rep's name.** A reply should feel
like it is going to the organisation, not to one person — and it stays correct when the lead is
later reassigned to a different counselor.

Fallback chain, in order:

1. `tenant_email_settings.from_name` (sanitized, non-empty)
2. else `tenants.name` (sanitized, non-empty)
3. else **no display name at all** — emit the bare address exactly as today

Step 3 matters: a tenant with neither value must land on **today's exact behaviour**, not on a
placeholder like `"EdgeX"`. Never invent a brand.

---

## 4. Changes

### 4a. New `src/lib/email/header-name.ts`

Lift the existing guard into one shared module so both call sites use the same rule:

```ts
/**
 * Strip anything that could break or inject into an RFC 5322 header, then bound the length.
 * CR/LF are the header-injection vector; angle brackets would corrupt the name-addr form.
 */
export function sanitizeHeaderName(name: string): string {
  return name.replace(/[\r\n<>]/g, "").trim().slice(0, 120);
}
```

Then **delete** the private `sanitizeName` in `src/lib/email/sender.ts:7` and import this instead.
Behaviour there must not change — same regex, same order, same cap.

> Do not put this in `sender.ts` and import it from the route: `sender.ts` imports from
> `./index`, and the send route has no reason to pull that graph in.

### 4b. `src/industries/_shared/features/email/lib/gmail-client.ts`

Widen the arg type (line 180) and pass both headers as objects:

```ts
replyTo?: string | { name: string; address: string };
```

```ts
const mail = new MailComposer({
  from: args.fromName ? { name: args.fromName, address: args.from } : args.from,
  ...
  replyTo: args.replyTo,
});
```

The `from` change is **part of this slice, not scope creep**: line 194's `"${args.fromName}"` is a
real latent bug — a tenant whose display name contains a `"` produces a malformed `From` header
today. The object form fixes it for free and is why we are already in this file.

### 4c. `src/app/(main)/api/v1/email/send/route.ts`

Inside the existing `if (process.env.EDGEX_INBOUND_ENABLED === "true")` block:

- Extend the existing select (line ~205) to `("inbound_enabled, from_name")`.
- Only when `settings?.inbound_enabled` is true (i.e. only where a token is actually minted),
  resolve the brand name and build the object.
- If `from_name` is empty, look up `tenants.name`. **Use `db.raw()` for that one** —
  `scopedClient` auto-injects `.eq("tenant_id", …)` for tenant-owned tables, but `tenants` is keyed
  on `id`. Write it explicitly and deliberately:
  ```ts
  db.raw().from("tenants").select("name").eq("id", auth.tenantId).maybeSingle()
  ```
  Run it concurrently with nothing else pending — it is one indexed PK lookup on a path that
  already performs several, but do not add it to the non-inbound path.
- Then:
  ```ts
  const brand = sanitizeHeaderName(fromName || tenantName || "");
  replyTo = brand ? { name: brand, address: minted.address } : minted.address;
  ```

**Everything else in that block is unchanged.** In particular keep the existing `try/catch` that
swallows wiring failures and falls back to `replyTo = undefined` — a brand-name lookup failing must
never fail a send. If the `tenants` lookup throws, degrade to the bare address, do not abort.

---

## 5. Out of scope — do not touch

- The token, its length, its checksum, its storage, or `mintToken`.
- `INBOUND_EMAIL_DOMAINS` and the visible **domain** (`lead-crm.zunkireelabs.com`). Making that
  per-tenant (`reply@mail.admizz.org`) is Phase 4; the domain list exists precisely so that lands
  without breaking live tokens.
- The `bcc+` dropbox, unrouted queue, attachments, retention purge — all Phase 2 proper.
- Any already-sent email. This changes new sends only; historical addresses keep working because
  the token is untouched.

---

## 6. Tests to add

In `src/lib/email/` (vitest, colocated `*.test.ts`):

1. `sanitizeHeaderName` — strips `\r` / `\n` / `<` / `>`; trims; caps at 120; returns `""` for
   whitespace-only input.
2. **Header-injection guard:** a `from_name` of `` `Evil\r\nBcc: attacker@evil.com` `` must not
   produce a `Bcc:` line in the composed message.
3. **Round-trip (the important one):** compose with `replyTo: {name, address}`, then feed the
   resulting `Reply-To` value back through `parseInboundAddress` and assert it resolves to the same
   token as the bare address. This is the regression that would break inbound routing.
4. Empty brand → composed message has a bare `Reply-To` with no display name (today's behaviour).

---

## 7. Gates — run all four, exactly these commands

```
npm run test                    # expect 954+ passing / 94+ files, plus your new ones
npx eslint --max-warnings 50    # 46 warnings, 0 errors is the accepted baseline — no src/ arg
npx tsc --noEmit                # 0
npm run build                   # exit 0
```

The 46 warnings are pre-existing (a `_`-stripped param in `src/lib/supabase/scoped.ts`). Report the
**actual** numbers from the **exact** commands above — a previously-reported "eslint 0 warnings" was
a scoped lint, not this command.

---

## 8. Definition of done

- [ ] Four gates green, real numbers reported.
- [ ] A composed message shows `Reply-To: "<Brand>" <reply+s…@…>` and `From: "<name>" <addr>`.
- [ ] `parseInboundAddress` resolves that `Reply-To` value to the same token as the bare form (test 3).
- [ ] A tenant with no `from_name` and no `tenants.name` produces byte-identical output to today.
- [ ] `EDGEX_INBOUND_ENABLED=false` path is completely untouched — no new queries, no new headers.
- [ ] `sanitizeName` no longer duplicated; `sender.ts` behaviour unchanged.

**Stop at PR.** Open to `stage`, request `ani-shh`. Do not merge, do not touch `main`, do not apply
anything to any database (there is no migration in this slice).
