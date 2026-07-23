import type { SidebarEntry, SidebarItem } from "@/industries/_types";
import type { LeadList } from "@/types/database";

export type NavAction =
  | { kind: "route"; href: string }
  | { kind: "settings"; tab?: string };

export interface NavResult {
  id: string;
  label: string;
  group: string;
  icon: string;
  keywords: string[];
  action: NavAction;
}

// Human-friendly labels and keyword hints per settings tab ID
const SETTINGS_TABS: { id: string; label: string; keywords: string[]; educationOnly?: boolean }[] = [
  { id: "general", label: "General Settings", keywords: ["general", "profile", "branding", "tenant"] },
  { id: "ai-orca", label: "AI & Orca", keywords: ["ai", "orca", "assistant", "intelligence", "llm"] },
  { id: "organization", label: "Organization", keywords: ["organization", "company", "org", "billing"] },
  { id: "team-roles", label: "Team & Roles", keywords: ["team", "roles", "members", "invite", "staff", "users"] },
  { id: "lead-management", label: "Lead Management", keywords: ["leads", "pipeline", "stages", "lists", "management"] },
  { id: "academic-operations", label: "Academic Operations", keywords: ["academic", "education", "university", "courses", "intake"], educationOnly: true },
  { id: "communications", label: "Communications", keywords: ["email", "sms", "communications", "notifications", "messaging"] },
  { id: "integrations", label: "Integrations", keywords: ["integrations", "api", "webhook", "connect", "third-party"] },
  { id: "compliance", label: "Compliance", keywords: ["compliance", "gdpr", "consent", "legal", "privacy"] },
];

interface BuildNavIndexOptions {
  industrySidebarItems: readonly SidebarEntry[];
  leadLists: Pick<LeadList, "id" | "name" | "slug" | "sort_order">[];
  stagingLists: Pick<LeadList, "id" | "name" | "slug">[];
  allowedNavKeys: string[] | null;
  industryId: string | null;
  isOrcaAvailable: boolean;
}

function navAllowed(href: string, allowedNavKeys: string[] | null): boolean {
  return href === "/home" || allowedNavKeys === null || allowedNavKeys.includes(href);
}

export function buildNavIndex({
  industrySidebarItems,
  leadLists,
  stagingLists,
  allowedNavKeys,
  industryId,
  isOrcaAvailable,
}: BuildNavIndexOptions): NavResult[] {
  const results: NavResult[] = [];
  const isEducation = industryId === "education_consultancy";

  // ── Universal pages ──────────────────────────────────────────
  const universalPages = [
    { href: "/home", label: "Home", icon: "House", keywords: ["home", "start", "overview"] },
    { href: "/dashboard", label: "Dashboard", icon: "LayoutDashboard", keywords: ["dashboard", "stats", "metrics", "overview"] },
    { href: "/knowledge-bases", label: "Knowledge Bases", icon: "Library", keywords: ["knowledge", "base", "library", "docs", "kb"] },
    { href: "/leads", label: "All Leads", icon: "Users", keywords: ["leads", "contacts", "people", "all"] },
    { href: "/pipeline", label: "Pipeline", icon: "Kanban", keywords: ["pipeline", "kanban", "board", "stages"] },
    { href: "/inbox", label: "Inbox", icon: "MessageSquare", keywords: ["inbox", "messages", "email", "threads"] },
    { href: "/team", label: "Org Structure", icon: "Network", keywords: ["team", "org", "structure", "members", "users"] },
  ];

  for (const page of universalPages) {
    if (!navAllowed(page.href, allowedNavKeys)) continue;
    results.push({
      id: `nav-${page.href}`,
      label: page.label,
      group: "Pages",
      icon: page.icon,
      keywords: page.keywords,
      action: { kind: "route", href: page.href },
    });
  }

  // ── Lead lists ───────────────────────────────────────────────
  for (const list of leadLists) {
    results.push({
      id: `list-${list.id}`,
      label: list.name,
      group: "Lead Lists",
      icon: "Users",
      keywords: ["list", "leads", list.name.toLowerCase()],
      action: { kind: "route", href: `/leads?list=${list.slug}` },
    });
  }

  // ── Staging lists (Leads Organise) ───────────────────────────
  for (const list of stagingLists) {
    results.push({
      id: `staging-${list.id}`,
      label: `${list.name} (Organise)`,
      group: "Lead Lists",
      icon: "GitCompare",
      keywords: ["staging", "organise", "organize", list.name.toLowerCase()],
      action: { kind: "route", href: `/leads-organise/${list.slug}` },
    });
  }

  // ── Industry sidebar items ────────────────────────────────────
  function addSidebarItem(item: SidebarItem) {
    results.push({
      id: `industry-${item.featureId}`,
      label: item.label,
      group: "Pages",
      icon: item.icon,
      keywords: [item.label.toLowerCase(), item.featureId],
      action: { kind: "route", href: item.href },
    });
  }

  for (const entry of industrySidebarItems) {
    if (entry.kind === "group") {
      for (const child of entry.children) {
        addSidebarItem(child);
      }
    } else {
      addSidebarItem(entry as SidebarItem);
    }
  }

  // ── Orca pages (only when Orca is available to the tenant) ───
  // Phase 2+: Orca "Ask Orca" action from the palette lives here too
  if (isOrcaAvailable) {
    const orcaPages = [
      { href: "/orca", label: "Orca Overview", keywords: ["orca", "ai", "overview"] },
      { href: "/orca/activity", label: "Ask Orca", keywords: ["orca", "ask", "ai", "assistant"] },
      { href: "/orca/structure", label: "Orca Org Structure", keywords: ["orca", "org", "structure"] },
      { href: "/orca/roles", label: "Orca Roles", keywords: ["orca", "roles"] },
      { href: "/orca/tasks", label: "Orca Tasks", keywords: ["orca", "tasks"] },
      { href: "/orca/agents", label: "Orca Agents", keywords: ["orca", "agents", "bots"] },
      { href: "/orca/review", label: "Orca Review", keywords: ["orca", "review", "approve", "suggestions", "queue"] },
      { href: "/orca/compare", label: "Orca Compare", keywords: ["orca", "compare"] },
    ];
    for (const page of orcaPages) {
      results.push({
        id: `orca-${page.href}`,
        label: page.label,
        group: "Orca",
        icon: "Bot",
        keywords: page.keywords,
        action: { kind: "route", href: page.href },
      });
    }
  }

  // ── Settings ──────────────────────────────────────────────────
  // Top-level entry
  results.push({
    id: "settings-root",
    label: "Settings",
    group: "Settings",
    icon: "Settings",
    keywords: ["settings", "preferences", "config", "configure"],
    action: { kind: "settings" },
  });

  // One entry per settings tab
  for (const tab of SETTINGS_TABS) {
    if (tab.educationOnly && !isEducation) continue;
    results.push({
      id: `settings-${tab.id}`,
      label: tab.label,
      group: "Settings",
      icon: "Settings",
      keywords: ["settings", ...tab.keywords],
      action: { kind: "settings", tab: tab.id },
    });
  }

  // TODO Phase 2+: Add "Actions" / "Ask Orca" group here for AI-native palette actions

  return results;
}
