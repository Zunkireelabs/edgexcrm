# WhatsApp Business — Meta setup & verification checklist

> **Purpose:** everything needed to get a real WhatsApp number live for a customer tenant (first: Admizz), in the order it has to happen. This is the **external / business track** — none of it is code, and none of it can be shortened by engineering. It is the long pole on the whole WhatsApp rollout.
>
> **Status:** not started as of 2026-08-16. Owner: Sadin.
> **Engineering side:** `docs/WHATSAPP-ADMIZZ-PHASE0-BRIEF.md` (the code plan, which waits on this).

⚠️ Meta changes these flows and their naming regularly. Treat this as the map, but trust what the Meta console actually shows you on the day. Where this doc and the console disagree, the console is right — and please update this file.

---

## 0. The decision that must be made FIRST

**Whose Meta Business Portfolio holds Admizz's WhatsApp number — Zunkiree Labs', or Admizz's own?**

Everything below depends on this, because it determines **whose legal documents** get submitted.

| | Under **Zunkiree Labs'** portfolio | Under **Admizz's own** portfolio |
|---|---|---|
| Whose documents | Zunkiree's | Admizz's |
| Who drives verification | Us — faster, we control it | Admizz — slower, depends on their paperwork |
| Who owns the number | Us | Them |
| If Admizz churns | Messy — we hold a number carrying their brand | Clean — they keep their own number |
| Precedent for future tenants | We become the WhatsApp provider for everyone | Each tenant brings their own |

**This is a commercial decision, not a technical one.** It sets the pattern for every future tenant, so decide it deliberately rather than by whichever is fastest today.

> Existing portfolio: **"Zunkiree Labs Pvt. Ltd."** (id `2965471130325336`), with the Meta app **"EdgeX CRM"** (id `1322014153236497`) already under it.

---

## 1. Business Verification

Meta verifies that the legal business actually exists. This is the slow step — **typically several days, up to ~2 weeks**, and it can be **rejected and need resubmission**, so start it before anything else.

**Where:** business.facebook.com → Business Settings → Security Centre → Start Verification

### What you need ready

- **Legal business name** — must match the registration documents *exactly*. A trading name that differs from the registered name is the single most common rejection cause.
- **Registered business address** — must match the documents.
- **Business phone number** — Meta calls or texts it; someone must answer.
- **Business website** — must be live, and should visibly reference the business name.
- **Business email** on the business domain (not gmail).

### Documents (Nepal — provide the ones that apply)

At least one proving **existence**, and usually one proving **address**:

- Company/firm registration certificate (Office of the Company Registrar)
- PAN / VAT registration certificate
- Business/trade licence
- Recent bank statement showing business name + address
- Recent utility bill showing business name + address

Scans must be legible, uncropped, unedited, and current.

### Common rejection causes — check before submitting
- Trading name ≠ registered legal name
- Address on the form ≠ address on the document
- Website down, parked, or doesn't mention the business
- Blurred/cropped/photoshopped-looking scans
- Phone number nobody answers

---

## 2. The phone number

**Rules — verify these before choosing a number:**

- ✅ Must be able to receive **SMS or a voice call** for the verification code
- ❌ Must **not** already be active on the regular WhatsApp or WhatsApp Business **app** — if it is, delete that account first and **wait** before registering it here
- ✅ A **landline works** (use voice verification)
- ❌ Cannot be the Meta **test** number (`+1 555-646-8778`) — that one is capped at 5 recipients forever and cannot be promoted
- ⚠️ Once registered to the Cloud API, the number **cannot be used in the WhatsApp app** — plan for a dedicated business line, not someone's personal phone

**Decision:** which number does Admizz want customers to see? It becomes their public WhatsApp identity and moving it later is painful.

---

## 3. Display name approval

The name students see in WhatsApp. Submitted with the number and reviewed by Meta.

- Must clearly relate to the business (e.g. "Admizz", "Admizz Education")
- Cannot be generic ("Education", "Study Abroad", "Support")
- Reviewed separately from Business Verification, and **can be rejected on its own**

---

## 4. Message templates

**Needed for outreach — messaging a student who hasn't messaged you in the last 24h.** Without approved templates, WhatsApp is **reply-only**: staff can answer inbound messages but cannot start a conversation. That is Meta's rule, not a limitation of our build.

**These can be drafted and submitted in parallel with Business Verification — do not wait.** Each template is reviewed individually (usually hours to a couple of days) and can be rejected and resubmitted.

Planned first set (all **Utility** category — easier approval, better delivery than Marketing):

1. **Inquiry acknowledgment** — after a student submits the web form
2. **Document request** — "we need your transcript / passport"
3. **Application status update** — status changed at a university
4. **Appointment / counselling reminder**

Deliberately **no Marketing-category templates in the first round.** Marketing gets stricter review, needs demonstrable opt-in, and poor marketing sending damages the number's quality rating — which throttles *everything*, including the utility templates.

---

## 5. Payment method

WhatsApp Cloud API is **not free beyond the free tier**. Meta bills per conversation, and rates vary by country and category.

- Add a payment method to the Business Portfolio **before** go-live — messages simply stop sending when billing isn't set up
- Decide who pays: Zunkiree (rebilled to Admizz) or Admizz directly. Follows the §0 ownership decision.

---

## 6. Already done — don't redo these

- ✅ **Privacy policy page** — live and publicly reachable at `edgex.zunkireelabs.com/privacy` (HTTP 200, verified 2026-08-16). Meta asks for a privacy policy URL; this is it.
- ✅ **Meta app exists** — "EdgeX CRM" (`1322014153236497`), published, WhatsApp product added, under the Zunkiree portfolio.
- ✅ **Webhook working** — verified end-to-end on stage 2026-08-16, both directions, ~40s inbound.
- ✅ **Permanent System User token** in use (a *temporary* token was the cause of the June `131005` send failures — never use a temporary one).

---

## 7. Order of operations

```
0. Decide portfolio ownership (Zunkiree vs Admizz)   ← blocks everything
1. Start Business Verification                        ← slowest; start first
2. Draft + submit the 4 templates                     ← parallel, don't wait on #1
3. Choose + register the real phone number
4. Submit the display name
5. Add a payment method
6. Then engineering connects the number in EdgeX      ← ~15 minutes once above is done
```

**Steps 1 and 2 run in parallel and are the critical path.** Everything engineering does waits on them, and nothing engineering does makes them faster.

---

## 8. What we can and cannot do before this clears

**Can** (and largely have): the inbox, branch scoping, attachments, reply-only flows — all buildable and testable against the Meta **test** number, capped at **5 verified recipients**.

**Cannot, at all:** message a single real Admizz student. The test number's 5-recipient cap is absolute.

So the honest read: **the date real students can use WhatsApp is set by Business Verification, not by engineering.** Every day it isn't started is a day added to that date.

---

## 9. Open questions to settle alongside this

- **Portfolio ownership** (§0) — the blocking one.
- **One Meta app or two?** Meta allows one webhook callback URL per app. The existing "EdgeX CRM" app points at **stage**. If it's repointed at prod, stage loses real WhatsApp testing. A **separate prod app** mirrors the two-database split this project already uses everywhere. Recommended.
- **One number per tenant.** `UNIQUE(provider, external_account_id)` — a WhatsApp number belongs to exactly one tenant and cannot be shared. Every customer tenant needs its own number and its own verification.
