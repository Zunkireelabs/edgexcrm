# Check-In Assignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let front-desk check-in set a lead's owning counselor (`leads.assigned_to`) — and, for un-triaged leads, move them to Qualified/Prospect — in the same action, for `education_consultancy` only, without disturbing the per-visit "Meet With" note.

**Architecture:** Extend the existing check-in POST (`/api/v1/leads/[id]/check-in`) with two optional body fields (`assign_to_id`, `move_to_stage`) applied atomically alongside the note insert (Approach A). Surface the lead's current stage slug in the check-in search results so the UI can render stage-keyed triage controls on the lead-details panel. No schema change.

**Tech Stack:** Next.js 16 App Router route handlers, React 19 client component, Supabase service client, shadcn `Select`, Tailwind v4.

## Global Constraints

- **No test runner exists in this repo.** Per-task gates are `npm run build` (must be clean) and `npm run lint`, plus the manual UI matrix in Task 4. Do NOT scaffold a test framework.
- **Education gate:** all new behavior is active only when `industryId === "education_consultancy"` (client) / `auth.industryId === "education_consultancy"` (server). travel_agency and every other check-in tenant must be byte-for-byte unchanged.
- **Stage slugs are the source of truth**, not display names: `qualified`, `prospects`, `applications`. "Prospect" stage = slug `prospects`.
- **Meet With (`lead_notes.meet_with_id`) is never touched** by this work.
- **Qualification hard-block is bypassed** on the explicit check-in path — do NOT call `hasProspectQualification` / `canBypassProspectQualification` in the new explicit branch.
- **Checker fallback fills only an empty owner** — never overwrite an existing `leads.assigned_to`. An explicit pick always wins.
- Follow existing route patterns: `authenticateRequest()` → `getFeatureAccess()` → `createServiceClient()` with explicit `.eq("tenant_id", auth.tenantId)` on every lead query.
- Commit after each task with the shown message. Do NOT push (project rule: no push without explicit permission).

## File Structure

- `src/app/(main)/api/v1/leads/check-in/route.ts` — GET search. Add `slug` to the `lead_lists` sub-select; expose `list_slug` + `assigned_to` in each result row. (Task 1)
- `src/industries/_shared/features/check-in/ui.tsx` — `LeadResult` type gains `list_slug` + `assigned_to`; detail panel gains stage-keyed triage controls; `handleCheckIn` sends the new fields; reset the new state. (Task 1 type field, Task 3 UI)
- `src/app/(main)/api/v1/leads/[id]/check-in/route.ts` — POST. Parse `assign_to_id` + `move_to_stage`; when an explicit triage decision is present (education), apply move+assign and skip the heuristic auto-promotion; otherwise run the existing auto-promotion unchanged. (Task 2)

---

### Task 1: Surface current stage slug + assignee id in check-in search

**Files:**
- Modify: `src/app/(main)/api/v1/leads/check-in/route.ts:36` (sub-select) and `:58-76` (result map)
- Modify: `src/industries/_shared/features/check-in/ui.tsx:57-69` (`LeadResult` interface)

**Interfaces:**
- Produces: each check-in search result row now includes `list_slug: string | null` and `assigned_to: string | null`. Task 3's UI consumes `selectedLead.list_slug` to gate controls.

- [ ] **Step 1: Add `slug` to the `lead_lists` sub-select**

In `src/app/(main)/api/v1/leads/check-in/route.ts`, change the select (line ~36):

```ts
      lead_lists!leads_list_id_fkey(name, slug)
```

- [ ] **Step 2: Expose `list_slug` and `assigned_to` in the result map**

Same file, in the `results` map (line ~61 and the returned object ~62-76):

```ts
    const list = lead.lead_lists as unknown as { name: string; slug: string | null } | null;
    return {
      id: lead.id,
      first_name: lead.first_name,
      last_name: lead.last_name,
      email: lead.email,
      phone: lead.phone,
      stage_id: lead.stage_id,
      pipeline_id: lead.pipeline_id,
      stage_name: stage?.name || null,
      stage_color: stage?.color || null,
      pipeline_name: pipeline?.name || null,
      list_name: list?.name || null,
      list_slug: list?.slug || null,
      assigned_to: lead.assigned_to || null,
      assigned_to_name: lead.assigned_to ? nameById.get(lead.assigned_to) ?? null : null,
      created_at: lead.created_at,
    };
```

(`lead.assigned_to` is already in the top-level select at line 33 — no select change needed for it.)

- [ ] **Step 3: Extend the `LeadResult` type**

In `src/industries/_shared/features/check-in/ui.tsx`, add two fields to the `LeadResult` interface (after line 67):

