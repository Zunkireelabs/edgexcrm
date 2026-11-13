"use client";

// View tabs (mockup row 2): All leads · My leads · Applications [count] · More ▾.
// A tab is a baseline (see builtin-views.ts); More holds the user's personal saved views plus the
// Archived / Recycle bin lists, with search and "Create new view". Counts load lazily elsewhere and
// arrive as `counts`: a missing number simply isn't drawn.

import { useMemo, useState } from "react";
import { CaretDownIcon, CheckIcon, MagnifyingGlassIcon, PlusIcon, TrashIcon } from "@/components/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { SavedLeadFilter } from "@/industries/education-consultancy/features/saved-lead-filters/lib/use-saved-lead-filters";
import { cn } from "@/lib/utils";
import type { ViewDef } from "./builtin-views";
import { SaveViewForm } from "./save-view-form";
import { ITEM, POP, POP_SEARCH, POP_SEP } from "@/components/filters/toolbar/tokens";

const TAB =
  "relative flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap px-2.5 text-sm font-medium text-ds-muted transition-colors hover:text-ds-ink focus-visible:outline-none focus-visible:text-ds-ink";
const TAB_ACTIVE =
  "text-ds-ink after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-ds-ink";
const COUNT = "rounded-full bg-ds-hover px-1.5 text-[11px] font-semibold leading-[18px] tabular-nums text-ds-muted";

export interface MoreViewsConfig {
  saved: SavedLeadFilter[];
  savedLoaded: boolean;
  savedLoading: boolean;
  /** Called when More opens, to fetch the personal views once. Resolves to an error message or null. */
  loadSaved: () => Promise<string | null>;
  onApplySaved: (filter: SavedLeadFilter) => void;
  onDeleteSaved: (id: string) => Promise<string | null>;
  /** Lead lists reached by navigation (null when the tenant has none / can't see it). */
  archive: { slug: string } | null;
  trash: { slug: string } | null;
  onOpenList: (slug: string) => void;
  /** "Create new view" needs filters to store: false -> the prompt explains instead of saving. */
  hasFilters: boolean;
  /** Saved views exist only for education_consultancy; false hides the personal views + Create. */
  savedViewsEnabled: boolean;
  onCreate: (name: string) => Promise<string | null>;
  activeSavedId: string | null;
}

export interface ViewTabsProps {
  views: ViewDef[];
  activeId: string;
  counts: Record<string, number | null | undefined>;
  /** The saved view currently applied, shown as its own active tab before More. */
  activeSaved: { id: string; name: string } | null;
  onSelect: (view: ViewDef) => void;
  more: MoreViewsConfig;
}

export function ViewTabs({ views, activeId, counts, activeSaved, onSelect, more }: ViewTabsProps) {
  return (
    <div role="tablist" aria-label="Lead views" className="flex items-center">
      {views.map((v) => {
        const count = counts[v.id];
        const active = v.id === activeId && !activeSaved;
        return (
          <button
            key={v.id}
            type="button"
            role="tab"
            aria-selected={active}
            data-testid={`leads-view-tab-${v.id}`}
            onClick={() => onSelect(v)}
            className={cn(TAB, active && TAB_ACTIVE)}
          >
            {v.label}
            {v.showCount && typeof count === "number" && <span className={COUNT}>{count.toLocaleString()}</span>}
          </button>
        );
      })}
      {activeSaved && (
        <span role="tab" aria-selected="true" className={cn(TAB, TAB_ACTIVE, "cursor-default")}>
          <span className="max-w-[180px] truncate">{activeSaved.name}</span>
        </span>
      )}
      <MoreViews {...more} />
    </div>
  );
}

type MoreScreen = "list" | "create";

