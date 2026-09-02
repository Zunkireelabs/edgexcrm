# D5 — sub-processor disclosure + tenant notice (drafts)

**Status:** drafts for Sadin. Originally written 2026-07-19; corrected 2026-08-31; **verified against the live provider consoles 2026-09-02** (see Verification log at the bottom).
**Do not publish or send with any `[SADIN — VERIFY]` item unresolved.** One remains: the Admizz agreement clause (Part B).

Two documents:
1. **Part A** — public privacy-policy section (sub-processor disclosure).
2. **Part B** — the tenant notice for Admizz.

Both are written for the **prod** rollout, and both gate PR #289 (the `AI_ASSISTANT_ENABLED` flag flip).

---

## ⚠️ Read before editing this file

**2026-09-02 — Anthropic has been struck from both Parts.** The 2026-08-31 revision claimed "Anthropic is now the primary sub-processor." That was false. Verified in code the same day it was corrected:

- `AI_PROVIDER=openai` is pinned in **both** deploy workflows (`deploy.yml:228`, `deploy-staging.yml:175`).
- No `ANTHROPIC_API_KEY` is provisioned in either workflow's secrets or `envs` list.
- `src/lib/ai/provider.ts` **throws** when the configured provider has no key rather than falling back to the other vendor — a silent fallback would send customer data to a sub-processor the client's consent doesn't name.

**Anthropic receives nothing.** Listing a sub-processor that gets no data is as misleading as omitting one that does. If `AI_PROVIDER` is ever changed, this file must be revised *before* the change ships — see the comment block in `src/lib/ai/models.ts`, which says the same thing.

**2026-08-31 — the "stage was scrubbed" claim was FALSE and has been removed everywhere it appeared.** Stage Admizz data is **real, unscrubbed student PII** (16,436 of 16,684 leads carry a real phone number). Do not reintroduce any claim about anonymized or scrubbed test data unless it has been independently re-verified against the live stage DB at the time of sending.

**2026-08-31 — this file postdates the background-agent spine** (Lead Triage, Follow-up Drafter, MCP server, merged 2026-07-27/28). Both Parts describe agents as well as the chat assistant, since Admizz's rollout includes both.

---

# PART A — Privacy policy: AI features and sub-processors

Plain language. Accuracy over polish — every sentence below is checkable against the code or against archived console evidence.

> ## AI features and sub-processors
>
> Some EdgeX features use artificial intelligence — an in-app assistant your team can ask questions, background agents that review leads and draft follow-ups, and search across documents you upload to a knowledge base. These features are **off by default** and are switched on per organization. While they are off, none of the processing described here happens and no data is sent to any AI provider.
>
> When they are switched on for your organization, we share the minimum data needed with the following sub-processors:
>
> | Sub-processor | Purpose | What it receives |
> |---|---|---|
> | **OpenAI** | All AI processing — assistant responses, background-agent reasoning (lead scoring, task suggestions, follow-up email drafts), document parsing and search indexing | The content of your messages to the assistant and its responses; lead/student fields an agent reads to do its job (e.g. name, contact details, stage, notes); the text of documents you upload to a knowledge base |
> | **Langfuse** | Monitoring and troubleshooting AI features | Organization, user and request identifiers; the model used; usage counts; and the parameters of actions the assistant/agents take. Personal data in those parameters is masked before it is sent. Langfuse does not receive your documents or the content of your messages. |
> | **Inngest** | Reliable background processing — document indexing and running background agents | Internal record identifiers only. No document content and no personal data. |
>
> **Training.** Your data is not used to train our AI providers' models. Data sharing for model improvement is switched off on our OpenAI organization, across every project.
>
> **Retention.** OpenAI retains API content for up to **30 days** for abuse monitoring, after which it is deleted. Langfuse retains monitoring data for **30 days**, after which it is permanently deleted.
>
> **Where processing happens.** Monitoring data (Langfuse) is processed in the **EU**. AI processing (OpenAI) is not restricted to a single region — requests may be processed wherever OpenAI operates.
>
> **Changing providers.** We may change AI providers. If we do, we will update this page before the change takes effect and will notify organizations whose enablement was subject to a specific agreement.

### Notes on Part A