```ts
interface LeadResult {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  stage_name: string | null;
  stage_color: string | null;
  pipeline_name: string | null;
  list_name: string | null;
  list_slug: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  created_at: string;
}
```

- [ ] **Step 4: Build gate**

Run: `npm run build`
Expected: clean build, no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(main\)/api/v1/leads/check-in/route.ts src/industries/_shared/features/check-in/ui.tsx
git commit -m "feat(check-in): expose lead stage slug + assignee id in check-in search"
```

---

### Task 2: Extend check-in POST with explicit move + assign

**Files:**
- Modify: `src/app/(main)/api/v1/leads/[id]/check-in/route.ts` — body parse (~45-55) and the auto-promotion region (~84-193)

**Interfaces:**
- Consumes: request body may include `assign_to_id: string | null` and `move_to_stage: "qualified" | "prospects" | null`.
- Produces: `POST /api/v1/leads/:id/check-in` writes `leads.assigned_to` and/or `leads.list_id` (+ pipeline/stage/status + un-archive) atomically for education tenants when an explicit triage decision is present; otherwise unchanged.

- [ ] **Step 1: Parse the two new optional body fields**

In the `try { const body = await request.json(); ... }` block (lines ~47-55), add after `meetWithId`:

```ts
  let reason = "";
  let meetWithId: string | null = null;
  let assignToId: string | null = null;
  let moveToStage: "qualified" | "prospects" | null = null;
  try {
    const body = await request.json();
    reason = (body.reason as string) || "";
    // Per-visit "meet with" person, stored on THIS check-in note — distinct from
    // lead.assigned_to (the counselor). Optional.
    meetWithId = (body.meet_with_id as string) || null;
    // Explicit front-desk triage (education only): owning counselor + optional stage move.
    assignToId = (body.assign_to_id as string) || null;
    const mv = body.move_to_stage as string | undefined;
    moveToStage = mv === "qualified" || mv === "prospects" ? mv : null;
  } catch {
    // No body is fine
  }
```

- [ ] **Step 2: Decide explicit vs heuristic, before the auto-promotion block**

Replace the auto-promotion region. The existing block runs from the comment `// Auto-promotion (...)` (line ~84) through its closing `catch` (line ~193). Wrap it so an explicit triage decision takes over and the heuristic is skipped.

Insert this immediately after the `if (error) { ... }` note-insert guard (after line ~82), and BEFORE the existing `let assignedIsCounselor = false;` line:

```ts
  const isEducation = auth.industryId === "education_consultancy";

  // Current stage slug (source of truth for triage decisions).
  let currentSlug: string | null = null;
  if (lead.list_id) {
    const { data: cur } = await supabase
      .from("lead_lists")
      .select("slug")
      .eq("id", lead.list_id)
      .maybeSingle();
    currentSlug = cur?.slug ?? null;
  }

  // An explicit triage decision is present when the front desk asked to move the lead,
  // OR the lead is already in Qualified (where a blank picker means "assign the checker").
  const explicitTriage =
    isEducation && (moveToStage !== null || currentSlug === "qualified");

  if (explicitTriage) {
    try {
      const targetSlug = moveToStage; // null = stay in current (qualified in-place)

      // Assignment rule:
      //   qualified target/in-place → picked, else keep existing, else the checker.
      //   prospects target          → picked, else keep existing (no checker fallback).
      const effectiveTargetIsQualified =
        targetSlug === "qualified" || (targetSlug === null && currentSlug === "qualified");
      let newAssigned: string | null;
      if (assignToId) {
        newAssigned = assignToId;
      } else if (lead.assigned_to) {
        newAssigned = lead.assigned_to; // never overwrite an existing owner with blank
      } else {
        newAssigned = effectiveTargetIsQualified ? auth.userId : null;
      }

      const updatePayload: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      if (newAssigned !== lead.assigned_to) updatePayload.assigned_to = newAssigned;

      if (targetSlug) {
        const { data: target } = await supabase
          .from("lead_lists")
          .select("id, pipeline_id")
          .eq("tenant_id", auth.tenantId)
          .eq("slug", targetSlug)
          .maybeSingle();
        if (target) {
          updatePayload.list_id = target.id;
          if (targetSlug === "prospects") updatePayload.lead_type = "prospect";
          if (target.pipeline_id) {
            const landing = await getPipelineLandingStage(supabase, target.pipeline_id);
            if (landing) {
              updatePayload.pipeline_id = target.pipeline_id;
              updatePayload.stage_id = landing.id;
              updatePayload.status = landing.slug;
            }
          }
          // Un-archive (mirror the auto-promotion path).
          if (lead.archived_at) {
            updatePayload.archived_at = null;
            updatePayload.archived_by = null;
            updatePayload.archived_from_list_id = null;
            updatePayload.archived_from_status = null;
          }
        }
      }

      // Only write if something actually changed beyond updated_at.
      if (Object.keys(updatePayload).length > 1) {
        const { error: triageError } = await supabase
          .from("leads")
          .update(updatePayload)
          .eq("id", id)
          .eq("tenant_id", auth.tenantId);
        if (triageError) {
          logger.error({ err: triageError, leadId: id }, "Failed to apply check-in triage");
        }
      }
    } catch (triageErr) {
      logger.error({ err: triageErr, leadId: id }, "Unexpected error applying check-in triage");
    }

    return apiSuccess({ checked_in: true, lead_id: id });
  }
```

