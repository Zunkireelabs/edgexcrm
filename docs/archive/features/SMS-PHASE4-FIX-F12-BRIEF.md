# SMS Fix F-12 — Audience filter picker gives no live match feedback (UX)

## Status: NOT STARTED — new brief, Phase 1 of a 3-phase UX plan (Opus-scoped, 2026-08-20)

## The problem (Sadin hit this live, screenshotted it)

In the blast composer, Audience → Add filter → type a condition (e.g. Search "is anish") →
click Apply — and then nothing. No count, no confirmation, no "0 leads matched, did you mean
X?" The only match-count feedback in the whole composer is the tiny
`{liveMeta.sendable} sendable of {liveMeta.matched} matched leads.` line at
`blast-composer.tsx:143-147`, and it is **gated behind having already typed a non-empty message
body** (`blast-composer.tsx:82-85`: `if (!body.trim()) { setLiveMeta(null); return; }`).

Root cause: that count comes from `POST /api/v1/sms/blasts/[id]/preview`
(`src/app/(main)/api/v1/sms/blasts/[id]/preview/route.ts`), which is one bundled endpoint doing
audience resolution + message rendering + segment/credit costing + real sample text — and it
**hard-rejects an empty body**: `if (!messageBody || !messageBody.trim()) return
apiValidationError({ body: ["body is required"] });` (route.ts line ~58). So a user who wants to
pick their audience first and write the message second (the natural order — and the order the UI
presents top-to-bottom is actually Message-then-Audience, which doesn't help either) gets zero
feedback on their filter until they've also written a message.

This is Phase 1 of a 3-phase plan (Opus + Sadin scoped it together 2026-08-20). **Only Phase 1 is
in scope for this brief.** Phase 2 (live count while a filter condition is still open, before
Apply) and Phase 3 (a "preview recipients" data table of the actual matched leads) are separate,
later briefs — do not build them now.

## Fix — Phase 1: always-visible, live audience count, decoupled from message body

### 1. New endpoint — audience count only, no message required

Add `POST /api/v1/sms/blasts/[id]/audience-count`
(`src/app/(main)/api/v1/sms/blasts/[id]/audience-count/route.ts`). Model it directly on the
existing preview route's guard/audience-resolution setup (same file, lines ~40-72) but drop
everything message/cost/sample related:

```ts
import { NextRequest } from "next/server";
import { requireSmsAccess } from "@/lib/sms/api-guard";
import { apiSuccess, apiNotFound, apiValidationError } from "@/lib/api/response";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { resolveAudience } from "@/lib/sms/audience";
import { filterTreeSchema } from "@/lib/filters/schema";
import { EMPTY_TREE, type FilterTree } from "@/lib/filters/types";

interface RouteParams { params: Promise<{ id: string }> }
interface BlastRow { id: string; audience_filter: FilterTree | null }

// POST /api/v1/sms/blasts/[id]/audience-count — F-12: a lightweight sibling
// of /preview that answers "how many leads match this filter" WITHOUT
// requiring a message body. /preview stays as-is for the send-cost/sample
// flow; this route exists so the Audience section gets live feedback the
// moment a filter changes, before any message is typed.
export async function POST(request: NextRequest, { params }: RouteParams) {
  const guard = await requireSmsAccess();
  if (!guard.ok) return guard.response;
  const { auth, db } = guard;
  const { id } = await params;

  const { data: blast, error } = await db.from("sms_blasts").select("id, audience_filter").eq("id", id).maybeSingle();
  if (error || !blast) return apiNotFound("SMS blast");
  const blastRow = blast as unknown as BlastRow;

  const overrides = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  let tree: FilterTree = blastRow.audience_filter ?? EMPTY_TREE;
  if (overrides.audience_filter !== undefined) {
    const parsed = filterTreeSchema.safeParse(overrides.audience_filter);
    if (!parsed.success) {
      return apiValidationError({ audience_filter: [parsed.error.issues.map((i) => i.message).join("; ") || "invalid filter tree"] });
    }
    tree = parsed.data;
  }

  const userClient = await createClient();
  const service = await createServiceClient();
  const audienceResult = await resolveAudience(auth, tree, { user: userClient, service, db });
  if (!audienceResult.ok) return apiValidationError(audienceResult.errors);

  return apiSuccess({
    matched: audienceResult.audience.matched,
    sendable: audienceResult.audience.sendable.length,
    excluded: audienceResult.audience.excluded,
  });
}
```

Check the exact shape of `ResolveAudienceClients` / `resolveAudience`'s return type in
`src/lib/sms/audience.ts` before writing this — copy the preview route's usage verbatim, don't
guess field names.

### 2. `blast-composer.tsx` — decouple the count effect from `body`

Split the existing single `useEffect` (lines ~81-96) into two:
- Keep the existing one **unchanged**, still gated on `body.trim()` — it drives `liveMeta`
  (segments/cost/samples) for the send-confirmation flow. Don't touch its behavior.
- Add a **new** `useEffect` keyed only on `[tree, blast.id]` (no `body` dependency), debounced the
  same `PREVIEW_DEBOUNCE_MS`, that calls the new `/audience-count` endpoint and sets a new piece
  of state, e.g. `audienceCount: { matched: number; sendable: number } | null` plus a
  `audienceCountLoading: boolean` flag (set true right before the debounced call fires, false in
  both `.then`/`.catch`).
- Fire it once on mount too (empty `tree` still resolves to "all tenant leads" — showing that
  count on load, before any filter is added, is useful context, not noise).

### 3. Render — persistent chip under "Audience", not a buried line under the message box

Replace the current block at `blast-composer.tsx:140-148`:
```tsx
<div className="flex flex-col gap-1.5">
  <Label>Audience</Label>
  <AdvancedFilterBar entity="leads" fields={fields} value={tree} onChange={setTree} allowGroups={false} optionOverrides={audienceOptionOverrides} />
  {liveMeta && (
    <p className="text-xs text-muted-foreground">
      {liveMeta.sendable} sendable of {liveMeta.matched} matched leads.
    </p>
  )}
</div>
```
with a version that renders the new `audienceCount` state as its own line **always present**
right under the filter bar (not conditional on `liveMeta`/message body):
- Loading: a subtle "Counting matches…" (skeleton or muted text) while `audienceCountLoading`.
- Loaded, `sendable > 0`: `"{sendable} sendable of {matched} matched leads"` — same copy as
  today, just always-on instead of message-gated.
- Loaded, `matched === 0`: a visually distinct empty state, e.g. amber/warning text
  `"No leads match this filter"` — don't reuse `text-muted-foreground` for this, it needs to read
  as "something's wrong," not "same as normal."
- Leave the existing `liveMeta`-driven line (segments/cost) exactly where it is if there's
  message-specific info to show alongside — don't delete `liveMeta`, just stop relying on it for
  the audience count.

### Scope guard

Same as F-11: additive, `blast-composer.tsx` + one new route file only. Don't touch
`leads-table.tsx`, `advanced-filter-bar.tsx`, `use-filter-options.ts`, the field registry, or the
existing `/preview` route's behavior — `/preview` must keep working exactly as it does today for
the send-confirmation dialog. Don't build Phase 2 (in-popover live count) or Phase 3 (recipients
table) — separate future briefs.

### Regression tests

- New route: a test hitting `/audience-count` with an empty-tree body returns `matched`/`sendable`
  without requiring a `body` field in the request (the whole point of the fix) — contrast this
  against `/preview`'s existing "body is required" validation error to prove the two routes now
  have genuinely different contracts.
- `blast-composer.tsx`: verify the new count effect fires independent of `body` — e.g. a test (or
  extend the existing `.test.ts` pattern if there's a hook-level test already, otherwise note in
  the report if this needs a lighter-weight assertion since the file's current tests are all
  pure-function tests on `buildAudienceOptionOverrides`, not component-render tests).

### Before reporting back

- `npx tsc --noEmit` clean
- `npm run test` green, new tests present
- Manually reload the blast composer in local dev: open **Audience → Add filter → Search**, type
  a value, click Apply **without touching the Message field** — confirm the count updates live.
  Then clear the message body entirely on a blast that already has one — confirm the count stays
  visible (doesn't disappear). Then pick a filter that matches nobody — confirm the amber
  empty-state renders, not silence.
- Push to a new branch off latest `origin/main` (SMS is now live on prod — same reasoning as F-11:
  branch from main, not stage, since main is currently ahead/in-sync and this is a post-promotion
  fix)
