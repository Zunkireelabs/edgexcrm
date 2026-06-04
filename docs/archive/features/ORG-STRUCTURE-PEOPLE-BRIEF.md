# Org Structure — show actual people (face-pile + expand) — Implementation Brief

> **Owner:** Opus (plan) → Sonnet (execute) → Opus (review + CI + merge)
> **Branch:** continue on the EXISTING local branch `feat/org-structure` (migration `031` already applied to
> the shared DB; leadScope fix already committed at `9779249`). Add the people view as new commit(s) on top,
> then the whole branch merges to `stage` together.
> **Scope:** UI + one API enrichment. **No new schema. No new mutation endpoints.**

---

## Context

The org chart currently shows **position cards** with anonymous member-count dots. We now want the **actual
team members** visible too, organized as: **Layer → Position → People**. Chosen layout (locked):
- **Face-pile + expand**: each position card shows a few member avatar-initials + a count; click ▾ to expand
  the full roster, with per-person move-to-role + remove, and a "+ assign member".
- **Unassigned members tray** at the bottom of the chart for members with `position_id IS NULL`.

**Why this is cheap:** a member already links to a position (`tenant_users.position_id`) which sits in a layer,
so person→position→layer is already known. This is mostly *rendering data we already have* + reusing the
existing Team API for mutations.

**Reuse, don't rebuild — all people-mutations already exist:**
- Move a person to another role / assign an unassigned person → `PATCH /api/v1/team { user_id, position_id }`
- Remove a person → `DELETE /api/v1/team { user_id }`

**One behavior to surface (permission seam):** `PATCH /api/v1/team` **re-derives the member's role** from the
target position (`deriveRole(base_tier, leadScope)`). So moving a person between positions changes their
access. That's correct + consistent with Positions/RBAC — add a subtle one-line hint in the expanded card
("Changing a position updates this person's access"). The PATCH's existing guards (self-lockout, last-owner,
owner-tier reject) stay in force and surface as toast/alert errors.

---

## Commit A — API: enrich `GET /api/v1/org-layers` with real members

Edit `src/app/(main)/api/v1/org-layers/route.ts` GET. Replace the count-only rollup (Query 3) with a member
fetch + email enrichment, mirroring the Team route's pattern exactly
(`src/app/(main)/api/v1/team/route.ts:32-68`):

```ts
// Query 3: members (all, including position_id NULL) + email enrichment
const { data: membersRaw } = await db
  .from("tenant_users")
  .select("user_id, role, position_id")
  .order("created_at", { ascending: true });

const { data: authData } = await db.raw().auth.admin.listUsers();
const emailMap = new Map<string, string>();
for (const u of authData?.users ?? []) emailMap.set(u.id, u.email || "");

type OrgMember = { user_id: string; email: string; role: string };
const membersByPosition: Record<string, OrgMember[]> = {};
const unassignedMembers: OrgMember[] = [];
for (const m of (membersRaw ?? []) as unknown as Array<{ user_id: string; role: string; position_id: string | null }>) {
  const member: OrgMember = { user_id: m.user_id, email: emailMap.get(m.user_id) || "Unknown", role: m.role };
  if (m.position_id) (membersByPosition[m.position_id] ??= []).push(member);
  else unassignedMembers.push(member);
}
```

Each position in the result gets `members: membersByPosition[p.id] ?? []` and
`member_count: (membersByPosition[p.id] ?? []).length`. **Change the response shape** to carry the tray:
```ts
return apiSuccess({ layers: result, unassigned_members: unassignedMembers });
```
(Was a bare `result` array — now `{ layers, unassigned_members }`. The UI in Commit B updates to match.)

Still bounded: layers + positions + one `tenant_users` fetch + one `listUsers()` enrichment. Keep the gate
`canSeeNav(auth.permissions, "/team")`. No other route changes — moves/removes reuse `/api/v1/team`.

Update `src/components/dashboard/org-structure/types.ts`: add
`export interface OrgMember { user_id: string; email: string; role: string }`, and extend the position shape
in `OrgLayerWithPositions` to `Position & { member_count: number; members: OrgMember[] }`.

---

## Commit B — UI