The `return apiSuccess(...)` above means the existing heuristic auto-promotion block below runs ONLY when `explicitTriage` is false — i.e. no move requested and the lead is not in-place Qualified. Leave the entire existing auto-promotion block (lines ~84-193) and the final `return apiSuccess(...)` (line ~195) exactly as they are.

- [ ] **Step 3: Confirm imports already present**

`getPipelineLandingStage` (line 3) and `logger` (line 5) are already imported. No new imports needed. `hasProspectQualification` / `canBypassProspectQualification` are intentionally NOT called in the explicit branch (block bypassed by design).

- [ ] **Step 4: Build gate**

Run: `npm run build`
Expected: clean build, no TypeScript errors.

- [ ] **Step 5: Smoke-test the endpoint against stage (optional but recommended)**

With the dev server running against stage, log in as `admin@zunkireelabs.com` (education tenant Admizz) and run a manual `curl`/devtools POST is not required here — Task 4 covers behavioral verification through the UI. If verifying now, confirm a 200 `{ "data": { "checked_in": true } }` shape.

- [ ] **Step 6: Commit**

```bash
git add src/app/\(main\)/api/v1/leads/\[id\]/check-in/route.ts
git commit -m "feat(check-in): apply explicit stage-move + counselor assignment on check-in"
```

---

### Task 3: Stage-keyed triage controls on the check-in lead-details panel

**Files:**
- Modify: `src/industries/_shared/features/check-in/ui.tsx` — new state (~214), reset points (~377-380 and ~400-404), detail-panel controls (insert before the Meet With block at ~1511), `handleCheckIn` body (~391)

**Interfaces:**
- Consumes: `selectedLead.list_slug`, `counselorMembers` (already defined at line ~206).
- Produces: `handleCheckIn` POST body now carries `assign_to_id` + `move_to_stage`.

- [ ] **Step 1: Add triage state**

In `src/industries/_shared/features/check-in/ui.tsx`, next to `const [meetWithId, setMeetWithId] = useState<string>("");` (line ~214), add:

```ts
  const [meetWithId, setMeetWithId] = useState<string>("");
  const [assignToId, setAssignToId] = useState<string>("");
  const [moveToStage, setMoveToStage] = useState<string>("");
```

- [ ] **Step 2: Reset triage state on close and after check-in**

In `handleCloseDetails` (line ~377-380), add the resets:

```ts
  const handleCloseDetails = () => {
    setSelectedLead(null);
    setLeadDetails(null);
    setAssignToId("");
    setMoveToStage("");
  };
```

In `handleCheckIn`, in the success path where `setMeetWithId("")` is called (line ~403), add:

```ts
      setMeetWithId("");
      setAssignToId("");
      setMoveToStage("");
```

- [ ] **Step 3: Send the new fields in the check-in POST body**

In `handleCheckIn` (line ~388-392), change the fetch body:

```ts
      const res = await fetch(`/api/v1/leads/${leadId}/check-in`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          meet_with_id: meetWithId || null,
          assign_to_id: assignToId || null,
          move_to_stage: moveToStage || null,
        }),
      });
```

- [ ] **Step 4: Render the stage-keyed triage controls**

In the detail panel, immediately BEFORE the `{/* Meet with — who the visitor is meeting today */}` block (line ~1511), insert:

```tsx
            {/* Education triage: assign an owning counselor, and move un-triaged leads
                into Qualified/Prospect. Hidden for leads already in Prospects (they
                already have a counselor). Meet With below is separate and untouched. */}
            {industryId === "education_consultancy" && selectedLead.list_slug !== "prospects" && (
              <div className="mb-4 space-y-3">
                {selectedLead.list_slug !== "qualified" && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Move to stage</p>
                    <Select value={moveToStage || "__none__"} onValueChange={(v) => setMoveToStage(v === "__none__" ? "" : v)}>
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder="Keep current stage" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Keep current stage</SelectItem>
                        <SelectItem value="qualified">Qualified</SelectItem>
                        <SelectItem value="prospects">Prospect</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {(selectedLead.list_slug === "qualified" || moveToStage) && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Assign to</p>
                    <Select value={assignToId || "__none__"} onValueChange={(v) => setAssignToId(v === "__none__" ? "" : v)}>
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder="Assign counselor (optional)" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">No one selected</SelectItem>
                        {counselorMembers.map((m) => (
                          <SelectItem key={m.user_id} value={m.user_id}>
                            {m.name || m.email.split("@")[0]} ({m.position_name ?? m.role})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            )}
```

