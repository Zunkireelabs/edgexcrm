# SMS Audience UX — Phase 3: "who exactly matched" (inline sample + recipients table)

## Status: NOT STARTED. Phase 3 of the audience-UX plan (Opus + Sadin scoped 2026-08-20).
## Same branch, same batch — continue on `fix/sms-f12-audience-count`, still no push/PR.

## Context

Phases 1-2 (F-12/F-13) + the search-operator fix are done and verified — the Audience section
now always shows a live, accurate match count. Sadin's next reaction, confirmed live in local
dev: "now shows matches, but I have no idea who it matches." Two additive pieces close that gap,
modeled on the best pattern across Klaviyo/Attentive/Twilio Engage/SimpleTexting (live count
always visible, row-level detail is a secondary opt-in action, never inline-by-default since a
segment can be thousands of rows) — plus one thing better than any of them: a zero-click inline
name sample so the common case doesn't need a click at all.

## Piece A — inline sample names on the existing count line (small, do this first)

### Endpoint change

`resolveAudience()` (`src/lib/sms/audience.ts`) already loads the **full** `sendable: AudienceRow[]`
array into memory for every call — `AudienceRow.lead` is the complete raw lead row. No new query
needed. Extend `/api/v1/sms/blasts/[id]/audience-count/route.ts`'s response to also return the
first 3 sendable leads' display names:

```ts
const sampleNames = audienceResult.audience.sendable
  .slice(0, 3)
  .map((r) => {
    const lead = r.lead as { first_name?: string; last_name?: string };
    return `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim() || "Unnamed lead";
  });

