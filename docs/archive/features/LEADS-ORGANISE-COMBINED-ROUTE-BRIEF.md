# BRIEF — Leads Organise: combined "route + assign" action + smart suggestion — for Sonnet

> **Role:** Executor. Frontend-only change. **NO migration, NO API change, NO new endpoint.** Build, run
> BOTH gates, commit on a NEW branch off `stage`, then **STOP and report** (commit hash, diff, gate
> outputs). Do **NOT** push, PR, merge, or touch prod. Sadin/Opus review + drive the stage push. Sadin
> verifies the UI himself — do not block on stage login; build + lint are your gates.

## Why
On the Leads Organise staging pages (`/leads-organise/[slug]`), an admin routes imported/migrated leads
out of staging into the live pipeline. Today that takes **two separate dialogs**: **Assign** (set
`assigned_to`) then **Move to list** (set `list_id`). The whole "route this batch out, to this list, owned
by this member" workflow should be **one action**. Everything else the admin needs already exists in the
table: the **Source filter** (`intake_source`), the **assigned/unassigned filter** (`counselorFilter` has
an "unassigned" option), and the **Assigned (Role)** column showing the current owner. So this brief only
closes the last gap: add an optional **assignee picker to the existing Move-to-list dialog**.

The backend already supports it: `PATCH /api/v1/leads/bulk` accepts `list_id` **and** `assigned_to` in the
same request body (see `src/app/(main)/api/v1/leads/bulk/route.ts`, body shape ~lines 47–53). No API work.

## Scope guardrail
Gate the new picker behind **`isStagingView`** so the **main pipeline `/leads` move dialog is unchanged**.
Only the Leads Organise staging views get the combined behavior.

## The change — all in `src/components/dashboard/leads-table.tsx`

### 1. New state (near the existing `moveListId` / `moveArchiveReason` / `isMoveList` state, ~line 162)
```ts
const [moveAssignTo, setMoveAssignTo] = useState<string>("keep");
```
> **Pitfall — do NOT use `""` as a `<SelectItem>` value.** Radix `Select` reserves the empty string and
> throws. Use the sentinel `"keep"` (= "leave current assignee untouched") as the default.

### 2. Assignee picker in the Move-to-list dialog (inside the `py-4 space-y-3` div, ~lines 1431–1459)
Add this **after** the archive-reason block, gated by `isStagingView`. Reuse the exact member-list pattern
from the existing Assign dialog (~lines 1338–1347: `teamMembers.filter(m => m.role !== "viewer")`, label
`email.split("@")[0]` + `(role)`):
```tsx
{isStagingView && (
  <div className="space-y-1.5">
    <p className="text-sm font-medium text-gray-700">Assign to (optional)</p>
    <Select value={moveAssignTo} onValueChange={setMoveAssignTo}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Keep current assignee" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="keep">
          <span className="text-muted-foreground">Keep current assignee</span>
        </SelectItem>
        <SelectItem value="unassign">
          <span className="text-muted-foreground">Unassign</span>
        </SelectItem>
        {teamMembers
          .filter((m) => m.role !== "viewer")
          .map((member) => (
            <SelectItem key={member.user_id} value={member.user_id}>
              <div className="flex items-center gap-2">
                <span>{member.email.split("@")[0]}</span>
                <span className="text-xs text-muted-foreground">({member.role})</span>
              </div>
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  </div>
)}
```
Behavior the picker encodes:
- **Keep current assignee** (default) → `assigned_to` is **omitted** from the request → each lead keeps
  whatever owner it already had. (This is the "already-assigned → show as-is, don't touch" case.)