function MoreViews(config: MoreViewsConfig) {
  const { saved, savedLoaded, savedLoading, loadSaved, onApplySaved, onDeleteSaved, archive, trash, onOpenList, hasFilters, savedViewsEnabled, onCreate, activeSavedId } = config;
  const [open, setOpen] = useState(false);
  const [screen, setScreen] = useState<MoreScreen>("list");
  const [query, setQuery] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) return;
    setScreen("list");
    setQuery("");
    setConfirmId(null);
    if (savedViewsEnabled && !savedLoaded) setLoadError(await loadSaved());
  }

  const q = query.trim().toLowerCase();
  const savedRows = useMemo(() => (savedViewsEnabled ? saved.filter((f) => f.name.toLowerCase().includes(q)) : []), [saved, q, savedViewsEnabled]);
  const listRows = [
    ...(archive && "archived".includes(q) ? [{ key: "archive", label: "Archived", slug: archive.slug }] : []),
    ...(trash && "recycle bin".includes(q) ? [{ key: "trash", label: "Recycle bin", slug: trash.slug }] : []),
  ];

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button type="button" data-testid="leads-view-more" className={cn(TAB, open && "text-ds-ink")}>
          More
          <CaretDownIcon className="size-3.5 text-ds-faint" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={0} className={POP}>
        {screen === "create" ? (
          <SaveViewForm
            blockedReason={hasFilters ? undefined : "Add a filter first, then save it as a view."}
            onSave={onCreate}
            onSaved={() => setOpen(false)}
          />
        ) : (
          <div className="w-[240px]">
            <div className={POP_SEARCH}>
              <MagnifyingGlassIcon className="size-4 shrink-0" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search views…"
                aria-label="Search views"
                className="h-full min-w-0 flex-1 bg-transparent text-sm font-medium text-ds-ink outline-none placeholder:text-ds-faint"
              />
            </div>
            <div className="max-h-[300px] overflow-y-auto">
              {savedViewsEnabled && savedLoading && !savedLoaded && <p className="px-2 py-2 text-sm font-normal text-ds-faint">Loading…</p>}
              {loadError && <p className="px-2 py-2 text-sm font-normal text-ds-bad">{loadError}</p>}
              {savedRows.map((f) =>
                confirmId === f.id ? (
                  <div key={f.id} className="flex items-center justify-between gap-2 px-2 py-1.5 text-sm">
                    <span className="truncate">Delete “{f.name}”?</span>
                    <span className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        className="rounded-ds-xs px-2 py-0.5 text-xs font-medium text-ds-bad hover:bg-ds-bad-soft"
                        onClick={async () => {
                          const err = await onDeleteSaved(f.id);
                          setConfirmId(null);
                          if (err) setLoadError(err);
                        }}
                      >
                        Delete
                      </button>
                      <button type="button" className="rounded-ds-xs px-2 py-0.5 text-xs font-medium text-ds-muted hover:bg-ds-hover" onClick={() => setConfirmId(null)}>
                        Cancel
                      </button>
                    </span>
                  </div>
                ) : (
                  <div key={f.id} className="group relative">
                    <button
                      type="button"
                      className={ITEM}
                      onClick={() => {
                        onApplySaved(f);
                        setOpen(false);
                      }}
                    >
                      <span className="truncate">{f.name}</span>
                      {activeSavedId === f.id && <CheckIcon className="ml-auto size-4 text-ds-muted" />}
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete saved view ${f.name}`}
                      onClick={() => setConfirmId(f.id)}
                      className="absolute right-1 top-1 rounded-ds-xs p-1 text-ds-faint opacity-0 hover:bg-ds-hover hover:text-ds-bad focus:opacity-100 group-hover:opacity-100"
                    >
                      <TrashIcon className="size-4" />
                    </button>
                  </div>
                ),
              )}
              {listRows.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  className={ITEM}
                  onClick={() => {
                    setOpen(false);
                    onOpenList(r.slug);
                  }}
                >
                  {r.label}
                </button>
              ))}
              {savedRows.length === 0 && listRows.length === 0 && !savedLoading && (
                <p className="px-2 py-2 text-sm font-normal text-ds-faint">No views match.</p>
              )}
            </div>
            {savedViewsEnabled && (
              <>
                <div className={POP_SEP} />
                <button type="button" className={ITEM} onClick={() => setScreen("create")}>
                  <PlusIcon className="size-4 shrink-0 text-ds-muted" />
                  Create new view
                </button>
              </>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