return apiSuccess({
  matched: audienceResult.audience.matched,
  sendable: audienceResult.audience.sendable.length,
  excluded: audienceResult.audience.excluded,
  sampleNames,
});
```
(Matches the existing `${first_name} ${last_name}`.trim() convention used elsewhere —
`apply-lead-patch.ts:1094`, `merge.ts:358`, `create-lead-note.ts:136` — no new shared helper
needed for 3 call sites, just the inline expression.)

Add `sampleNames: string[]` to `SmsAudienceCountResponse` in
`src/industries/_shared/features/sms/lib/types.ts`.

### `blast-composer.tsx` render change

Extend the persistent count line to include the sample when there is one:
- `matched === 0`: unchanged (amber empty state, no sample to show).
- `sendable > 0` and `sampleNames.length > 0`: `"{sendable} sendable of {matched} matched — incl.
  {sampleNames.join(", ")}{matched > sampleNames.length ? \`, +${matched - sampleNames.length}
  more\` : ""}."` e.g. `"1 sendable of 1 matched — incl. Gaurav Dahal."` or `"250 sendable of 261
  matched — incl. Gaurav Dahal, Puja Basnet, Aarav Tamang, +258 more."`
- `sendable > 0` but `sampleNames.length === 0` (edge case — matched leads exist but none are
  sendable, e.g. all missing phones): fall back to the current plain text, no "incl." clause.

### Regression test

Extend `blast-composer.with-draft.test.ts` or a new focused test — assert the render logic picks
the right branch for: zero matches, matched-with-samples, matched-but-zero-sendable. If this logic
ends up as inline JSX only (no extractable pure function), a lighter-weight test is acceptable —
note that tradeoff in the report rather than forcing an extraction that doesn't fit.

## Piece B — "Preview recipients" paginated table (the bigger piece)

### New endpoint: `POST /api/v1/sms/blasts/[id]/audience-preview`

On-demand only — **not** wired into the debounced count effect, only called when the user opens
the preview dialog (Piece A's sample already covers the "every keystroke" case cheaply; this one
can afford to be a little heavier since it's opt-in per click).

Model directly on `audience-count/route.ts`'s guard/resolve setup, same file structure:
```ts
// POST /api/v1/sms/blasts/[id]/audience-preview — Phase 3B: on-demand paginated
// view of the actual matched leads, for "who exactly is this going to."
// resolveAudience() has no DB-level pagination (same as /audience-count and
// /preview) — it loads the full matched set into memory; this route slices
// that in-memory array into the requested page rather than adding a second
// query path. Fine at current tenant scale (same cost /preview already pays
// to render 3 samples); revisit only if a tenant's audience size makes this
// slow in practice.
export async function POST(request: NextRequest, { params }: RouteParams) {
  const guard = await requireSmsAccess();
  if (!guard.ok) return guard.response;
  const { auth, db } = guard;
  const { id } = await params;

  const { data: blast, error } = await db.from("sms_blasts").select("id, audience_filter").eq("id", id).maybeSingle();
  if (error || !blast) return apiNotFound("SMS blast");

  const overrides = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  let tree: FilterTree = (blast as unknown as BlastRow).audience_filter ?? EMPTY_TREE;
  if (overrides.audience_filter !== undefined) {
    const parsed = filterTreeSchema.safeParse(overrides.audience_filter);
    if (!parsed.success) return apiValidationError({ audience_filter: [parsed.error.issues.map((i) => i.message).join("; ") || "invalid filter tree"] });
    tree = parsed.data;
  }

  const page = Math.max(1, Number(overrides.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(overrides.pageSize) || 25));

  const userClient = await createClient();
  const service = await createServiceClient();
  const audienceResult = await resolveAudience(auth, tree, { user: userClient, service, db });
  if (!audienceResult.ok) return apiValidationError(audienceResult.errors);

  const all = audienceResult.audience.sendable;
  const start = (page - 1) * pageSize;
  const rows = all.slice(start, start + pageSize).map((r) => {
    const lead = r.lead as { first_name?: string; last_name?: string; intake_source?: string | null };
    return {
      leadId: r.leadId,
      name: `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim() || "Unnamed lead",
      phone: r.phoneE164,
      source: lead.intake_source ?? null,
    };
  });

  return apiSuccess({ rows, page, pageSize, total: all.length });
}
```
Verify the exact `intake_source` column name against `src/lib/filters/registry/leads.ts`'s
`source` field def before writing this — don't guess the column name, the brief's snippet is
indicative, confirm against the registry.

**MVP columns: Name, Phone, Source only.** Do NOT add Stage/Status to this table yet — those need
extra list-name-resolution joins `resolveAudience` doesn't currently do, and aren't necessary for
the core "who is this" question. Flag as an easy, separate follow-up in the report, don't build it
now.

Register this new route in `architecture-guard.test.ts`'s exemption list, same `"rpc-only"` entry
pattern as `/preview` and `/audience-count` (F-12's addition to that file is the reference).

### New UI: `recipients-preview-dialog.tsx`

New file `src/industries/_shared/features/sms/ui/recipients-preview-dialog.tsx`, modeled directly
on `cost-preview-dialog.tsx`'s existing pattern in the same folder (controlled `open`/
`onOpenChange` props, fetch-on-open `useEffect`, loading/error states — read that file first, use
the same `Dialog`/`DialogContent`/`DialogHeader` components from `@/components/ui/dialog`). Add
local `page` state (reset to 1 whenever the dialog opens or the underlying `tree` changes), Prev/
Next buttons disabled appropriately from `total`/`pageSize`/`page`, a simple table (plain
`<table>` or reuse whatever table primitive `@/components/ui` already has — check before adding a
new one) with Name/Phone/Source columns, and an empty state ("No recipients match this filter")
for the zero-match case (shouldn't normally be reachable since the trigger button should be
disabled at 0, but handle it defensively).

### Wiring into `blast-composer.tsx`

- New state: `const [recipientsPreviewOpen, setRecipientsPreviewOpen] = useState(false);`
- A "Preview recipients" text-button/link next to the persistent count line (or immediately
  below it), enabled only when `audienceCount && audienceCount.sendable > 0`. Clicking sets
  `recipientsPreviewOpen(true)`.
- Render `<RecipientsPreviewDialog open={recipientsPreviewOpen} onOpenChange=
  {setRecipientsPreviewOpen} blastId={blast.id} audienceFilter={tree} />` — pass the **committed**
  `tree`, not `draftCondition`/`withDraft(...)` — the preview table is for a filter the user has
  actually applied, not mid-edit (unlike the live count, which previews the draft). Confirm this
  read of the UX is right in the report if it feels wrong once built — it's a judgment call, not a
  hard requirement, but the applied-tree-only version is simpler and matches "preview what you're
  about to send to," not "preview what I'm about to click Apply on."

## Scope guard

- Piece A: `audience-count/route.ts`, `types.ts`, `blast-composer.tsx` only.
- Piece B: one new route file, one new UI file, `blast-composer.tsx`, `architecture-guard.test.ts`.
- Do not touch `/preview` or `/send` — both already correct and unrelated to this.
- Do not build CSV export, sorting, or search-within-the-preview-table — out of scope, flag as
  future ideas in the report if worth mentioning, don't build them.

## Regression tests

- Piece A: covered above.
- Piece B: a route test for `/audience-preview` — pagination math (page 2 of a 30-row audience
  with pageSize 25 returns 5 rows), `total` reflects the full sendable count not the page size,
  empty-audience case returns `rows: []` cleanly, same guard-rejection/404/invalid-filter coverage
  pattern as `/audience-count`'s existing 6 tests.

## Before reporting back

- `npx tsc --noEmit` clean
- `npm run test` green, new tests present for both pieces
- Manually reload the blast composer in local dev:
  - Apply a filter matching a handful of real leads — confirm the count line now shows sample
    names ("incl. X, Y, Z")
  - Click "Preview recipients" — confirm the dialog opens with a real paginated table matching
    those names/phones; test Prev/Next if the audience is >25 (Admizz-local's tenant-wide count is
    ~261 sendable, so an unfiltered blast is a good way to exercise pagination)
  - Confirm the button is disabled/hidden at 0 matches
- Same "no push yet" instruction as F-13/F-14 — this is still batched, report back and hold.
