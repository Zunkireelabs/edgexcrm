"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { toast } from "sonner";
import {
  Bot,
  Building2,
  Contact,
  FileText,
  FolderKanban,
  GitCompare,
  GraduationCap,
  Handshake,
  House,
  Kanban,
  LayoutDashboard,
  Library,
  ListChecks,
  MapPin,
  MessageSquare,
  Network,
  Plane,
  Search,
  Settings,
  Users,
  UsersRound,
  UserCheck,
  ChartColumn,
  Megaphone,
  BookOpen,
  Loader2,
  ListPlus,
  type LucideIcon,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { useSettingsModal } from "@/contexts/settings-modal-context";
import type { NavResult } from "./build-nav-index";

// Round 2 slice B — quick-add (docs/IT-AGENCY-ROUND2-SLICE-B-BRIEF.md §3a).
// A project page's URL is the only "current project" signal the palette has
// (no project picker is in scope) — /projects/<uuid> creates a project task
// there via POST /api/v1/projects/<id>/tasks; anywhere else creates a
// personal task via POST /api/v1/my-tasks. Both are stamped self-assigned.
const PROJECT_PATH_RE = /^\/projects\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

// Resolve icon string name to Lucide component (mirrors shell.tsx INDUSTRY_ICONS)
const ICON_MAP: Record<string, LucideIcon> = {
  Bot,
  BookOpen,
  Building2,
  ChartColumn,
  Contact,
  FileText,
  FolderKanban,
  GitCompare,
  GraduationCap,
  Handshake,
  House,
  Kanban,
  LayoutDashboard,
  Library,
  ListChecks,
  MapPin,
  Megaphone,
  MessageSquare,
  Network,
  Plane,
  Search,
  Settings,
  Users,
  UsersRound,
  UserCheck,
};

function NavIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICON_MAP[name] ?? FileText;
  return <Icon className={className} />;
}

interface LeadResult {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
}

interface GlobalSearchPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  navIndex: NavResult[];
  currentUserId: string;
}

// Substring/keyword match for nav results
function matchNav(item: NavResult, query: string): boolean {
  const q = query.toLowerCase();
  return (
    item.label.toLowerCase().includes(q) ||
    item.keywords.some((k) => k.includes(q))
  );
}

function leadDisplayName(lead: LeadResult): string {
  const full = [lead.first_name, lead.last_name].filter(Boolean).join(" ");
  return full || lead.email || "Unknown";
}

