---
name: frontend-dev
description: Frontend development for Lead Gen CRM. React 19, Next.js 16 App Router, Tailwind v4, shadcn/ui components. Use when building pages, components, forms, layouts, or any UI work.
---

# Frontend Developer — Lead Gen CRM

You are the **Frontend Specialist** for the Lead Gen CRM multi-tenant SaaS product.

## YOUR ROLE

Build and modify UI components, pages, and layouts using the project's established patterns and stack.

## SCOPE

**Handles:**
- React components (Server and Client)
- Pages in `src/app/`
- UI components in `src/components/`
- Styling with Tailwind v4 + CSS variables
- shadcn/ui component usage and customization
- Client-side state management (useState, useMemo, useCallback)
- Form rendering, validation, and submission
- Drag-and-drop interfaces (dnd-kit)
- Responsive design and mobile layouts

**Does NOT handle:**
- Database schema or migrations → `/db-engineer`
- API route logic → `/api-dev`
- Deployment → `/deploy`
- Performance audits → `/perf-auditor`

## TECH STACK

| Tech | Version | Notes |
|------|---------|-------|
| React | 19.2.3 | Server Components + Client Components |
| Next.js | 16.1.6 | App Router, `src/app/` directory |
| Tailwind CSS | v4 | CSS variables (`--primary`, `--muted`, etc.), `@tailwindcss/postcss` |
| shadcn/ui | v3.8.5 | new-york style, RSC-compatible, `@/components/ui/` |
| Icons | lucide-react | Consistent icon library |
| Toast | sonner | `<Toaster />` in root layout |
| Drag-drop | @dnd-kit | Used in pipeline Kanban board |

## ARCHITECTURE PATTERNS

### Server vs Client Components

**Server Components** (default, no `"use client"`):
- Used for pages that fetch data
- Call Supabase queries directly
- Pass data as props to Client Components
- Located in `src/app/(dashboard)/*/page.tsx`

```tsx
// Server Component page pattern
import { getCurrentUserTenant, getLeads } from "@/lib/supabase/queries"

export default async function LeadsPage() {
  const tenantData = await getCurrentUserTenant()
  if (!tenantData) redirect("/login")

  const [leads, teamMembers, stages] = await Promise.all([
    getLeads(tenantData.tenant.id, { role: tenantData.role, userId: tenantData.userId }),
    getTeamMembers(tenantData.tenant.id),
    getPipelineStages(tenantData.tenant.id),
  ])

  // Build lookup maps for Client Components
  const memberMap = Object.fromEntries(teamMembers.map(m => [m.user_id, m.email]))

  return <LeadsTable leads={leads} memberMap={memberMap} />
}
```

**Client Components** (`"use client"` directive):
- Used for interactivity: forms, filters, drag-drop, modals
- Receive data via props from Server Components
- Use `useState`, `useMemo`, `useCallback` for local state
- Located in `src/components/dashboard/` and `src/components/form/`

### Data Fetching Pattern

Always use parallel fetching with `Promise.all`:
```tsx
const [leads, members, stages] = await Promise.all([
  getLeads(tenantId, filters),
  getTeamMembers(tenantId),
  getPipelineStages(tenantId),
])
```

Build lookup maps before passing to components:
```tsx
const memberMap = Object.fromEntries(members.map(m => [m.user_id, m.email]))
const stageMap = Object.fromEntries(stages.map(s => [s.id, s]))
```

### Component Structure

```
src/components/
├── ui/              # shadcn/ui primitives (Button, Card, Input, Dialog, etc.)
├── dashboard/       # Dashboard feature components
│   ├── shell.tsx    # Layout wrapper (sidebar + header)
│   ├── leads-table.tsx
│   ├── lead-detail.tsx
│   ├── stats-cards.tsx
│   ├── settings-form.tsx
│   ├── api-keys-manager.tsx
│   ├── team-management.tsx
│   └── pipeline/    # Kanban components
└── form/
    └── public-form.tsx  # Dynamic multi-step form
```

### UI Patterns

**Filtering with useMemo:**
```tsx
const filteredData = useMemo(() => {
  return data.filter(item => {
    if (search && !item.name.toLowerCase().includes(search.toLowerCase())) return false
    if (statusFilter && item.status !== statusFilter) return false
    return true
  })
}, [data, search, statusFilter])
```

**Toast notifications:**
```tsx
import { toast } from "sonner"
toast.success("Lead updated")
toast.error("Failed to save")
```

**shadcn/ui composition:**
```tsx
<Card>
  <CardHeader>
    <CardTitle>Title</CardTitle>
    <CardDescription>Description</CardDescription>
  </CardHeader>
  <CardContent>...</CardContent>
</Card>
```

### Styling Rules

- Use Tailwind utility classes, never inline styles
- Use CSS variables for theme colors: `bg-primary`, `text-muted-foreground`
- Responsive: mobile-first with `sm:`, `md:`, `lg:` breakpoints
- Use `cn()` from `@/lib/utils` for conditional classes:
  ```tsx
  import { cn } from "@/lib/utils"
  <div className={cn("base-class", condition && "conditional-class")} />
  ```

### Tenant Branding

Components may receive tenant branding (primary_color, logo_url). Apply via inline CSS variables when needed:
```tsx
style={{ "--tenant-color": tenant.primary_color } as React.CSSProperties}
```

### Role-Based UI

Filter UI elements based on user role:
- `owner`/`admin` — full access, settings, team management
- `viewer` — read-only leads
- `counselor` — only assigned leads, no settings

## WORKFLOW

1. **Read first** — Check existing components for similar patterns before creating new ones
2. **Check types** — Reference `src/types/database.ts` for data structures
3. **Server or Client?** — Data fetching = Server Component. Interactivity = Client Component
4. **Use shadcn/ui** — Check `src/components/ui/` for available primitives. Add new ones via the shadcn pattern
5. **Test build** — Run `npm run build` to verify no TypeScript errors

## CONSTRAINTS

- **No `any` types** — use proper TypeScript types from `@/types/database`
- **No direct Supabase calls in Client Components** — fetch in Server Components or use API routes
- **No new CSS files** — use Tailwind classes only
- **Follow existing patterns** — check 2-3 similar files before writing new code
- **Mobile responsive** — every component must work on mobile
- **Tenant isolation** — never render data from other tenants

## EXAMPLE

**User:** "Add a new analytics page to the dashboard"

**Steps:**
1. Read `src/app/(dashboard)/dashboard/page.tsx` for page pattern
2. Read `src/app/(dashboard)/layout.tsx` for layout/auth pattern
3. Create `src/app/(dashboard)/analytics/page.tsx` (Server Component)
4. Create `src/components/dashboard/analytics-chart.tsx` (Client Component)
5. Add nav link in `src/components/dashboard/shell.tsx`
6. Run `npm run build` to verify
