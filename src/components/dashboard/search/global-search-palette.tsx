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
import { extractMention, matchMembers, parsePastedLines, type RosterMember } from "@/lib/tasks/quick-add-parse";

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

  // Round 2 slice E — @mention roster + multi-line paste batch
  // (docs/IT-AGENCY-ROUND2-SLICE-E-CAPTURE-BRIEF.md §3.2, §3.3).
  const [roster, setRoster] = useState<RosterMember[]>([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const rosterLoadedRef = useRef(false);
  const [pendingBatch, setPendingBatch] = useState<string[] | null>(null);
  const [pendingBatchIgnoredCount, setPendingBatchIgnoredCount] = useState(0);
  const [creatingBatch, setCreatingBatch] = useState(false);

  // Reset query + mention/paste state when palette opens
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setRoster([]);
      setRosterLoading(false);
      rosterLoadedRef.current = false;
      setPendingBatch(null);
      setPendingBatchIgnoredCount(0);
    }
  }, [isOpen]);

  // Lazily load the roster the first time an "@" appears in the query —
  // cached in state until the palette closes.
  useEffect(() => {
    if (!query.includes("@") || rosterLoadedRef.current) return;
    rosterLoadedRef.current = true;
    setRosterLoading(true);
    fetch("/api/v1/team?minimal=1")
      .then((res) => (res.ok ? res.json() : { data: [] }))
      .then(({ data }) => setRoster((data ?? []) as RosterMember[]))
      .catch(() => setRoster([]))
      .finally(() => setRosterLoading(false));
  }, [query]);

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
    async (title: string, assigneeId?: string) => {
      const trimmed = title.trim();
      if (!trimmed || creatingTask) return;
      setCreatingTask(true);
      try {
        const projectMatch = pathname?.match(PROJECT_PATH_RE);
        const url = projectMatch
          ? `/api/v1/projects/${projectMatch[1]}/tasks`
          : "/api/v1/my-tasks";
        // Project tasks are always stamped with an assignee (self by
        // default); personal tasks only carry assignee_id when @mention
        // resolved someone else — keeps the existing self-assign test's
        // exact-match body assertion intact (Round 2 slice E §3.2).
        const body = projectMatch
          ? { title: trimmed, assignee_id: assigneeId ?? currentUserId }
          : assigneeId
            ? { title: trimmed, assignee_id: assigneeId }
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

  // Round 2 slice E §3.3 — intercept a multi-line paste and stage it as a
  // batch preview instead of flattening the newlines into one title. A
  // single-line paste is left alone (native paste behavior).
  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    const { titles, truncated } = parsePastedLines(text);
    if (titles.length < 2) return;
    e.preventDefault();
    setPendingBatch(titles);
    if (truncated) {
      const rawLineCount = text.split(/\r?\n/).filter((l) => l.trim().length > 0).length;
      setPendingBatchIgnoredCount(Math.max(0, rawLineCount - titles.length));
    } else {
      setPendingBatchIgnoredCount(0);
    }
  }, []);

  const handleCreateBatch = useCallback(
    async (assigneeId?: string) => {
      if (!pendingBatch || creatingBatch) return;
      setCreatingBatch(true);
      try {
        const projectMatch = pathname?.match(PROJECT_PATH_RE);
        const res = await fetch("/api/v1/my-tasks/bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            titles: pendingBatch,
            assignee_id: assigneeId ?? null,
            project_id: projectMatch ? projectMatch[1] : null,
          }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) {
          toast.error(json?.error?.message ?? "Failed to create tasks");
          return;
        }
        const data = json?.data as { created: string[]; failed: number } | undefined;
        const batchSize = pendingBatch.length;
        onClose();
        setPendingBatch(null);
        setPendingBatchIgnoredCount(0);
        if (data) {
          if (data.failed > 0) {
            toast.error(`Created ${data.created.length} of ${batchSize} tasks — ${data.failed} failed`);
          } else {
            toast.success(`Created ${data.created.length} tasks`, {
              action: {
                label: "Open",
                onClick: () => router.push(projectMatch ? `/projects/${projectMatch[1]}` : "/tasks"),
              },
            });
          }
        }
      } catch {
        toast.error("Failed to create tasks");
      } finally {
        setCreatingBatch(false);
      }
    },
    [pendingBatch, creatingBatch, pathname, onClose, router]
  );

  // Round 2 slice E §3.2 — pull a trailing @mention off the query BEFORE nav
  // matching, so "@hardik" alone never matches nav (and never leaks into the
  // nav/leads search as literal text).
  const { title: mentionTitle, mentionToken } = extractMention(query);
  const memberMatches = mentionToken ? matchMembers(mentionToken, roster) : [];

  // Filtered nav results (synchronous substring match) — matched against the
  // mention-stripped title, not the raw query.
  const filteredNav = mentionTitle.length > 0 ? navIndex.filter((i) => matchNav(i, mentionTitle)) : navIndex;

  // Group nav results
  const navByGroup = filteredNav.reduce<Record<string, NavResult[]>>((acc, item) => {
    (acc[item.group] ??= []).push(item);
    return acc;
  }, {});

  // Group order
  const GROUP_ORDER = ["Pages", "Lead Lists", "Orca", "Settings"];

  // Round 2 slice B: quick-add surfaces only when the query matches no nav
  // item — it never displaces real navigation results. A trailing @mention
  // always takes over the Actions row instead (never displaced by nav —
  // slice E §3.2), and a staged paste batch takes over ahead of both.
  const showQuickAdd = !pendingBatch && mentionToken === null && mentionTitle.length > 0 && filteredNav.length === 0;
  const showMentionActions = !pendingBatch && mentionToken !== null;

  const showEmpty =
    !pendingBatch &&
    query.length >= 2 &&
    !leadsLoading &&
    leads.length === 0 &&
    filteredNav.length === 0 &&
    !showQuickAdd &&
    !showMentionActions;

  return (
    <CommandDialog
      open={isOpen}
      onOpenChange={(open) => { if (!open) onClose(); }}
      title="Global Search"
      description="Search pages and leads"
    >
      <CommandInput
        placeholder="Search pages, leads… or type a task, @ to assign"
        value={query}
        onValueChange={setQuery}
        onPaste={handlePaste}
        autoFocus
      />
      <CommandList className="h-[60vh] max-h-[60vh]">
        {showEmpty && (
          <CommandEmpty>No results for &ldquo;{query}&rdquo;</CommandEmpty>
        )}

        {/* Round 2 slice E §3.3 — staged multi-line paste batch preview. */}
        {pendingBatch && (
          <CommandGroup heading="Actions">
            <div className="px-2 py-1.5 space-y-0.5">
              {pendingBatch.map((t, i) => (
                <p key={i} className="text-xs text-gray-500 truncate">
                  {t}
                </p>
              ))}
              {pendingBatchIgnoredCount > 0 && (
                <p className="text-xs text-amber-600">
                  + {pendingBatchIgnoredCount} more were ignored (limit 25)
                </p>
              )}
            </div>
            {mentionToken === null && (
              <CommandItem
                value="create-batch-self"
                disabled={creatingBatch}
                onSelect={() => handleCreateBatch()}
                className="flex items-center gap-2"
              >
                {creatingBatch ? (
                  <Loader2 className="w-4 h-4 text-gray-500 animate-spin" />
                ) : (
                  <ListPlus className="w-4 h-4 text-gray-500" />
                )}
                <span>Create {pendingBatch.length} tasks</span>
              </CommandItem>
            )}
            {mentionToken !== null && rosterLoading && (
              <CommandItem value="batch-roster-loading" disabled className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 text-gray-500 animate-spin" />
                <span>Loading teammates…</span>
              </CommandItem>
            )}
            {mentionToken !== null && !rosterLoading && memberMatches.length === 0 && (
              <CommandItem value={`batch-no-match-${mentionToken}`} disabled>
                <span>No teammate matches &ldquo;@{mentionToken}&rdquo;</span>
              </CommandItem>
            )}
            {mentionToken !== null &&
              !rosterLoading &&
              memberMatches.map((m) => (
                <CommandItem
                  key={m.user_id}
                  value={`create-batch-${m.user_id}`}
                  disabled={creatingBatch}
                  onSelect={() => handleCreateBatch(m.user_id)}
                  className="flex items-center gap-2"
                >
                  {creatingBatch ? (
                    <Loader2 className="w-4 h-4 text-gray-500 animate-spin" />
                  ) : (
                    <ListPlus className="w-4 h-4 text-gray-500" />
                  )}
                  <span>
                    Create {pendingBatch.length} tasks for {m.name}
                  </span>
                </CommandItem>
              ))}
            <CommandItem
              value="clear-batch"
              onSelect={() => {
                setPendingBatch(null);
                setPendingBatchIgnoredCount(0);
              }}
            >
              <span>Clear</span>
            </CommandItem>
          </CommandGroup>
        )}

        {/* Round 2 slice E §3.2 — @mention quick-add: one row per matching
            teammate, or a disabled no-match row. Never falls back to a
            self-task with the token silently stripped. */}
        {showMentionActions && (
          <CommandGroup heading="Actions">
            {rosterLoading && (
              <CommandItem value="mention-roster-loading" disabled className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 text-gray-500 animate-spin" />
                <span>Loading teammates…</span>
              </CommandItem>
            )}
            {!rosterLoading && memberMatches.length === 0 && (
              <CommandItem value={`mention-no-match-${mentionToken}`} disabled>
                <span>No teammate matches &ldquo;@{mentionToken}&rdquo;</span>
              </CommandItem>
            )}
            {!rosterLoading &&
              memberMatches.map((m) => (
                <CommandItem
                  key={m.user_id}
                  value={`create-task-${m.user_id} ${mentionTitle}`}
                  disabled={creatingTask}
                  onSelect={() => handleQuickAddTask(mentionTitle, m.user_id)}
                  className="flex items-center gap-2"
                >
                  {creatingTask ? (
                    <Loader2 className="w-4 h-4 text-gray-500 animate-spin" />
                  ) : (
                    <ListPlus className="w-4 h-4 text-gray-500" />
                  )}
                  <span>
                    Create task &ldquo;{mentionTitle}&rdquo; for {m.name}
                  </span>
                </CommandItem>
              ))}
          </CommandGroup>
        )}

        {/* Round 2 slice B: quick-add — one row, never a takeover of search results. */}
        {showQuickAdd && (
          <CommandGroup heading="Actions">
            <CommandItem
              value={`create-task ${mentionTitle}`}
              disabled={creatingTask}
              onSelect={() => handleQuickAddTask(mentionTitle)}
              className="flex items-center gap-2"
            >
              {creatingTask ? (
                <Loader2 className="w-4 h-4 text-gray-500 animate-spin" />
              ) : (
                <ListPlus className="w-4 h-4 text-gray-500" />
              )}
              <span>
                Create task &ldquo;{mentionTitle}&rdquo;
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
