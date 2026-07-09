# Component Map

Frontend composition: the layout chain, the industry-driven sidebar shell, feature pages, and the React-Context state layer. There is no Redux/Zustand — Server Components fetch directly via `lib/supabase/queries.ts`, and client components call `/api/v1/*`.

```mermaid
graph TB
    subgraph groups["Route groups — src/app"]
        mainLayout["(main)/layout.tsx<br/>fonts · Toaster · metadata"]
        widgetLayout["(widget)/layout.tsx<br/>public forms · consent · shared proposals"]
    end

    mainLayout --> dashLayout["(main)/(dashboard)/layout.tsx<br/>auth + tenant gate"]

    subgraph providers["Providers wrap the shell — src/contexts"]
        aiCtx["AIAssistantProvider"]
        searchCtx["GlobalSearchProvider"]
        settingsCtx["SettingsModalProvider"]
    end
    dashLayout --> providers

    providers --> shell["components/dashboard/shell.tsx<br/>sidebar — the composition hub"]

    subgraph nav["Sidebar nav built from"]
        universal["UNIVERSAL_NAV_TOP / MIDDLE / BOTTOM"]
        industryNav["getIndustrySidebarItems(industry_id)<br/>from industries/*/manifest.ts"]
    end
    shell --> universal
    shell --> industryNav

    shell --> pages["Feature pages<br/>(dashboard)/*/page.tsx<br/>leads · pipeline · deals · projects ·<br/>proposals · applications · hr · inbox · insights"]

    subgraph comps["Feature components — src/components/dashboard"]
        leadsC["leads/ · lead/"]
        pipeC["pipeline/ (dnd-kit kanban)"]
        hrC["hr/"]
        inboxC["inbox/"]
        uiC["ui/ (shadcn primitives)"]
    end
    pages --> comps

    subgraph data["Data access"]
        queries["Server Components →<br/>lib/supabase/queries.ts (direct read)"]
        apiCalls["Client Components →<br/>fetch /api/v1/* (mutations)"]
    end
    pages --> queries
    comps --> apiCalls

    widgetLayout --> pubForm["components/form/public-form.tsx<br/>renders form_configs.steps"]
```

## The industry feature-gate (one truth, three enforcement points)

`getFeatureAccess()` is the single source of truth; it's checked in three places so a disabled feature disappears from the UI *and* is unreachable by URL or API.

```mermaid
graph LR
    truth["getFeatureAccess(industryId, feature)<br/>industries/_loader.ts"]
    truth --> nav["1 Sidebar<br/>hide nav item (shell.tsx)"]
    truth --> route["2 Page route<br/>getFeatureAccess → notFound()"]
    truth --> api["3 API route<br/>getFeatureAccess → apiForbidden()"]
```

## Anchors
- Layout chain: `src/app/(main)/layout.tsx`, `src/app/(main)/(dashboard)/layout.tsx`
- Shell / sidebar: `src/components/dashboard/shell.tsx`
- State: `src/contexts/{ai-assistant,global-search,settings-modal}-context.tsx`
- Data: `src/lib/supabase/queries.ts`; feature components under `src/components/dashboard/*`, primitives in `src/components/ui/`
- Feature gate: `src/industries/_loader.ts`, `src/industries/_registry.ts`
- Public form: `src/components/form/public-form.tsx`
