# EdgeX Design System v2

**Ticket:** EDGEX-84. **Owner:** Sadin (approves). **Status:** proposal, piloted on Pulse (EDGEX-82).
**Rule:** every decision below is rated 1–10. **Only decisions rated 9 or higher ship.** Anything lower is listed
under "Rejected" with the reason, so it doesn't creep back in.

Mockups (the visual spec): **`mockups/pulse-v5-s1.png` (the approved Pulse page, AI layer in Preview mode)**, `mockups/pulse-v4-s1.png` (Pulse, no AI), `s2` (AI layer on), `s3` (person view + evidence
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

## 5. AI visual language
Calm everywhere else, so AI can stand out with a **subtle** signature (Sadin's call, 2026-11-05, after reviewing v2/v4):
- **AI surfaces** (the briefing card, the coaching card, the Orca rail):
  - a soft blue→violet top-to-white wash (`#f4f8fe → #fbfbff → #fff`)
  - a 2px blue→violet top line
  - a gradient sparkle badge
  - a faint violet shadow
- **AI paragraph block:** any AI-written paragraph sits on a soft blue→violet wash block (radius 12) with a sparkle
  label ("Orca's read", "Why Orca suggests this"). Examples: Orca's read, the "why" in an expanded attention row, the
  coaching note in the person view, Ask Orca answers. Long AI text never blends into page text.
- **Inline AI** ("Suggested" tags, row notes): a soft gradient tint pill with a violet sparkle.
- **Size ladder:** label → pill · paragraph → wash block · whole section → full AI card (wash, top line, badge).
- **The ask box:** a white field with a 1px blue→violet gradient border.
- **Gradients appear ONLY on AI elements.** Plain data, tables and rule-only UI never use them, so the gradient keeps
  meaning "Orca".
- **Provenance on every AI surface:** "Orca · 9:00 AM · from 2,316 activity records". A confidence meter where a
  judgement is made.
- **Preview mode (until the LLM is switched on):** every AI slot is placed and filled from the real numbers by rules,
  so it is true, clickable and drillable, with a small **"Preview"** tag (tooltip: "Written from your data by rules.
  Full AI explanations switch on with Orca"). When the LLM activates, the same slots receive its text and the tag
  disappears. Nothing is invented, and the product already looks and works like the end state.
- **AI fully off** (tenant not consented): AI surfaces collapse to their plain rule versions with no gradient (the s3
  state).

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
| D11 | AI signature = subtle blue→violet gradient on AI surfaces only, plus provenance and confidence | **9.5** | Eye goes to AI first (Sadin's ask) while the rest stays calm; gradient = "Orca", never decoration |
| D16 | Every AI paragraph sits on the gradient wash block; Orca's read is merged into the top of the briefing card | **9.5** | One AI voice and one look; summary first, proof underneath (Sadin, 2026-11-05) |
| D15 | Preview mode: AI slots placed now and filled by rules from real data, tagged "Preview" until the LLM is on | **9.5** | The end-product feel today, with zero fake content; the LLM later just swaps the text |
| D12 | AI suggestions live in the same attention queue, tagged "Suggested" | **9** | One place to act; AI is a teammate, not a separate inbox |
| D13 | Docked Ask Orca rail with steps, inline charts and record links | **9** | Follow-ups without leaving context |
| D14 | Hover = usual / last week; click = records, on every number | **9.5** | Every number is a door; no dead ends |

### Rejected (below 9, not shipping)
| Idea | Rating | Why not |
|---|---|---|
| Browser-style workspace tabs (Zaplar) | 7 | Heavy routing/state work; our users run one page at a time today |
| Donut/ring charts for KPIs | 6 | Low information density; hard to compare |
| A card per person instead of a table | 6 | Can't compare people side by side |
| Strong gradients/glow across the page (our own v2 used them on many surfaces) | 6 | Too loud; reduced to AI surfaces only and softened (see D11) |
| Fake AI text (canned sentences) for the demo feel | 3 | Breaks trust; replaced by D15 Preview mode with real data |
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