- **The training sentence is now true, and was not before.** On 2026-09-02 the OpenAI organization (`Zunkireelabsopenai`) was found with **all three sharing settings enabled for all projects** — "Share inputs and outputs with OpenAI", "Share evaluation and fine-tuning data", and "Enable sharing of model feedback from the Platform" — in exchange for enrollment in OpenAI's complimentary daily-token programme. All three were set to **Disabled** and saved the same day. Before/after console screenshots are archived. OpenAI's default is no training on API data *"unless you explicitly opt in"* — we had opted in. **Do not re-enable sharing on any project that handles customer data** (`Edgex-prod` and `Default project` both do; see the key-placement note below).
- **The retention sentence is deliberately not "zero retention".** ZDR requires prior OpenAI approval and a sales conversation, and isn't available on standard pay-as-you-go. Claiming it would be false. 30 days is the truth and is perfectly defensible.
- **The Langfuse retention figure is deletion, not just access expiry.** Langfuse's own docs: expired traces, observations, scores and media are selected and deleted nightly, and deleted assets cannot be recovered. Our plan (Hobby) has a 30-day default and does not permit configuring a shorter window.
- **"Where processing happens" deliberately splits the two.** Langfuse is EU-pinned (`cloudRegion: "EU"`, verified in-account). The OpenAI project's residency is **Global** — not region-pinned. A single blanket sentence covering both would have been wrong, which is what the original VERIFY marker was guarding against.
- **The Langfuse masking claim is code-backed. The one convention-only gap is closed in PR #473 (`chore/ai-telemetry-privacy`, open to stage — verify merged before publishing).** `src/lib/ai/telemetry.ts` constructs the client with a fail-closed `mask`: an allow-list of safe key names plus UUIDs and numbers pass, everything else is masked by default, so a tool argument nobody added to the list stays masked rather than leaking. The former gap: `scoreRun()`'s `comment` parameter bypassed the mask. Both call sites pass operational metadata only, so nothing leaked in practice — but it was discipline, not enforcement. PR #473 adds `maskComment()`, which routes the comment through the same per-key `maskValue` the client mask uses: `decision=…;kind=…` operational labels survive intact, any other key or any free-text/PII-shaped comment fails closed to `[masked]`. The docstring now states the guarantee instead of the caveat.

---

# PART B — Tenant notice (Admizz)

**Framing decision.** Sadin has confirmed the existing tenant agreements cover AI processing, so this is written as a **notice**, not a permission request. It still gives a clear route to decline, because a notice nobody can act on isn't meaningful. If the agreements turn out *not* to name third-party AI processing specifically, this should revert to asking rather than informing — **[SADIN — VERIFY: check the Admizz agreement for a sub-processor notification clause; if one exists, this notice may need to satisfy its timing or form.]**

**Do not send until:** (a) PR #473 (the `scoreRun` masking gap + OpenAI `store: false`) is merged to stage and promoted to prod, (b) AI is actually deployed to prod for Admizz, and (c) Phase 7's verification pass has confirmed the approval/undo/labelling controls this notice promises work end-to-end on a real run — not just in code review.

---

**Subject:** AI features on your EdgeX account — what changes and what we've put in place

Hi [Name],

We're enabling AI features on EdgeX for Admizz: an in-app assistant your team can ask questions, background agents that quietly review new leads (suggesting a priority score or a follow-up task) and can draft follow-up emails for your counselors to send, and search across documents you upload to a knowledge base. This note explains what that involves, because it means some student data will be processed by third parties.

**What happens**

To provide these features we send the following to **OpenAI**, our AI provider:

- what your staff type into the assistant, and what it replies
- lead/student fields a background agent reads to do its job — e.g. name, contact details, stage, and notes on the record it's working on
- the draft content a background agent produces (e.g. a suggested follow-up email) before a staff member reviews it
- the text of documents your team uploads to a knowledge base, and text we index so search works

Depending on what your team enters, uploads, or has recorded on a lead, this can include student personal data — names, contact details, or notes about a student's application.

We also use **Langfuse** to monitor whether the AI is working correctly. It receives account and user identifiers and usage counts; personal data in the parameters of AI actions is masked before it is sent. It does not receive your documents or the content of your staff's messages. Langfuse processes this data in the EU and deletes it after 30 days.

Your data is not used to train OpenAI's models. OpenAI retains content for up to 30 days for abuse monitoring and then deletes it.

**What we've put in place**

- AI is enabled per organization, so this decision applies only to Admizz. It is off until we switch it on.
- Staff must approve every write before the assistant or a background agent changes anything in your CRM. Neither can act on its own, and each approval shows exactly which student record it affects.
- Anything the AI writes into your CRM is permanently labelled as AI-written, so your team can always tell it apart from something a person wrote.
- Every AI-proposed action can be undone by a staff member after the fact, not just blocked beforehand.

**If you'd rather we didn't**

Reply and say so and we won't enable it, or we'll switch it off if it's already on. It won't affect anything else in your account.

If it would help to see it working before we proceed, we're happy to walk you through it on a call.

[Sadin Shrestha]
Zunkiree Labs

---

### Notes on Part B

