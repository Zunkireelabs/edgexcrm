# ASK ORCA — Orca-tab assistant view (UI only) — Sonnet Build Brief

> **Source of truth:** this brief. Small, additive, UI-only.
> **You are the executor (Sonnet).** New branch, **STOP AT REVIEW** — no merge, no stage/main push. Read `CLAUDE.md` first.

---

## 0. Hard rules

1. **Branch:** `git checkout stage && git pull --rebase origin stage && git checkout -b feature/ask-orca`. (Separate from the deals work.)
2. **STOP AT REVIEW.** Commit + push the branch only. No merge, no stage/main.
3. **No new dependencies.** `framer-motion` is NOT in this project — do **not** add it. Use Tailwind/CSS for any fade-in (e.g. an `animate-in fade-in` utility if available, or a simple CSS transition, or omit the animation). Reuse the existing `src/components/ui/button.tsx` and `src/components/ui/textarea.tsx`.
4. **UI ONLY.** No backend, no API, no state persistence, no migration. The input does not submit anywhere; the toolbar/send buttons are visual no-ops (render them, but they do nothing — or are `disabled`). No network calls.
5. **Both gates green:** `npm run build` clean **AND** `npx eslint --max-warnings 50` 0 errors.
6. Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## 1. What you're building

A new **"Ask Orca"** item in the **Orca tab** left-nav, placed **right after "Overview"**, rendering a static port of the Orca app's *"What can I do for you?"* assistant screen. It is **ungated** — it appears wherever the Orca tab already appears (the Orca tab is currently universal; do NOT add any feature gate or industry check — match the other Orca pages).

**Reference UI (mirror this look):** `/Users/sadinshrestha/Projects/orca/src/components/features/new-task-section.tsx` (empty-state JSX, ~lines 486–511) + `/Users/sadinshrestha/Projects/orca/src/components/features/chat-suggestions.tsx`. The Orca app is also Next.js 16 + Tailwind v4 + shadcn, so the markup ports almost directly.

---

## 2. Three changes

### 2a. Nav item — `src/components/dashboard/shell.tsx`
In the `ORCA_NAV` array (around line 77), insert a second entry right after the `/orca` (Overview) item:
```ts
const ORCA_NAV = [
  { href: "/orca", label: "Overview", icon: LayoutDashboard },
  { href: "/orca/activity", label: "Ask Orca", icon: MessageSquare },  // NEW
  { href: "/orca/structure", label: "Org Structure", icon: Network },
  // ...unchanged
];
```
`MessageSquare` is a lucide icon — ensure it's imported at the top of `shell.tsx` (it's already referenced in the `INDUSTRY_ICONS` registry, so the import likely exists; add it to the lucide import if not). Route path is `/orca/activity`; the visible label is **"Ask Orca"**.

### 2b. Page route — `src/app/(main)/(dashboard)/orca/activity/page.tsx`
Mirror the existing minimal Orca page pattern (see `src/app/(main)/(dashboard)/orca/agents/page.tsx`):
```ts
import { redirect } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { AskOrcaContent } from "@/components/dashboard/orca/ask-orca-content";

export default async function OrcaActivityPage() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  return <AskOrcaContent />;
}
```
(No `getFeatureAccess` — matches the other Orca pages, which are ungated.)

### 2c. Component — `src/components/dashboard/orca/ask-orca-content.tsx`
A client component (`"use client"`) rendering the static assistant screen. Structure (port from the reference, adapt to our primitives + design tokens):

- **Centered container:** `flex flex-col items-center justify-center min-h-[60vh]`, inner `w-full max-w-2xl`.
- **Heading:** `<h1 class="text-3xl font-semibold text-center mb-8 tracking-[-0.025em]">What can I do for you?</h1>`
- **Composer card:** `relative bg-card rounded-2xl border border-border shadow-sm overflow-hidden`, containing:
  - A `<Textarea>` (our shadcn one): placeholder `"Ask anything or start a task..."`, `rows={3}`, `min-h-[100px] resize-none border-0 focus-visible:ring-0 text-base p-4 bg-transparent`.
  - A toolbar row `flex items-center justify-between p-3`:
    - **Left:** two ghost icon buttons — `Plus` (attach) and `Wrench` (tools), `h-8 w-8 text-muted-foreground`.
    - **Right:** `AudioLines` (voice) + `Mic` (mic) ghost icon buttons (`h-8 w-8 rounded-full text-muted-foreground`), then a primary **send** button `ArrowUp` (`h-8 w-8 rounded-full bg-primary text-primary-foreground hover:bg-primary/90`).
  - All buttons are **visual only** (no `onClick` logic; you may set `disabled` or leave them inert). Icons from `lucide-react`: `Plus, Wrench, AudioLines, Mic, ArrowUp`.
- **Suggestion chips block** (`mt-4`):
  - `<p class="text-xs text-muted-foreground text-center mb-3">Try asking Orca:</p>`
  - A `flex flex-wrap justify-center gap-2` row of pill buttons, each: `flex items-center gap-2 px-4 py-2 bg-card border border-border rounded-full text-[12px] font-medium text-muted-foreground hover:border-muted-foreground hover:text-foreground transition-colors`.
  - Chip labels (hardcoded const, same as the Orca app): **"Create a new lead", "Show my pipeline", "Assign leads to sales reps", "Send follow-up email"**. Clicking a chip is a no-op (or could fill the textarea via local `useState` — optional; not required).
- Use our existing design tokens (`bg-card`, `border-border`, `text-foreground`, `text-muted-foreground`, `bg-primary`, `text-primary-foreground`) so it matches EdgeX theming. **Skip dark-mode-specific zinc/violet classes** from the reference unless they map cleanly — keep it to our tokens.
- Optional entrance fade: Tailwind only (no framer-motion). If unsure, omit it — static is fine.

---

## 3. Verification

1. `npm run build` clean + `npx eslint --max-warnings 50` 0 errors.
2. `npm run dev` → switch the sidebar to the **Orca** tab → **"Ask Orca"** appears right after Overview → clicking it routes to `/orca/activity` and renders the centered "What can I do for you?" screen with the input, toolbar icons, and 4 suggestion chips, visually matching the reference screenshot.
3. The other Orca pages (Overview, Org Structure, Roles, Tasks, Agents, Compare) and the Ops tab are unchanged.
4. No console errors; buttons are inert (no crashes on click).

---

## 4. Handoff

Push `feature/ask-orca` only. State: commits, both gate results, a one-line confirm of the visual check, and that nothing else was touched. Opus reviews + handles promotion. This is UI-only and additive — promotion will be code-only whenever bundled.
