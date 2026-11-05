# EdgeX Design System v2

**Ticket:** EDGEX-84. **Owner:** Sadin (approves). **Status:** proposal, piloted on Pulse (EDGEX-82).
**Rule:** every decision below is rated 1–10. **Only decisions rated 9 or higher ship.** Anything lower is listed
under "Rejected" with the reason, so it doesn't creep back in.

Mockups (the visual spec): `mockups/pulse-v4-s1.png` (Pulse, no AI), `s2` (AI layer on), `s3` (person view + evidence
drawer), `s4` (tokens + components). Open `mockups/pulse-v4.html` in a browser for exact values.

Inspiration: the Zaplar hotel OS references. We keep their *principles* (calm, list-first, action carries the value,
explainable AI, learned behaviours) and change what we can do better (see §7). We do not copy their colours or layout.

---

## 1. Principles
1. **The page answers before it shows.** Lead with a sentence ("412 new leads · 31 students reached Applications · 3
   things need you"), then the evidence.
2. **One loud thing per screen.** Only the next decision gets the ink button. Everything else is quiet.
3. **Lists over card walls.** Rows read like sentences and scan top to bottom.
4. **Every number is a door.** Click any figure to see the exact records. No dead numbers.
5. **AI is quiet and accountable.** It is marked, attributed, rated for confidence, and never decorative.
6. **Same component, same meaning, everywhere.** If red means "worse than usual" on Pulse, it means that on Leads too.

## 2. Tokens

### Colour
| Token | Value | Use, and only this use |
|---|---|---|
| `canvas` | `#f6f6f5` | App background behind the frame |
| `surface` | `#ffffff` | The working frame, cards, drawers |
| `sunken` | `#fafaf9` | Table headers, group rows, expanded rows |
| `border` / `divider` | `#e8e8e6` / `#f0f0ee` | 1px outlines / row separators |
| `ink` | `#141414` | Titles, key numbers, **the one primary action** |
| `text` / `muted` / `faint` / `ghost` | `#3a3a38` / `#73736f` / `#a3a39e` / `#d6d6d2` | Body / meta / captions / zero and n/a |
| `accent` | `#2272B4` (existing brand blue) | Links, data lines, selection. Never a fill for buttons. |
| `good` / `bad` / `warn` | `#127a4a` / `#b42318` / `#a15c07` | Change vs usual, flags. Text colour only, no fills. |
| `ai` / `ai-soft` / `ai-line` | `#5b47d6` / `#f3f1fd` / `#d9d3fa` | **Only** where Orca wrote or suggested something |

### Type: Inter, three weights (400/500/600), tabular numbers everywhere
| Role | Size / weight |
|---|---|
| Page title | 26 / 600, −0.02em |
| Section title | 15 / 600 |
| Lede, AI prose | 14–14.5 / 400 |
| Body, rows, cells | 13–13.5 / 400 |
| Meta, captions | 12.5 / 400, muted |
| Section label | 11 / 500, uppercase, 0.06em, faint |
| Big metric | 30 / 600, −0.02em |

### Space, radius, elevation
- 4px grid. Page padding 36. Gap between sections 30. Rows 44–50. Controls 30px high.
- Radius: 8 (controls), 12 (cards, tables), 16 (the frame).
- 1px borders define structure. **Shadows only on things that float** (drawers, popovers, menus).

## 3. Shell
- **The frame:** a white working surface inset on the canvas (radius 16), with a slim top bar (breadcrumb · search ⌘K ·
  notifications).
- **The sidebar is grouped by job**, sentence case, collapsible groups, counts in muted text, and a black dot badge only
  for unread items:
  - **Quick action (⌘J)** at the top: new lead / task / application / note.
  - **Daily:** Home · Inbox · My tasks
  - **Insights:** Pulse · Dashboards · Knowledge base
  - **Leads:** All leads · Pipeline · Organise · Contacts
  - **Students:** Applications · Classes · Check-in
  - **Grow** (collapsed by default): Forms · Campaigns · SMS · Email · Outreach
  - **Footer:** Archive (the recycle bin merges into it) · Settings · profile
- Implementation: education adopts the existing data-driven `resolveNavSections` (the IT agency already uses it), so
  `shell.tsx` keeps one code path and stays conflict-light.

## 4. Components

**Metric tile.** Label, with the change vs the comparison period top-right. Big number, sparkline beside it. A caption
line with the comparison and the conversion ("109 last week · 23% of qualified"). Tiles sit in one bordered strip,
separated by dividers.

**Attention row.** This is the core pattern of the product.
- Layout: `icon · Subject · what happened ……… key figure · [Action carrying the value] ›`
- Grouped by **Needs action / Heads-up / Wins** with filter pills and counts.
- **Expands** to show:
  - one plain sentence of why
  - a metadata line using `·` separators
  - links ("See the 34 leads →")
  - Dismiss, which is logged
- **The primary button always names the concrete action:** "Reassign 12 to Anil KC", never "Take action".

**Data table.**
- One metric per column, right-aligned, tabular.
- Column groups with small uppercase labels.
- Change vs usual in a fixed slot. It shows only when the value is ≥25% off and the usual is ≥5.
- `0` faint means none this period. `–` ghost means not part of this role.
- Group subtotal rows and a total row.
- A 2px red or amber left edge for flagged rows. Flags appear as text in the person line, not as chips.
- Hover a number to see this week / usual / last week. Click it for the records.
- Sticky header and first column. Horizontal scroll below 1280px with a fade edge.

**Drawer.** It slides from the right with a breadcrumb title and stays scoped. The person view and the evidence list
share the same rhythm.

**Buttons.** Primary (ink, one per region) · Secondary (outline) · Ghost (text) · Link (accent, with "→"). Filter pills
for categories, a segmented control for time windows.

## 5. AI visual language (replaces the v2 gradient language, which read as AI slop)
- **Mark:** a small violet sparkle plus a label ("Orca's read", "Suggested"). No gradients, glows or animated shimmer.
- **AI prose:** a thin violet left rule and a byline with **provenance** ("9:00 AM · from 2,316 activity records").
- **Confidence:** a 4-bar meter plus a word (Likely / Very likely), and the evidence that earned it.
- **AI suggestions** use the normal attention row with a "Suggested" tag, so AI work sits in the same queue as human
  work. "Approve all" appears only when every item is an AI suggestion.
- **Ask Orca:** a right rail that docks and collapses, with steps shown ("Finished in 3 steps"), inline charts, and links
  to records.
- **AI off:** every AI element disappears. The data and rule-based items stay and work (Pulse slice 1 *is* this state).

## 6. Decision log
| # | Decision | Rating | Why |
|---|---|---|---|
| D1 | Neutral canvas + white frame, ink for the single primary action, blue for data and links only | **9.5** | Calmest hierarchy; keeps EdgeX's black/blue identity instead of borrowing Zaplar's green |
| D2 | Inter, 3 weights, tabular numbers, the type scale above | **9** | Matches the existing font (no migration cost), and its numbers align in tables |
| D3 | 4px grid, radius 8/12/16, borders for structure, shadows only on floating layers | **9** | Removes today's mixed radii and decorative shadows |
| D4 | Sidebar grouped by job, plus Quick action, built on `resolveNavSections` | **9** | Scales as features grow; reuses a proven mechanism; one code path in `shell.tsx` |
| D5 | Page lede as a computed sentence | **9.5** | Answers before it shows; costs nothing |
| D6 | One "Needs your attention" list with Needs action / Heads-up / Wins (merges Key changes and Needs you) | **9.5** | Removes the duplication v2 had; one queue to work through |
| D7 | The primary button carries the concrete action and value | **9.5** | Faster decisions; the action is self-explaining |
| D8 | Metric strip: 4 tiles, change top-right, sparkline, caption with conversion | **9** | Dense but calm; conversion no longer overlaps numbers |
| D9 | Scoreboard: one metric per column, groups, fixed delta slot, threshold rule, `0` vs `–`, subtotals | **9** | Fixed the "cramped" table: aligned, scannable, no blobs or chips |
| D10 | Flags as coloured text in the person line, plus a 2px row edge | **9** | Visible without shouting; no chip clutter |
| D11 | Quiet AI language (violet mark, byline + provenance, confidence meter), no gradients | **9.5** | Trustworthy and premium; fixes v2's AI slop |
| D12 | AI suggestions live in the same attention queue, tagged "Suggested" | **9** | One place to act; AI is a teammate, not a separate inbox |
| D13 | Docked Ask Orca rail with steps, inline charts and record links | **9** | Follow-ups without leaving context |
| D14 | Hover = usual / last week; click = records, on every number | **9.5** | Every number is a door; no dead ends |

### Rejected (below 9, not shipping)
| Idea | Rating | Why not |
|---|---|---|
| Browser-style workspace tabs (Zaplar) | 7 | Heavy routing/state work; our users run one page at a time today |
| Donut/ring charts for KPIs | 6 | Low information density; hard to compare |
| A card per person instead of a table | 6 | Can't compare people side by side |
| Gradient AI badges and glow (our own v2) | 5 | Reads as AI slop; the decoration carries no meaning |
| Trend sparkline column inside the scoreboard | 8 | Pushed results off-screen; it lives in the person view instead |
| Per-cell background magnitude bars | 6 | Turned into random tinted blobs; no readable meaning |
| Change figures on every stage-move column | 8 | Noise; kept for intake, activity and results only |

## 7. Where we go beyond Zaplar
1. **Provenance on every AI sentence** (the record count and time), not just a confidence chip.
2. **"0 vs –" honesty in tables:** we never show a dash for "none" or a zero for "not applicable".
3. **Delta threshold rule:** changes appear only when they matter, which keeps tables quiet.
4. **Credit rules shown in context** ("credited to whoever held the lead before the move").
5. **Wins as a category**, so the attention list isn't only bad news, and people get recognised.
6. **Self-optimising next** (EDGEX-83+): a "What Orca has learned about how your team works" screen, with learned
   habits, evidence counts ("9 of 10"), Applied toggles, and Pause / Forget, so the owner stays in control.

## 8. Rollout (after Sadin approves; each step is its own ticket and PR)
1. **Tokens + primitives.** Add the token set to `globals.css` alongside the existing tokens (no visual change yet).
   Restyle `Button`, `Badge`, `Table`, `Tabs`/segmented control and `Sheet` to v2.
2. **Pulse** (EDGEX-82) built against these mockups. It's the pilot.
3. **The shell:** sidebar regroup + frame. This touches shared `shell.tsx`, so it ships alone and gets rebased carefully.
4. **Page by page:** Home → Leads → Lead detail → Applications → the rest. Each page is rated against this doc before
   merging.