### `position-card.tsx` — face-pile + expand
- **Collapsed:** keep the `User` icon + name + tier badge; replace the plain count-dots with a **face-pile** —
  up to 4 overlapping initial-circles (email `charAt(0).toUpperCase()`, colored bg like Team's avatars) + a
  `+N` overflow, then "N members", then a ▾ toggle button. Local `useState` for expanded.
- **Expanded:** a member list — each row = initial-circle + email + a small **role badge** (reuse the
  `roleColors` map: owner=amber, admin=blue, counselor=purple, viewer=gray) + a **move-to-role `<select>`**
  (options = `assignablePositions`, i.e. all positions with `base_tier !== "owner"`) + a remove **✕**. Below
  the list: a **"+ assign member"** control that lists `unassignedMembers` (assign one INTO this position).
  Add the one-line hint: *"Changing a position updates this person's access."*
- New props: `members: OrgMember[]`, `assignablePositions: {id,name}[]`, `unassignedMembers: OrgMember[]`,
  `onMoveMember(userId, positionId)`, `onRemoveMember(userId)`, `onAssignMember(userId, positionId)`. Keep
  `showDelete`/`onDelete` (position delete) as-is. People controls render only when `isAdmin` (pass through).

### New `unassigned-members-tray.tsx`
- Renders only when `unassignedMembers.length > 0`. A bordered tray titled "Unassigned members" with member
  chips (initial + email), each with an **"assign to role" `<select>`** (`assignablePositions`) → calls
  `onAssignMember(userId, positionId)`. Admin-only controls.

### `org-structure-editor.tsx` — wire it
- Add handlers (same `apiCall` helper + `onRefetch` pattern already there):
  - `handleMoveMember(userId, positionId)` → `PATCH /api/v1/team { user_id, position_id }` → refetch
  - `handleRemoveMember(userId)` → `DELETE /api/v1/team { user_id }` (confirm first) → refetch
  - `handleAssignMember(userId, positionId)` → same PATCH → refetch
- Compute `assignablePositions` = every position across all real layers + unassigned bucket where
  `base_tier !== "owner"` → `{ id, name }`. Pass members/handlers into each `PositionCard`. Render
  `<UnassignedMembersTray>` just above the "Add Layer" button.

### `org-structure-hierarchy.tsx` — read-only face-piles
- Show the same face-pile (initials + count) under each position card. **Read-only** — no expand actions, no
  move/remove. (A simple non-expanding avatar row is fine.)

### `org-structure-content.tsx` — new response shape
- `fetchLayers`: read `data.data.layers` into `layers` and `data.data.unassigned_members` into new state
  `unassignedMembers`. Pass `unassignedMembers` + the derived `assignablePositions` down to the editor.
  Hierarchy just needs `layers`. Manage view unchanged.

---

## Hard rules
- **No migration, no new mutation endpoints.** People moves/removes/assigns reuse `PATCH`/`DELETE /api/v1/team`.
- **Do not modify `team-management.tsx`** (still embedded unchanged as the Manage view).
- Only `GET /api/v1/org-layers` changes server-side (enrichment + response shape). Do not touch the layer
  POST/PATCH/DELETE/reorder routes or the positions routes.
- People controls are admin-only; non-admins see face-piles + names read-only.
- Emails come only from the tenant's own members (map `listUsers()` against `tenant_users` rows) — never
  expose other tenants' emails.
- Strip nothing else; this is additive to the existing org-structure UI.

---

## Verification (before reporting back)
1. **CI gates — both:** `npm run build` clean AND `npx eslint --max-warnings 50` (0 errors).
2. Migration `031` is already applied (Opus did it). On dev as Admizz admin: each position card shows real
   member initials + count; expanding Counselor lists the actual counselors with role badges.
3. Move a person from one role to another → persists; their role re-derives (verify a counselor moved to a
   member-all position becomes viewer-scope). Remove a person → drops off. Assign an unassigned member into a
   role → appears under it.
4. Any member with `position_id IS NULL` shows in the **Unassigned members** tray; assigning them clears it.
5. Self-lockout / last-owner / owner-tier moves are rejected by `/api/v1/team` and surface as an alert.
6. Counselor (non-admin) sees face-piles + Hierarchy read-only; no move/remove/assign controls; mutations 403.
7. Manage view unchanged (invite / position-edit / remove still work).

---

## Sonnet handoff prompt

```
Continue the org-structure feature per docs/ORG-STRUCTURE-PEOPLE-BRIEF.md — add ACTUAL team members to the
org chart (face-pile on each position card, expand to full roster, plus an Unassigned-members tray). Read the
brief in full first.

Work on the EXISTING local branch feat/org-structure (do NOT create a new branch; migration 031 is already
applied and the leadScope fix is already committed). Add your work as new commit(s) on top.

No new schema. No new mutation endpoints — people moves/removes/assigns reuse PATCH/DELETE /api/v1/team.

Commit A — API: edit GET /api/v1/org-layers to enrich each position with a real `members` array (mirror the
Team route's db.raw().auth.admin.listUsers() email enrichment at team/route.ts:32-68) and add a top-level
`unassigned_members`. Change the response to { layers, unassigned_members }. Update org-structure/types.ts
(OrgMember type + members on the position shape). Keep the canSeeNav("/team") gate.

Commit B — UI: position-card gets a face-pile (≤4 initials + "+N") + count + ▾ expand → member rows (initial +
email + role badge + move-to-role select + remove ✕) + "+ assign member"; add a one-line hint "Changing a
position updates this person's access." New unassigned-members-tray.tsx. Wire handlers in
org-structure-editor (handleMoveMember/handleRemoveMember/handleAssignMember → PATCH/DELETE /api/v1/team →
refetch; compute assignablePositions = all positions with base_tier !== "owner"). org-structure-hierarchy gets
read-only face-piles. org-structure-content reads the new { layers, unassigned_members } shape and passes data
down. People controls admin-only.

Hard rules (brief § Hard rules): no migration, no new endpoints, team-management.tsx untouched, only the
org-layers GET changes server-side, emails only from the tenant's own members, admin-only controls.

Verify before reporting back: npm run build clean AND npx eslint --max-warnings 50 (0 errors), then the
click-through in the brief's Verification section (real members under positions, move/remove/assign persist,
unassigned tray works, counselor read-only). Report the diff for Opus review.

Commit trailer on every commit:
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```