- [ ] **Step 5: Build + lint gate**

Run: `npm run build && npm run lint`
Expected: clean build, no new lint errors.

- [ ] **Step 6: Commit**

```bash
git add src/industries/_shared/features/check-in/ui.tsx
git commit -m "feat(check-in): stage-keyed assign/move-to controls on lead-details panel"
```

---

### Task 4: Manual verification matrix + docs note

**Files:**
- Modify: `docs/FEATURE-CATALOG.md` (update the check-in row's notes with the assign-on-check-in capability)

**Interfaces:** none.

- [ ] **Step 1: Run the dev server against stage**

Run: `npm run dev`
Log in at `dev-lead-crm.zunkireelabs.com` (or localhost) as `admin@zunkireelabs.com` / stage password, into the **Admizz** (education_consultancy) tenant. Go to Check-In.

- [ ] **Step 2: Walk the education matrix** (search a lead, open details, Check In, then verify the lead's Stage + Assigned To on the Pipeline/Leads page)

Confirm each row:

- Lead already in **Prospect** → panel shows Meet With only (no Move/Assign controls). Check in → `assigned_to` unchanged.
- Lead in **Qualified**, pick a counselor → after check-in, Assigned To = picked.
- Lead in **Qualified**, leave Assign blank, lead was Unassigned → Assigned To = you (the checker).
- Lead in **Qualified**, leave Assign blank, lead already had an owner → owner unchanged.
- **New/Archived** lead, Move to Qualified + blank → lead moves to Qualified, Assigned To = you.
- **New/Archived** lead, Move to Prospect + pick counselor → lead moves to Prospects, Assigned To = picked, even for an unqualified student (block bypassed).
- **New/Archived** lead, Move to Prospect + blank → moves to Prospects, Assigned To stays Unassigned.
- Any stage, plain check-in (no Move/Assign, optional Meet With) → visit recorded, `assigned_to` untouched, Meet With saved as before.

- [ ] **Step 3: Confirm non-education is unchanged**

Log into a **travel_agency** tenant (or switch industry), open Check-In → NO Move/Assign controls appear; check-in behaves exactly as before. (If no travel tenant is handy on stage, confirm via code that the block is gated on `industryId === "education_consultancy"`.)

- [ ] **Step 4: Update the feature catalog**

In `docs/FEATURE-CATALOG.md`, find the check-in row and append to its notes: `Education check-in can assign an owning counselor and move New/Qualified leads into Qualified/Prospect (Prospect blank = move only; Qualified blank = checker becomes owner); qualification block bypassed on this path.`

- [ ] **Step 5: Commit**

```bash
git add docs/FEATURE-CATALOG.md
git commit -m "docs(check-in): note assign/move-on-check-in in feature catalog"
```

---

## Self-Review

**Spec coverage:**
- Prospect in-place = Meet With only → Task 3 Step 4 (`list_slug !== "prospects"` hides block). ✓
- Qualified: picked/blank→checker/blank+assigned→keep → Task 2 Step 2 assignment rule. ✓
- Other stages: Move to (Qualified|Prospect) then Assign To → Task 3 Step 4 controls; Task 2 target resolution. ✓
- Prospect target blank → move only, no checker → Task 2 (`effectiveTargetIsQualified` false → `newAssigned` stays null when unassigned). ✓
- Optional triage → controls default empty; empty body fields → no explicit write for non-qualified stages. ✓
- Education only → Global Constraint + gates in Tasks 2 & 3. ✓
- Qualification bypass → Task 2 Step 3 (no qualification call in explicit branch). ✓
- Meet With untouched → no change to Meet With block. ✓
- Never overwrite existing owner with blank → Task 2 (`else if (lead.assigned_to) newAssigned = lead.assigned_to`). ✓
- Atomic single call → all writes in Task 2's one `leads.update`. ✓

**Placeholder scan:** none — every step has concrete code. ✓

**Type consistency:** `list_slug`/`assigned_to` added in Task 1 (route + type) and consumed in Task 3; `assign_to_id`/`move_to_stage` produced by Task 3 body and parsed in Task 2. Names match across tasks. ✓
