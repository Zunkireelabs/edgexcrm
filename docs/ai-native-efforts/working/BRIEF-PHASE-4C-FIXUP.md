# BRIEF — Phase 4C fixup (Opus review findings)

**Branch:** `feature/ai-phase-4-writes` (HEAD `f18d27a`, 4C work uncommitted in the working tree — do **not** commit, push, or open a PR; Opus commits after re-review.)

**Context:** Phase 4C (`create_lead_note` + `create_knowledge_item` + provenance, mig 173) passed all gates and its provenance chain works. Three findings from Opus's line-by-line review. All three are small and localized — no re-architecture.

Do **not** touch `scripts/seed-education-local.sh` (pre-existing WIP, not yours). Leave the local test KB items and notes in place.

---

## Finding 1 — BLOCKER: AI-written lead notes are invisible as AI-written

`create_lead_note`'s tool description tells the model:

> "The note is permanently attributed to the AI assistant — visible to the whole team as AI-written, not anonymous"

and `assistant.ts`'s actions paragraph repeats it. **Both are false as shipped.** `lead_notes.created_via` is written correctly to the DB and surfaced in no UI. KB items got `AiWrittenBadge`; lead notes got nothing.

Result: an AI-written note renders on the lead timeline attributed to the human user, indistinguishable from one they typed. That is exactly the laundering §4 exists to prevent, on the notes surface instead of the KB surface. It also means the model is being told something untrue about the consequence of its own write, which undermines what the approval card promises the user.

### Where

The live render is **`src/components/dashboard/lead/activities/activities-panel.tsx:628-651`** (`item.kind === "note"`), reached via `LeadDetailV2` ← `src/app/(main)/(dashboard)/leads/[id]/page.tsx:267`.

⚠️ **`src/components/dashboard/lead-detail.tsx` is NOT the live component** — the route imports `LeadDetailV2`. Don't spend time there; if you touch it, only for type consistency, and say so.

### Do

1. **Promote the badge.** `AiWrittenBadge` currently lives unexported at `src/components/dashboard/knowledge-base-items-table.tsx:73`. Move it to a shared module (suggest `src/components/dashboard/ai-written-badge.tsx`), export it, and import it in both call sites. Keep the existing styling and the `title="Written by the AI assistant — unverified"` tooltip verbatim — don't redesign it.
2. **Thread `created_via` to the panel.** Trace the `LeadNote` type and the fetch that populates `notes` (used at `activities-panel.tsx:563`). Add `created_via?: "human" | "ai_assistant"` to the type and make sure the fetch selects it. The REST `GET /leads/[id]/notes` already uses `.select("*")` (`route.ts:61`) so it may already come through — **verify, don't assume**; if the panel is fed from a different query, fix that one.
3. **Render it.** In the `item.kind === "note"` block, show the badge next to the "Note added" label when `created_via === "ai_assistant"`.

Treat `created_via` as optional/defaulted on the client (`=== "ai_assistant"`, never `!== "human"`) so pre-mig-173 rows and any stale cache render as human rather than throwing or mislabeling.

### Acceptance

- An AI-written note on the lead timeline visibly carries the AI-written badge for **any** user who can see the lead — not just its author.
- A human-written note is visually unchanged from today.
- The KB items table still renders its badge identically (no regression from the extraction).

---

## Finding 2 — Unverified-source guidance is gated on the wrong flag

In `src/lib/ai/prompts/assistant.ts`, this sentence sits inside `actionsParagraph`, which is gated on `hasWriteTools`:

> "When search_knowledge returns a result marked AI-written, treat it as unverified — say so when you rely on it, and prefer a human-authored source over it when they conflict."

But `search_knowledge` is a **read** tool, always available. Turn `AI_WRITE_TOOLS_ENABLED` off after any AI-written items exist and they remain retrievable forever while the instruction for interpreting them silently disappears.

### Do

Move that sentence out of the write-gated block into the always-on body of the prompt. Guidance about *reading* AI-written knowledge belongs on the read path; guidance about *creating* it stays write-gated.

Keep the two `create_lead_note` / `create_knowledge_item` sentences where they are — those are correctly write-gated.

### Acceptance

- Extend `assistant.test.ts`: with `hasWriteTools: false`, the prompt still contains the AI-written/unverified guidance; it still contains the create-tool guidance only when `hasWriteTools: true`.

---

## Finding 3 — `createdVia` has two sources of truth

- **Excerpt hits** derive it from chunk **metadata** (`src/lib/ai/retrieval/retrieve.ts:130`) — a snapshot written at ingest time.
- **Title hits** derive it from `knowledge_base_items.created_via` (`search-knowledge.ts`) — the column the mig-173 CHECK constraint guards.

No live laundering today (mig and code ship together; old code can't write `ai_assistant` during the migrate-before-deploy window). But a denormalized copy that any re-ingest or backfill can skew is strictly weaker than reading the guarded column — and `joinToKbItems` **already fetches the item row** at `retrieve.ts:110-112`, it just doesn't select the field.

### Do

1. Add `created_via` to the select at `retrieve.ts:111` and to the `KbItemRow` interface.
2. Prefer the **item row's** value as the source of truth; keep the chunk-metadata read as a fallback only if the item value is absent.
3. **Keep writing `created_via` into chunk metadata** in `kb-ingest.ts` — it stays useful for debugging and for any consumer reading chunks directly. This is about which value *wins* at read time, not removing the other.

### Acceptance

- Extend `retrieve.test.ts`: a chunk whose metadata lacks `created_via` but whose parent item is `ai_assistant` resolves to `createdVia: "ai_assistant"`. That case is the whole point of the change.

---

## Gates (re-run all, report raw output)

```bash
rm -rf .next && NODE_OPTIONS=--max-old-space-size=6144 npm run build
npx vitest run
npm run lint          # must stay 0 errors / 46 warnings — do not add warnings
NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit
grep -rn createServiceClient src/lib/ai/ src/industries/*/ai/   # must be clean
```

Baseline to beat: build exit 0, **392 tests passing**, lint 0 errors / 46 warnings, tsc clean.

## Live verification (local stack, `admizz-local`)

1. Drive a real `create_lead_note` through chat → approve → **open the lead page as a different user** and confirm the badge is visible on the timeline. Screenshot or quote the rendered DOM — a DB row is not evidence for this finding.
2. Confirm an existing human note on the same timeline renders unbadged.
3. `search_knowledge` against the existing `Q3 pricing notes` item still returns `createdVia: "ai_assistant"` after the Finding-3 change.
4. Confirm the KB items table badge is unregressed.

## Rules

- No commit, no push, no PR. Mig 173 stays **local only** — do not apply to stage or prod.
- No new migration needed; this is code-only.
- If any finding turns out to be wrong on inspection, **say so and stop** rather than forcing a change — flag it and explain what you found instead.