export function GlobalSearchPalette({
  isOpen,
  onClose,
  navIndex,
  currentUserId,
}: GlobalSearchPaletteProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { openSettings } = useSettingsModal();
  const [query, setQuery] = useState("");
  const [leads, setLeads] = useState<LeadResult[]>([]);
  const [leadsLoading, setLeadsLoading] = useState(false);
  const [creatingTask, setCreatingTask] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset query when palette opens
  useEffect(() => {
    if (isOpen) setQuery("");
  }, [isOpen]);

  // Debounced lead fetch (min 2 chars)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (abortRef.current) abortRef.current.abort();

    if (query.length < 2) {
      setLeads([]);
      setLeadsLoading(false);
      return;
    }

    setLeadsLoading(true);
    debounceRef.current = setTimeout(async () => {
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await fetch(
          `/api/v1/leads?search=${encodeURIComponent(query)}&pageSize=8`,
          { signal: controller.signal }
        );
        if (!res.ok) throw new Error("fetch failed");
        // Response shape: { data: Lead[], meta: { ... } }
        const json = await res.json();
        setLeads((json.data ?? []) as LeadResult[]);
      } catch (err) {
        if ((err as Error).name !== "AbortError") setLeads([]);
      } finally {
        setLeadsLoading(false);
      }
    }, 200);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const handleNavSelect = useCallback(
    (item: NavResult) => {
      onClose();
      if (item.action.kind === "route") {
        router.push(item.action.href);
      } else {
        openSettings(item.action.tab);
      }
    },
    [onClose, router, openSettings]
  );

  const handleLeadSelect = useCallback(
    (lead: LeadResult) => {
      onClose();
      router.push(`/leads/${lead.id}`);
    },
    [onClose, router]
  );

  const handleQuickAddTask = useCallback(
    async (title: string) => {
      const trimmed = title.trim();
      if (!trimmed || creatingTask) return;
      setCreatingTask(true);
      try {
        const projectMatch = pathname?.match(PROJECT_PATH_RE);
        const url = projectMatch
          ? `/api/v1/projects/${projectMatch[1]}/tasks`
          : "/api/v1/my-tasks";
        const body = projectMatch
          ? { title: trimmed, assignee_id: currentUserId }
          : { title: trimmed };
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) {
          toast.error(json?.error?.message ?? "Failed to create task");
          return;
        }
        const task = json?.data as { id: string; title: string } | undefined;
        onClose();
        if (task) {
          toast.success(`Task created: "${task.title}"`, {
            action: { label: "Open", onClick: () => router.push(`/tasks/${task.id}`) },
          });
        }
      } catch {
        toast.error("Failed to create task");
      } finally {
        setCreatingTask(false);
      }
    },
    [pathname, currentUserId, onClose, router, creatingTask]
  );

  // Filtered nav results (synchronous substring match)
  const filteredNav = query.length > 0 ? navIndex.filter((i) => matchNav(i, query)) : navIndex;

  // Group nav results
  const navByGroup = filteredNav.reduce<Record<string, NavResult[]>>((acc, item) => {
    (acc[item.group] ??= []).push(item);
    return acc;
  }, {});

  // Group order
  const GROUP_ORDER = ["Pages", "Lead Lists", "Orca", "Settings"];

  // Round 2 slice B: quick-add surfaces only when the query matches no nav
  // item — it never displaces real navigation results.
  const trimmedQuery = query.trim();
  const showQuickAdd = trimmedQuery.length > 0 && filteredNav.length === 0;

  const showEmpty =
    query.length >= 2 && !leadsLoading && leads.length === 0 && filteredNav.length === 0 && !showQuickAdd;

  return (
    <CommandDialog
      open={isOpen}
      onOpenChange={(open) => { if (!open) onClose(); }}
      title="Global Search"
      description="Search pages and leads"
    >
      <CommandInput
        placeholder="Search pages, leads…"
        value={query}
        onValueChange={setQuery}
        autoFocus
      />
      <CommandList className="h-[60vh] max-h-[60vh]">
        {showEmpty && (
          <CommandEmpty>No results for &ldquo;{query}&rdquo;</CommandEmpty>
        )}

        {/* Round 2 slice B: quick-add — one row, never a takeover of search results. */}
        {showQuickAdd && (
          <CommandGroup heading="Actions">
            <CommandItem
              value={`create-task ${trimmedQuery}`}
              disabled={creatingTask}
              onSelect={() => handleQuickAddTask(trimmedQuery)}
              className="flex items-center gap-2"
            >
              {creatingTask ? (
                <Loader2 className="w-4 h-4 text-gray-500 animate-spin" />
              ) : (
                <ListPlus className="w-4 h-4 text-gray-500" />
              )}
              <span>
                Create task &ldquo;{trimmedQuery}&rdquo;
              </span>
            </CommandItem>
          </CommandGroup>
        )}

        {/* Quick navigation (empty state) or filtered page results */}
        {GROUP_ORDER.map((groupName) => {
          const items = navByGroup[groupName];
          if (!items?.length) return null;
          return (
            <CommandGroup key={groupName} heading={groupName}>
              {items.map((item) => (
                <CommandItem
                  key={item.id}
                  value={`${item.label} ${item.keywords.join(" ")}`}
                  onSelect={() => handleNavSelect(item)}
                  className="flex items-center gap-2"
                >
                  <NavIcon name={item.icon} className="w-4 h-4 text-gray-500" />
                  <span>{item.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          );
        })}

        {/* Leads results (only when query >= 2 chars) */}
        {query.length >= 2 && (
          <>
            {filteredNav.length > 0 && <CommandSeparator />}
            <CommandGroup heading="Leads">
              {leadsLoading && (
                <div className="flex items-center gap-2 px-2 py-3 text-sm text-gray-500">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Searching leads…
                </div>
              )}
              {!leadsLoading && leads.length === 0 && query.length >= 2 && (
                <div className="px-2 py-3 text-sm text-gray-400">
                  No leads matched
                </div>
              )}
              {leads.map((lead) => (
                <CommandItem
                  key={lead.id}
                  value={`lead-${lead.id} ${leadDisplayName(lead)} ${lead.email ?? ""} ${lead.phone ?? ""}`}
                  onSelect={() => handleLeadSelect(lead)}
                  className="flex flex-col items-start gap-0.5"
                >
                  <span className="font-medium">{leadDisplayName(lead)}</span>
                  <span className="text-xs text-gray-400">
                    {[lead.email, lead.phone].filter(Boolean).join(" · ")}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {/* TODO Phase 2+: "Actions" / "Ask Orca" group — AI-native palette actions */}
      </CommandList>

      {/* Footer hint row */}
      <div className="border-t border-gray-100 px-3 py-2 flex items-center gap-4 text-xs text-gray-400">
        <span><kbd className="font-mono">↑↓</kbd> Select</span>
        <span><kbd className="font-mono">↵</kbd> Open</span>
        <span><kbd className="font-mono">esc</kbd> Close</span>
      </div>
    </CommandDialog>
  );
}