- **"It is off until we switch it on"** is true for Admizz. Note for internal accuracy: the `edgex-prod` OpenAI key shows last use 2026-08-16, which is the **outreach AI email drafter** running for the Zunkiree Labs tenant only — a different tenant, and the one genuinely-live prod AI path. The sentence as written is about Admizz's account and stands.
- **"Every AI-proposed action can be undone"** is true (`UNDOABLE_TOOL_IDS` covers `update_lead_stage` and `assign_lead`) with one caveat not worth putting in a client notice: `create_task` writes aren't undoable (no previous value to restore on an insert) — tracked on FEATURE-ROADMAP, low-stakes (a stray task is manually deletable).
- **Not mentioned, deliberately — and now more serious than when this was first drafted:** on 2026-07-17 real student names reached OpenAI from the un-scrubbed stage environment. As of 2026-09-02 we know that OpenAI data-sharing for model training was **enabled at that time** (Sadin: enabled "long back", i.e. well before July). We should therefore assume that traffic was training-eligible, not merely retained for abuse monitoring. Turning sharing off does not retract it — OpenAI's wording is that only traffic sent *after* the setting is turned on is shared, which means what was already sent stays shared. Whether this warrants separate disclosure to Admizz is a judgement call for Sadin and, given it now involves training rather than short-term retention, plausibly for a lawyer. Recorded in ADR-001 §D5 Amendment §9. **[SADIN — DECIDE]**
- **Stage Admizz data is still real, unscrubbed PII** as of 2026-09-02, used only for internal engineering testing, never customer-facing. Anonymizing it remains open work and is now the main thing standing between a routine stage test and a repeat of the above.

---

## Verification log — 2026-09-02

Console evidence captured this date; screenshots archived alongside this file.

### OpenAI — org `Zunkireelabsopenai` (single org)

| Finding | Value |
|---|---|
| Data sharing — inputs/outputs | Was **Enabled for all projects** → **Disabled** ✅ |
| Data sharing — evaluation & fine-tuning | Was **Enabled for all projects** → **Disabled** ✅ |
| Data sharing — platform model feedback | Was **Enabled for all projects** → **Disabled** ✅ |
| Project residency (`Edgex-prod`) | **Global** — not region-pinned |
| Retention | 30 days for abuse monitoring (OpenAI published terms); ZDR requires approval + sales |
| API call logging | **Enabled per call**; Responses API logged by default unless `store=false` is passed — sent on every OpenAI language-model call as of PR #473 (open to stage) |
| Org members | 2 — `sthasadin@gmail.com` (Owner), `anish@zunkireelabs.com` |
| Projects | `Default project`, `Autonomous-seo`, `Edgex-prod` |
| Key placement | `edgex-prod` → `Edgex-prod`; **`edgex-vps` (stage/local) → `Default project`** |
| Spend | $0.00 of $8.00 (September), 0 requests in 7 days on `Edgex-prod` |

**Key-placement consequence:** the stage/local key sits in `Default project` alongside ten unrelated keys. Because stage carries real student PII, **both `Default project` and `Edgex-prod` handle customer data** and neither may have sharing re-enabled. Only `Autonomous-seo` would be eligible for the complimentary-token programme, and only if it touches no third-party data.

### Langfuse — org "Sadin's Organization" (`cmrn7dceg01jead0i8x2p66qx`)

| Finding | Value |
|---|---|
| Region | **EU** (`cloudRegion: "EU"`, org debug metadata) |
| Plan | **Hobby** (free) — 50k units/month, 159 used in 2026-08-16→09-16 |
| Retention | **30 days, then permanently deleted**; nightly purge; not configurable on this plan |
| Members | **1** — `sadin@zunkireelabs.com` (Owner, GitHub SSO) |
| Projects / keys | One project ("My Project") holding **both** key pairs — `edgex` (stage/local) and `edgex-prod` |
| Langfuse's own AI features | **Off** — if enabled, would send data to AWS Bedrock, adding an undisclosed sub-processor. Keep off. |

**Plan choice is deliberate, not an oversight.** Hobby is right for the Admizz pilot: 30-day deletion is a stronger privacy position than paid tiers' 90 days / 3 years, and the 2-user cap keeps the access surface small. Move off it when any of these fire: a third person needs trace access (cap is 2, one seat used); sustained usage past ~50% of 50k units; a client asks for a SOC2/ISO report (Pro-only); or the bus factor of a single-owner personal starter org becomes unacceptable.

### Open items

1. **[SADIN — VERIFY]** Admizz agreement — sub-processor notification clause? (Part B framing.)
2. **[SADIN — DECIDE]** Historical training exposure — see Part B notes.
3. **Code follow-up — DONE, in review.** `scoreRun()` comment masking → PR #473 (`chore/ai-telemetry-privacy`), open to stage, all gates green. Verify merged + promoted to prod before publishing Part A's masking sentence.
4. **Code follow-up — DONE, in review.** `store: false` on every OpenAI language-model call (chat, agents, draft-email, ingestion OCR) → same PR #473. Centralised as `aiRequestProviderOptions()` in `src/lib/ai/provider.ts`; the SDK's openai provider has no model-instance settings hook, so it is spread per call site. Embeddings have no `store` option and are untouched.
5. **Housekeeping** — prune stale OpenAI keys (13 active, none expiring, several never used) and the unused "Orca Integration Test" key on Zunkiree stage.