- **Unassign** → `assigned_to: null`.
- **A member** → all selected leads reassigned to that member (the "change the assignee" / "assign the
  unassigned ones" case).

Per-lead current owners do **not** need to be shown inside the dialog — the **Assigned (Role)** column +
the assigned/unassigned filter already let the admin see and pre-filter that before opening the dialog.

### 3. Send both fields in `handleBulkMove` (~lines 499–507)
Add `assigned_to` to the PATCH body **only when the picker is not on "keep"** (so default behavior is
byte-for-byte unchanged):
```ts
body: JSON.stringify({
  ids: chunks[i],
  list_id: moveListId,
  ...(moveArchiveReason.trim() && { archive_reason: moveArchiveReason.trim() }),
  ...(moveAssignTo !== "keep" && {
    assigned_to: moveAssignTo === "unassign" ? null : moveAssignTo,
  }),
}),
```
The endpoint applies `list_id` + `assigned_to` in one update per chunk; chunking at `CHUNK_SIZE = 100`
already handles large batches (e.g. the 1,498 TeleCaller-assigned leads = 15 chunks). No other handler
change.

### 4. Reset the new state everywhere the move dialog resets
Wherever `setMoveListId("")` / `setMoveArchiveReason("")` are called — the `onOpenChange` reset (~line
1422), the Cancel button (~line 1463), and the success path in `handleBulkMove` (~lines 518–519) — also add:
```ts
setMoveAssignTo("keep");
```

### 5. (Optional polish, keep if trivial) success toast
In `handleBulkMove`'s success toast (~line 515), if `moveAssignTo !== "keep"` you may append the assignment
to the message (e.g. `… and assigned to <name>`). Skip if it complicates the code — not required.

### 6. Smart suggestion — remembered last target + assignment hint (staging only)
Two small, data-honest aids inside the same Move-to-list dialog. **Both gated by `isStagingView`.** There
is deliberately **no hardcoded position→list mapping** (positions are tenant-custom free text — TeleCaller
/ Lead Executive / Counselor — and ~73% of staging leads are unassigned, so a constant fits nothing). The
"smart" part is learned from the admin's own behavior + a read of the current selection.

**(a) Remembered last target (localStorage — pre-fills the dialog).**
- Derive a stable key from the staging list id. On a `/leads-organise/[slug]` page every lead shares one
  `list_id`, so read it off the table data — **no new prop needed**:
  ```ts
  const stagingListId = isStagingView ? (localLeads[0]?.list_id ?? null) : null;
  const routeMemoryKey = stagingListId ? `leadsRoute:lastTarget:${stagingListId}` : null;
  ```
- **On dialog open** (when `moveListDialogOpen` becomes true, `isStagingView`, and the user hasn't already
  picked): read `localStorage[routeMemoryKey]` → `{ list_id, assigned_to }`. Pre-select `moveListId` to the
  remembered `list_id` **only if that list still exists in `leadLists`**; pre-select `moveAssignTo` to the
  remembered `assigned_to` **only if that member still exists in `teamMembers`** (else leave `"keep"`).
  Guard all access with `typeof window !== "undefined"` and wrap in `try/catch` (localStorage can throw).
- **On successful move** (in `handleBulkMove`, after the loop succeeds): persist
  `{ list_id: moveListId, assigned_to: moveAssignTo === "keep" ? null : moveAssignTo }` to
  `localStorage[routeMemoryKey]`. So the next batch from the same staging list defaults to where the last
  one went — the admin just adjusts when needed.
- Implementation note: a small `useEffect` keyed on `[moveListDialogOpen]` is the cleanest hydration point.
  Do not overwrite a value the user already changed within the same open session.

**(b) Assignment hint line (read of the current selection).**
Inside the dialog (above the "Assign to" picker), render one muted line describing the selection's current
ownership, computed from the selected leads' `assigned_to` + `memberMap`:
- All selected share **one** non-null assignee → `"All selected are assigned to <name> — 'Keep current assignee' leaves them with this owner."`
- All selected are **unassigned** → `"Selected leads are unassigned — pick a member to assign them on route."`
- **Mixed** (multiple distinct assignees / some null) → `"Selected leads have mixed assignees — choosing a member reassigns all of them."`
Compute distinct current assignees over `Array.from(selectedIds)` mapped through `localLeads`; resolve names
via `memberMap[assigned_to]`. Presentation only — it does not change what gets sent.

## Explicitly OUT of scope (do not build)
- No new "guided routing panel" — we deliberately reuse the table's existing filters + selection.
- No migration, no `lead_lists.meta` column, **no hardcoded position→list mapping constant**.
- No per-row assignee editor inside the dialog.
- The smart suggestion is **localStorage + selection-read only** — no server persistence, no new API, no
  cross-device memory.
- Do **not** change the standalone Assign dialog or the main-pipeline `/leads` move dialog.

## Gates / report
- `npm run build` clean.
- `npx eslint --max-warnings 50` clean.
- Branch off latest `stage`: `git checkout stage && git pull && git checkout -b feature/leads-organise-combined-route`.
- Commit with a clear message. Then **STOP and report**: commit hash, the diff, both gate outputs, and any
  deviation. Do **NOT** push / PR / merge / prod — Opus reviews, then drives the stage push.

## What Sadin will verify in dev (you don't need to log in)
- On `/leads-organise/[slug]`: select leads → **Move to list** dialog now shows an **"Assign to (optional)"**
  picker; choosing a member routes + reassigns in one click; "Keep current assignee" leaves owners intact;
  "Unassign" clears them.
- **Smart suggestion:** route a batch to list X → open the dialog again on the same staging list → list X
  (and the chosen assignee) is **pre-selected**. The hint line correctly reads "assigned to <name>" /
  "unassigned" / "mixed assignees" for the current selection.
- On main `/leads`: the Move-to-list dialog is **unchanged** (no assignee picker, no hint, no memory).
