# BRIEF — Phase 4 close-out: pending-approval crash + `/orca/*` gating

**Branch:** fresh from latest `origin/stage`:
`git fetch origin && git switch -c fix/phase-4-closeout origin/stage`

Two unrelated bugs, both in the assistant UI surface, so one review round covers them. Neither is a data-safety issue — write governance and the per-tenant gate both hold. These are the rough edges you hit first when actually using the thing, and write tools are now live on stage.

---

## Bug 1 — Sending a message while an approval is pending kills the stream

**Symptom:** with a write-approval card open and undecided, typing a new message throws `AI_MissingToolResultsError` and the stream dies into the generic *"Something went wrong generating a response"*.

**Cause (verified in source, not inferred):** both chat surfaces compute the input's disabled state as

```ts
disabled={status === "submitted" || status === "streaming"}
```

- `src/components/dashboard/ai-assistant-panel.tsx:162`
- `src/components/dashboard/orca/ask-orca-content.tsx:103`

When a write tool proposes an action, **the stream completes** — `status` goes to `ready` while the tool call sits unresolved awaiting approval. So the input re-enables even though the conversation is not actually in a sendable state. Sending then submits a history containing a tool call with no result, which the AI SDK rejects.

**Fix:** the input must also be disabled while any tool part is awaiting a decision. The state to detect is `"approval-requested"` — see `approval-card.tsx:16-17`, where `ApprovalRequestedPart` / `ApprovalRespondedPart` are already typed, and `:91` uses `part.state === "approval-responded"` to mean decided.

So: a pending approval is a part with `state === "approval-requested"` anywhere in `messages`. Derive that once (`useAssistantChat` is the natural home, since both surfaces consume it) and disable on it in addition to the existing status check. **Don't duplicate the predicate at both call sites** — that's how they drift.

**Also fix the dead-end.** Disabling silently is worse than the crash for a user who doesn't know why they can't type. Show why — a short hint near the input like *"Approve or deny the pending action to continue"* — and make sure denying restores input immediately, not just approving.

**Tests:**
- Input disabled while a part is `approval-requested`; enabled once it's `approval-responded`.
- **Denying** re-enables the input (the path most likely to be forgotten).
- Multiple approvals pending → still disabled until all are decided.
- Normal chat with no write tools is unaffected — the existing status behaviour must not regress.

---

## Bug 2 — `/orca/*` renders for AI-disabled tenants

**Cause:** no Orca page is gated. Verified: nothing under `src/app/(main)/(dashboard)/orca/` references `isAssistantEnabled`, `ai_enabled` or `getFeatureAccess`. Meanwhile the dashboard layout already does it correctly at `layout.tsx:46-48`:

```ts
// Env flag AND tenants.ai_enabled (migration 174)
const aiAssistantEnabled = isAssistantEnabled() && tenantData.tenant.ai_enabled;
```

**Not a data risk** — I verified the only AI egress from Orca is `use-assistant-chat.ts:52` → `/api/v1/ai/chat`, which *is* gated, so a disabled tenant cannot reach OpenAI through it. This is purely a confusing state: the whole Orca tab renders, and "Ask Orca" only reveals it's unavailable after a failed send.

**Fix:** gate the Orca surface on the same condition the layout already computes.
- **Nav:** the Orca tab shouldn't render for a disabled tenant (`shell.tsx` holds `ORCA_NAV` around lines 100-106, and `isOrcaRoute` at ~266).
- **Routes:** the pages themselves must not be reachable by direct URL. Follow the established page-gate pattern — `notFound()` — rather than inventing a new one.

Reuse the layout's existing computation rather than re-deriving it. If threading it into `shell.tsx` is awkward, say so and propose an approach before writing it.

**Tests:**
- Disabled tenant: no Orca nav item; direct navigation to `/orca` and a sub-route 404s.
- Enabled tenant: Orca renders exactly as today.
- Env flag off but `ai_enabled` true → still gated (the env kill switch must keep winning).

---

## Gates

```bash
rm -rf .next && NODE_OPTIONS=--max-old-space-size=6144 npm run build
npx vitest run          # report the baseline on this branch first, then the delta
npm run lint            # 0 errors; no new warnings over the 46 baseline
NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit
```

## Live verification (local)

Local now has scrubbed names, so test data will look different from earlier sessions — IDs and relationships are unchanged.

1. **Bug 1:** ask for a note → approval card appears → try to type. Input must be disabled with a visible reason. **Deny** it → input re-enables. Repeat with **approve** → input re-enables. Confirm no `AI_MissingToolResultsError` in either path.
2. **Bug 2:** set a local tenant's `ai_enabled` to false (`scripts/set-tenant-ai.sh local <slug> off`) → Orca nav gone, `/orca` 404s. Set it back on → returns. Then unset `AI_ASSISTANT_ENABLED` with `ai_enabled` true → still gated.

## Out of scope

The `lead-detail.tsx` client-side `lead_notes` insert that bypasses `createLeadNote`'s governance, `optionalUuid` not stripping the all-`f` sentinel, and the latent `apply-lead-patch` NOT NULL bug when a list has no pipeline. All queued separately.

## Rules

- Stop at review. **No commit, no push, no PR.**
- No migration.
- If either diagnosis is wrong on inspection, **say so and stop** — that instruction has caught two bad briefs of mine already.
