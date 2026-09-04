import type { SidebarEntry, SidebarItem } from "@/industries/_types";
import type { LeadList } from "@/types/database";
import {
  SETTINGS_CATEGORIES,
  makeGatingContext,
  type SettingsCategoryKey,
} from "@/components/dashboard/settings/modal/settings-registry";

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

// Palette-specific data the settings registry does not carry: the search
// keywords, plus the deliberately longer labels ("General Settings" reads
// better than a bare "General" in a flat result list). Typed against the
// registry's keys so a missing or extra key is a compile error — this is
// what stops the palette drifting from SETTINGS_CATEGORIES.
const SETTINGS_PALETTE: Record<
  SettingsCategoryKey,
  { label: string; keywords: string[] }
> = {
  "general": { label: "General Settings", keywords: ["general", "profile", "branding", "tenant"] },
  "ai-orca": { label: "AI & Orca", keywords: ["ai", "orca", "assistant", "intelligence", "llm"] },
  "organization": { label: "Organization", keywords: ["organization", "company", "org", "billing"] },
  "team-roles": { label: "Team & Roles", keywords: ["team", "roles", "members", "invite", "staff", "users"] },
  "lead-management": { label: "Lead Management", keywords: ["leads", "pipeline", "stages", "lists", "management"] },
  "leave": { label: "Leave", keywords: ["leave", "time off", "holiday", "absence", "pto"] },
  "academic-operations": { label: "Academic Operations", keywords: ["academic", "education", "university", "courses", "intake"] },
  "communications": { label: "Communications", keywords: ["email", "sms", "communications", "notifications", "messaging"] },
  "integrations": { label: "Integrations", keywords: ["integrations", "api", "webhook", "connect", "third-party"] },
  "compliance": { label: "Compliance", keywords: ["compliance", "gdpr", "consent", "legal", "privacy"] },
};

interface BuildNavIndexOptions {
  industrySidebarItems: readonly SidebarEntry[];
  leadLists: Pick<LeadList, "id" | "name" | "slug" | "sort_order">[];
  stagingLists: Pick<LeadList, "id" | "name" | "slug">[];
  allowedNavKeys: string[] | null;
  industryId: string | null;
  role: string;
  /** Raw AI gate (env kill switch + tenants.ai_enabled) — drives the settings
   *  "AI & Orca" tab, which stays owner-or-admin via isSettingsAdmin. */
  aiAssistantEnabled: boolean;
  /** Narrower owner-only Orca gate — drives the Orca palette entries. Differs
   *  from aiAssistantEnabled now (#482 assumed they matched). */
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
  role,
  aiAssistantEnabled,
  isOrcaAvailable,
}: BuildNavIndexOptions): NavResult[] {
  const results: NavResult[] = [];
  // The settings-tab gate keys off the raw AI flag (its "AI & Orca" tab stays
  // owner-or-admin via isSettingsAdmin); the Orca palette entries below key off
  // the narrower owner-only isOrcaAvailable.
  const gatingCtx = makeGatingContext({ role, industryId, aiAssistantEnabled });

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
      { href: "/orca/tasks", label: "Orca Tasks", keywords: ["orca", "tasks"] },
      { href: "/orca/agents", label: "Orca Agents", keywords: ["orca", "agents", "bots"] },
      { href: "/orca/review", label: "Orca Review", keywords: ["orca", "review", "approve", "suggestions", "queue"] },
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
  // Settings is owner/admin-only (settings/page.tsx redirects, the bootstrap
  // API 403s), so non-admins get no Settings entries at all — not the parent,
  // not any tab.
  if (gatingCtx.isSettingsAdmin) {
    results.push({
      id: "settings-root",
      label: "Settings",
      group: "Settings",
      icon: "Settings",
      keywords: ["settings", "preferences", "config", "configure"],
      action: { kind: "settings" },
    });

    // One entry per visible settings tab — derived from the registry so the
    // palette can never list a tab the modal won't render (or miss one it will).
    for (const cat of SETTINGS_CATEGORIES) {
      if (!cat.isVisible(gatingCtx)) continue;
      const palette = SETTINGS_PALETTE[cat.key];
      results.push({
        id: `settings-${cat.key}`,
        label: palette.label,
        group: "Settings",
        icon: "Settings",
        keywords: ["settings", ...palette.keywords],
        action: { kind: "settings", tab: cat.key },
      });
    }
  }

  // TODO Phase 2+: Add "Actions" / "Ask Orca" group here for AI-native palette actions

  return results;
}
