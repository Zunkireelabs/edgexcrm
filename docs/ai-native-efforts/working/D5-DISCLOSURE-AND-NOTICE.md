# D5 — sub-processor disclosure + tenant notice (drafts)

**Status:** drafts for Sadin. Verified against code and the stage/prod DBs on 2026-07-19.
**Do not publish or send with any `[SADIN — VERIFY]` item unresolved.**

Two documents:
1. **Part A** — public privacy-policy section (sub-processor disclosure).
2. **Part B** — the tenant notice for Admizz.

Both are written for the **prod** rollout. Stage is no longer relevant to them: its customer PII was scrubbed on 2026-07-19, so stage processes no identifiable customer data.

---

# PART A — Privacy policy: AI features and sub-processors

Plain language. Accuracy over polish — every sentence below is checkable against the code.

> ## AI features and sub-processors
>
> Some EdgeX features use artificial intelligence — an in-app assistant your team can ask questions, and search across documents you upload to a knowledge base. These features are **off by default** and are switched on per organization. While they are off, none of the processing described here happens and no data is sent to any AI provider.
>
> When they are switched on for your organization, we share the minimum data needed with the following sub-processors:
>
> | Sub-processor | Purpose | What it receives |
> |---|---|---|
> | **OpenAI** | Assistant responses, document parsing, and search indexing | The content of your messages to the assistant and its responses; the text of documents you upload to a knowledge base; text submitted for search indexing |
> | **Langfuse** | Monitoring and troubleshooting AI features | Organization, user and request identifiers; the model used; usage counts; and the parameters of actions the assistant takes. Personal data in those parameters is masked before it is sent. Langfuse does not receive your documents or the content of your messages. |
> | **Inngest** | Reliable background processing of document indexing | Internal record identifiers only. No document content and no personal data. |
>
> **Training.** Your data is not used to train our AI providers' models. **[SADIN — VERIFY: confirm no data-sharing option is enabled on the OpenAI org, and archive the evidence. Do not publish this sentence until confirmed.]**
>
> **Retention.** OpenAI retains data sent through its API for up to 30 days for abuse monitoring, after which it is deleted. We are not currently eligible for OpenAI's zero-retention option, which requires an enterprise agreement.
>
> **Changing providers.** We may change AI providers. If we do, we will update this page before the change takes effect and will notify organizations whose enablement was subject to a specific agreement.
>
> **Where processing happens.** OpenAI and Langfuse process data outside Nepal. **[SADIN — VERIFY: which Langfuse region the account is on. ADR-001 assumed EU; the deployed `LANGFUSE_BASE_URL` default is `https://cloud.langfuse.com`.]**

### Notes on Part A

- **The retention sentence is deliberately not "zero retention".** ZDR needs an enterprise agreement and account-team enablement, and isn't offered on standard pay-as-you-go. Claiming it would be false. 30 days is the truth and it is a perfectly defensible one.
- **Anthropic is not listed** because it receives nothing — no API key is configured. Listing a sub-processor that gets no data is as misleading as omitting one that does.
- **The Langfuse row says masking happens** because it now does. Before 2026-07-19 that sentence would have been false, which is why it wasn't sent then.

---

# PART B — Tenant notice (Admizz)

**Framing decision.** Sadin has confirmed the existing tenant agreements cover AI processing, so this is written as a **notice**, not a permission request. It still gives a clear route to decline, because a notice nobody can act on isn't meaningful. If the agreements turn out *not* to name third-party AI processing specifically, this should revert to asking rather than informing — **[SADIN — VERIFY: check the Admizz agreement for a sub-processor notification clause; if one exists, this notice may need to satisfy its timing or form.]**

**Do not send until:** (a) the OpenAI training/retention check above is done, and (b) AI is actually deployed to prod. The notice describes controls that must exist on the environment Admizz uses.

---

**Subject:** AI features on your EdgeX account — what changes and what we've put in place

Hi [Name],

We're enabling AI features on EdgeX for Admizz: an in-app assistant your team can ask questions, and search across documents you upload to a knowledge base. This note explains what that involves, because it means some student data will be processed by a third party.

**What happens**

To provide these features we send the following to **OpenAI**, our AI provider:

- what your staff type into the assistant, and what it replies
- the text of documents your team uploads to a knowledge base
- text we index so search works

Depending on what your team enters or uploads, this can include student personal data — names, contact details, or notes about a student's application.

We also use **Langfuse** to monitor whether the AI is working correctly. It receives account and user identifiers and usage counts; personal data in the parameters of AI actions is masked before it is sent. It does not receive your documents or the content of your staff's messages.

Your data is not used to train any AI provider's models. OpenAI retains data sent through its API for up to 30 days for abuse monitoring, then deletes it.

**What we've put in place**

- AI is enabled per organization, so this decision applies only to Admizz. It is off until we switch it on.
- Staff must approve every action before the assistant changes anything in your CRM. It cannot act on its own, and each approval shows exactly which student record it affects.
- Anything the AI writes into your CRM is permanently labelled as AI-written, so your team can always tell it apart from something a person wrote.
- Our own testing environment holds no real student data — it was anonymized before we tested these features.

**If you'd rather we didn't**

Reply and say so and we won't enable it, or we'll switch it off if it's already on. It won't affect anything else in your account.

If it would help to see it working before we proceed, we're happy to walk you through it on a call.

[Sadin Shrestha]
Zunkiree Labs

---

### Notes on Part B

- **Every claim is now true and verifiable**, which was not the case when this was first drafted on 2026-07-19 morning. Per-tenant enablement, per-action approval, id-resolution on the approval card, AI-written labelling, and the scrubbed test environment all exist and have been exercised.
- **The "shows exactly which student record it affects" clause** is Phase 4D. It's worth stating because it is the honest answer to "how do we know it won't touch the wrong student?"
- **The anonymized-test-environment line** is worth including: it is unusual, it is true as of 2026-07-19, and it is the kind of thing a careful client notices you did without being asked.
- **Not mentioned, deliberately:** that real student names reached OpenAI from the un-scrubbed stage environment on 2026-07-17. That predates both the gate and the scrub. Whether it warrants separate disclosure is a judgement call for Sadin and, if there's any doubt, for a lawyer — it is recorded in ADR-001 §D5 Amendment §9 either way. **[SADIN — DECIDE]**
