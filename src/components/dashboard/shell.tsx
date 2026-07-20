"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Tenant, Branch } from "@/types/database";
import type { User } from "@supabase/supabase-js";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Bot,
  Building2,
  Contact,
  FolderKanban,
  House,
  LayoutDashboard,
  LayoutGrid,
  Library,
  Users,
  Settings,
  LogOut,
  Menu,
  FileText,
  Kanban,
  MessageSquare,
  UsersRound,
  UserCheck,
  Clock,
  ChevronDown,
  Search,
  Sparkles,
  Stamp,
  Network,
  ListChecks,
  ListTodo,
  GitCompare,
  Plane,
  MapPin,
  Handshake,
  ChartColumn,
  Megaphone,
  GraduationCap,
  BookOpen,
  Package,
  FileSignature,
  Gauge,
  CalendarClock,
  CalendarCheck,
  Filter,
  Target,
  FolderOpen,
  type LucideIcon,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAIAssistant } from "@/contexts/ai-assistant-context";
import { useSettingsModal } from "@/contexts/settings-modal-context";
import { useGlobalSearch } from "@/contexts/global-search-context";
import { AIAssistantPanel } from "./ai-assistant-panel";
import { NotificationsDropdown } from "./notifications-dropdown";
import { BranchSwitcher } from "./branch-switcher";
import { useBadgeCounts } from "@/hooks/use-badge-counts";
import { Badge } from "@/components/ui/badge";
import type { SidebarEntry, SidebarGroup, SidebarItem } from "@/industries/_types";
import type { LeadList } from "@/types/database";
import { TruncatedText } from "@/components/ui/truncated-text";
import { Suspense } from "react";
import { LeadListsNavGroup } from "@/components/dashboard/lead-lists-nav-group";
import { LeadFunnelNavGroup } from "@/components/dashboard/lead-funnel-nav-group";
import { LeadsOrganiseNavGroup } from "@/components/dashboard/leads-organise-nav-group";
import { ArchiveNavLinks } from "@/components/dashboard/archive-nav-links";

// Universal nav items — every tenant sees these regardless of industry.
// Industry-scoped items (e.g. Check-In, Forms) come from the tenant's
// industry manifest via `industrySidebarItems` prop and are inserted
// between the "top" and "bottom" universal sections.
const UNIVERSAL_NAV_TOP = [
  { href: "/home", label: "Home", icon: House },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/knowledge-bases", label: "Knowledge Bases", icon: Library },
  { href: "/leads", label: "All Leads", icon: Users },
];

const UNIVERSAL_NAV_MIDDLE = [
  { href: "/pipeline", label: "Pipeline", icon: Kanban },
  { href: "/inbox", label: "Inbox", icon: MessageSquare },
];

const UNIVERSAL_NAV_BOTTOM = [
  { href: "/team", label: "Org Structure", icon: Network },
  { href: "/leave", label: "Leave", icon: CalendarClock },
  { href: "/attendance", label: "Attendance", icon: CalendarCheck },
  { href: "/settings", label: "Settings", icon: Settings },
];

const ORCA_NAV = [
  { href: "/orca", label: "Overview", icon: LayoutDashboard },
  { href: "/orca/activity", label: "Ask Orca", icon: MessageSquare },
  { href: "/orca/structure", label: "Org Structure", icon: Network },
  { href: "/orca/roles", label: "Roles", icon: Contact },
  { href: "/orca/tasks", label: "Tasks", icon: ListChecks },
  { href: "/orca/agents", label: "Agents", icon: Bot },
  { href: "/orca/compare", label: "Compare", icon: GitCompare },
];

// Icon registry for industry-contributed nav items. Manifests reference
// icons by string name (so they stay serializable across the Server →
// Client Component boundary); this map resolves the name to a Lucide
// component. Add a new entry here when a manifest references a new icon.
const INDUSTRY_ICONS: Record<string, LucideIcon> = {
  UserCheck,
  FileText,
  Clock,
  Contact,
  FolderKanban,
  LayoutDashboard,
  LayoutGrid,
  Kanban,
  ListTodo,
  MessageSquare,
  Stamp,
  Users,
  UsersRound,
  Settings,
  Building2,
  Plane,
  MapPin,
  Handshake,
  ChartColumn,
  Megaphone,
  GraduationCap,
  BookOpen,
  Package,
  FileSignature,
  Gauge,
  FolderOpen,
};

function NavSectionHeader({ label }: { label: string }) {
  return (
    <p className="px-3 pt-3 pb-1 text-[11px] font-medium text-gray-400 uppercase tracking-wider select-none">
      {label}
    </p>
  );
}

function SidebarGroupRender({
  group,
  pathname,
  onNavigate,
}: {
  group: SidebarGroup;
  pathname: string;
  onNavigate: () => void;
}) {
  const ParentIcon = INDUSTRY_ICONS[group.icon] ?? FileText;

  const isChildActive = (item: SidebarItem) =>
    pathname === item.href ||
    (item.href !== "/dashboard" && pathname.startsWith(item.href));

  const hasActiveChild = group.children.some(isChildActive);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (hasActiveChild) setExpanded(true);
  }, [hasActiveChild]);

  return (
    <div>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        className={`w-full flex items-center justify-between gap-3 px-3 py-1.5 rounded-md text-[13px] leading-5 font-medium transition-colors ${
          hasActiveChild
            ? "bg-[#ebebeb] text-gray-900"
            : "text-[#0f172a] hover:bg-[#ebebeb] hover:text-gray-900"
        }`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <ParentIcon className="w-[18px] h-[18px] shrink-0" />
          <TruncatedText text={group.label} />
        </div>
        <ChevronDown className={`w-4 h-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>
      {expanded && (
        <div className="relative mt-1 ml-[20px] pl-[18px] border-l border-gray-300 space-y-1">
          {group.children.map((child) => {
            const ChildIcon = INDUSTRY_ICONS[child.icon] ?? FileText;
            const active = isChildActive(child);
            return (
              <Link
                key={child.href}
                href={child.href}
                onClick={onNavigate}
                className={`w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] leading-5 transition-colors ${
                  active
                    ? "bg-[#ebebeb] text-gray-900 font-medium"
                    : "text-[#0f172a] hover:bg-[#ebebeb] hover:text-gray-900"
                }`}
              >
                <ChildIcon className="w-4 h-4" />
                {child.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface FormSummary {
  name: string;
  slug: string;
}

interface DashboardShellProps {
  user: User;
  tenant: Tenant;
  role: string;
  positionName?: string | null;
  positionSlug?: string | null;
  formConfigs?: FormSummary[];
  industrySidebarItems?: readonly SidebarEntry[];
  allowedNavKeys?: string[] | null;
  branches?: Branch[];
  maxBranches?: number;
  userBranchId?: string | null;
  leadScope?: "all" | "own" | "team";
  selectedBranchId?: string | null;
  leadLists?: (Pick<LeadList, "id" | "name" | "slug" | "sort_order" | "funnel_key"> & { count?: number })[];
  stagingLists?: Pick<LeadList, "id" | "name" | "slug">[];
  archiveLists?: Pick<LeadList, "id" | "name" | "slug">[];
  /** Env flag AND tenants.ai_enabled (migration 174) — see src/lib/ai/flag.ts. */
  aiAssistantEnabled?: boolean;
  children: React.ReactNode;
}

export function DashboardShell({
  user,
  tenant,
  role,
  positionName,
  positionSlug,
  industrySidebarItems = [],
  allowedNavKeys = null,
  branches = [],
  maxBranches = 1,
  userBranchId = null,
  leadScope = "all",
  selectedBranchId = null,
  leadLists = [],
  stagingLists = [],
  archiveLists = [],
  aiAssistantEnabled = false,
  children,
}: DashboardShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  // AI-disabled tenants never get the Orca nav mode, even mid-navigation to a
  // /orca/* URL that the orca layout gate is about to 404 — keeps the sidebar
  // consistent with the (hidden) mode-switcher tab above.
  const isOrcaRoute = aiAssistantEnabled && (pathname === "/orca" || pathname.startsWith("/orca/"));
  const navMode = isOrcaRoute ? "orca" : "ops";
  const [mounted, setMounted] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showAccountDropdown, setShowAccountDropdown] = useState(false);
  const { isOpen: isAssistantOpen, toggleAssistant } = useAIAssistant();
  const { openSettings } = useSettingsModal();
  const { open: openSearch, shortcutLabel } = useGlobalSearch();
  const { counts } = useBadgeCounts();

  // Logged-in user's display name (so the account footer shows whose account it is).
  const userMeta = user.user_metadata as { name?: string; full_name?: string } | undefined;
  const userName =
    userMeta?.name?.trim() ||
    userMeta?.full_name?.trim() ||
    user.email?.split("@")[0] ||
    "User";

  const navAllowed = (href: string) => href === "/home" || allowedNavKeys === null || allowedNavKeys.includes(href);
  const isEducation = tenant.industry_id === "education_consultancy";
  const isItAgency = tenant.industry_id === "it_agency";
  // real_estate (CRE capital-raise): renders the generic sidebar branch, but the
  // universal "All Leads" nav item is relabeled "Investors" (investors ride the
  // leads spine). Additive — no other industry's label changes.
  const isRealEstate = tenant.industry_id === "real_estate";

  // Industry suffix appended to the EdgeX wordmark (empty = plain "EdgeX").
  const brandSuffix =
    ({
      education_consultancy: "edu",
      travel_agency: "travel",
      it_agency: "agency",
      real_estate: "capital",
    } as Record<string, string>)[tenant.industry_id ?? ""] ?? "";

  // Fix hydration mismatch: wait until client-side before rendering Radix UI components
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  function handleNavModeChange(value: string) {
    setMobileOpen(false);
    if (value === "orca") router.push("/orca");
    else if (value === "ops") router.push("/home");
  }

  const industryAfterHome = industrySidebarItems.filter(
    (e) => e.position === "after-home",
  );
  const industryBefore = industrySidebarItems.filter(
    (e) => (e.position ?? "before-pipeline") === "before-pipeline",
  );
  const industryAfter = industrySidebarItems.filter(
    (e) => e.position === "after-pipeline",
  );

  function renderNavItem(item: { href: string; label: string; icon: LucideIcon; badge?: number; onClick?: () => void }) {
    const isActive =
      pathname === item.href ||
      (item.href !== "/dashboard" && item.href !== "/orca" && pathname.startsWith(item.href));
    const handleClick = item.onClick
      ? () => { item.onClick!(); setMobileOpen(false); }
      : () => setMobileOpen(false);
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={handleClick}
        className={`w-full flex items-center gap-3 px-3 py-1.5 rounded-md text-[13px] leading-5 font-medium transition-colors ${
          isActive
            ? "bg-[#ebebeb] text-gray-900"
            : "text-[#0f172a] hover:bg-[#ebebeb] hover:text-gray-900"
        }`}
      >
        <item.icon className="w-[18px] h-[18px]" />
        {item.label}
        {item.badge ? (
          <Badge variant="destructive" className="ml-auto h-5 min-w-5 px-1.5 text-xs">
            {item.badge > 9 ? "9+" : item.badge}
          </Badge>
        ) : null}
      </Link>
    );
  }

  function renderIndustryEntry(entry: SidebarEntry) {
    if (entry.kind === "group") {
      return (
        <SidebarGroupRender
          key={entry.id}
          group={entry}
          pathname={pathname}
          onNavigate={() => setMobileOpen(false)}
        />
      );
    }
    if (entry.hideForBroadScope && (role === "owner" || role === "admin" || leadScope === "team")) {
      return null;
    }
    if (entry.allowedPositions && entry.allowedPositions.length > 0) {
      const isAdminTier = role === "owner" || role === "admin";
      const hasPosition = positionSlug != null && entry.allowedPositions.includes(positionSlug);
      if (!isAdminTier && !hasPosition) return null;
    }
    return renderNavItem({
      href: entry.href,
      label: entry.label,
      icon: INDUSTRY_ICONS[entry.icon] ?? FileText,
    });
  }


  const sidebarContent = (
    <div className="flex flex-col h-full bg-sidebar-bg">
      {/* EdgeX product brand wordmark */}
      <div className="px-5 py-3 h-[52px] flex items-center">
        <span className="text-lg font-semibold text-gray-900 tracking-tight">
          EdgeX
          {brandSuffix && (
            <span className="font-normal text-[#2663EB]">{brandSuffix}</span>
          )}
        </span>
      </div>

      {/* Mode switcher — Orca tab hidden entirely for AI-disabled tenants (env flag AND tenants.ai_enabled) */}
      {aiAssistantEnabled && (
        <div className="px-3 pb-2">
          <Tabs value={navMode} onValueChange={handleNavModeChange}>
            <TabsList className="grid w-full grid-cols-2 h-8 border border-[#00001d13]">
              <TabsTrigger value="ops" className="text-xs gap-1.5 data-[state=active]:bg-nav-active data-[state=active]:shadow-sm">
                <LayoutGrid className="w-3.5 h-3.5" />
                Ops
              </TabsTrigger>
              <TabsTrigger value="orca" className="text-xs gap-1.5 data-[state=active]:bg-nav-active data-[state=active]:shadow-sm">
                <Bot className="w-3.5 h-3.5" />
                Orca
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      )}

      {/* Global Search row — top of nav, opens command palette */}
      <div className="px-3 pb-1">
        <button
          type="button"
          onClick={() => { openSearch(); setMobileOpen(false); }}
          className="w-full flex items-center gap-3 px-3 py-1.5 rounded-md text-[13px] leading-5 font-medium transition-colors text-[#0f172a] hover:bg-[#ebebeb] hover:text-gray-900"
        >
          <Search className="w-[18px] h-[18px] shrink-0" />
          <span className="flex-1 text-left">Global Search</span>
          <kbd className="text-[11px] text-gray-400 bg-gray-100 border border-gray-200 px-1.5 py-0.5 rounded font-mono leading-none">
            {shortcutLabel}
          </kbd>
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {navMode === "ops" ? (
          isEducation ? (() => {
            // Finds a flat industry item by href (all education items are flat after manifest refactor)
            const eduItem = (href: string) =>
              industrySidebarItems.find(
                (e): e is SidebarItem => !("children" in e) && (e as SidebarItem).href === href
              );
            return (
              <>
                {/* Home — standalone, no section header */}
                {navAllowed("/home") && renderNavItem({ href: "/home", label: "Home", icon: House })}

                {/* Intelligence */}
                <NavSectionHeader label="Intelligence" />
                {eduItem("/insights/dashboards") && renderIndustryEntry(eduItem("/insights/dashboards")!)}
                {navAllowed("/knowledge-bases") && renderNavItem({ href: "/knowledge-bases", label: "Knowledge Base", icon: Library })}

                {/* Leads */}
                <NavSectionHeader label="Leads" />
                {stagingLists.length > 0 && navAllowed("/leads-organise") && (
                  <Suspense key="leads-organise-nav" fallback={
                    <div className="w-full flex items-center gap-3 px-3 py-1.5 rounded-md text-[13px] leading-5 font-medium text-[#0f172a]">
                      <span className="w-[18px] h-[18px] shrink-0" />
                      Leads Organise
                    </div>
                  }>
                    <LeadsOrganiseNavGroup
                      lists={stagingLists}
                      onNavigate={() => setMobileOpen(false)}
                    />
                  </Suspense>
                )}
                <Suspense key="lead-lists-nav" fallback={
                  <div className="w-full flex items-center gap-3 px-3 py-1.5 rounded-md text-[13px] leading-5 font-medium text-[#0f172a]">
                    <Users className="w-[18px] h-[18px] shrink-0" />
                    All Leads
                  </div>
                }>
                  <LeadListsNavGroup
                    lists={leadLists}
                    onNavigate={() => setMobileOpen(false)}
                    isAdmin={role === "owner" || role === "admin"}
                  />
                </Suspense>
                {navAllowed("/pipeline") && renderNavItem({ href: "/pipeline", label: "Pipeline", icon: Kanban })}
                {navAllowed("/contacts") && renderNavItem({ href: "/contacts", label: "Contacts", icon: Contact })}
                {archiveLists.length > 0 && (
                  <ArchiveNavLinks lists={archiveLists} onNavigate={() => setMobileOpen(false)} />
                )}

                {/* Operations */}
                <NavSectionHeader label="Operations" />
                {eduItem("/applications") && renderIndustryEntry(eduItem("/applications")!)}
                {eduItem("/classes") && renderIndustryEntry(eduItem("/classes")!)}
                {eduItem("/check-in") && renderIndustryEntry(eduItem("/check-in")!)}
                {navAllowed("/inbox") && renderNavItem({ href: "/inbox", label: "Inbox", icon: MessageSquare })}

                {/* Marketing */}
                <NavSectionHeader label="Marketing" />
                {eduItem("/forms") && renderIndustryEntry(eduItem("/forms")!)}
                {eduItem("/campaigns") && renderIndustryEntry(eduItem("/campaigns")!)}

                {/* Administration */}
                <NavSectionHeader label="Administration" />
                {navAllowed("/team") && renderNavItem({ href: "/team", label: "Org Structure", icon: Network })}
                {navAllowed("/leave") && renderNavItem({ href: "/leave", label: "Leave", icon: CalendarClock })}
                {navAllowed("/attendance") && renderNavItem({ href: "/attendance", label: "Attendance", icon: CalendarCheck })}
              </>
            );
          })() : isItAgency ? (() => {
            // Finds a flat industry item by href (Deals/Services/Proposals/Accounts/Contacts are flat)
            const itItem = (href: string) =>
              industrySidebarItems.find(
                (e): e is SidebarItem => !("children" in e) && (e as SidebarItem).href === href
              );
            return (
              <>
                {/* Home — standalone, no section header */}
                {navAllowed("/home") && renderNavItem({ href: "/home", label: "Home", icon: House })}

                {/* Intelligence */}
                <NavSectionHeader label="Intelligence" />
                {navAllowed("/dashboard") && renderNavItem({ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard })}
                {navAllowed("/knowledge-bases") && renderNavItem({ href: "/knowledge-bases", label: "Company Knowledge", icon: Library })}

                {/* Sales */}
                <NavSectionHeader label="Sales" />
                {stagingLists.length > 0 && navAllowed("/leads-organise") && (
                  <Suspense key="leads-organise-nav" fallback={
                    <div className="w-full flex items-center gap-3 px-3 py-1.5 rounded-md text-[13px] leading-5 font-medium text-[#0f172a]">
                      <span className="w-[18px] h-[18px] shrink-0" />
                      Leads Organise
                    </div>
                  }>
                    <LeadsOrganiseNavGroup
                      lists={stagingLists}
                      onNavigate={() => setMobileOpen(false)}
                    />
                  </Suspense>
                )}
                {navAllowed("/leads") && (() => {
                  // Funnel grouping is it_agency-only — non-it_agency tenants always fall
                  // through to the ungrouped/All Leads path below, even if a list somehow
                  // carries a funnel_key (belt-and-suspenders; the write path is gated too).
                  const processingLists = isItAgency
                    ? leadLists
                        .filter((l) => l.funnel_key === "lead_processing")
                        .sort((a, b) => a.sort_order - b.sort_order)
                    : [];
                  const salesLists = isItAgency
                    ? leadLists
                        .filter((l) => l.funnel_key === "sales_leads")
                        .sort((a, b) => a.sort_order - b.sort_order)
                    : [];
                  const ungroupedLists = isItAgency
                    ? leadLists.filter((l) => l.funnel_key == null)
                    : leadLists;
                  const isAdminUser = role === "owner" || role === "admin";

                  if (processingLists.length === 0 && salesLists.length === 0) {
                    return ungroupedLists.length > 0 ? (
                      <Suspense key="lead-lists-nav" fallback={
                        <div className="w-full flex items-center gap-3 px-3 py-1.5 rounded-md text-[13px] leading-5 font-medium text-[#0f172a]">
                          <Users className="w-[18px] h-[18px] shrink-0" />
                          All Leads
                        </div>
                      }>
                        <LeadListsNavGroup
                          lists={ungroupedLists}
                          onNavigate={() => setMobileOpen(false)}
                          isAdmin={isAdminUser}
                        />
                      </Suspense>
                    ) : (
                      renderNavItem({ href: "/leads", label: "All Leads", icon: Users, badge: counts.unread_leads || undefined })
                    );
                  }

                  return (
                    <>
                      <Suspense key="lead-processing-nav" fallback={
                        <div className="w-full flex items-center gap-3 px-3 py-1.5 rounded-md text-[13px] leading-5 font-medium text-[#0f172a]">
                          <Filter className="w-[18px] h-[18px] shrink-0" />
                          Lead Processing
                        </div>
                      }>
                        <LeadFunnelNavGroup
                          funnelKey="lead_processing"
                          label="Lead Processing"
                          icon={Filter}
                          lists={processingLists}
                          onNavigate={() => setMobileOpen(false)}
                          isAdmin={isAdminUser}
                        />
                      </Suspense>
                      <Suspense key="sales-leads-nav" fallback={
                        <div className="w-full flex items-center gap-3 px-3 py-1.5 rounded-md text-[13px] leading-5 font-medium text-[#0f172a]">
                          <Target className="w-[18px] h-[18px] shrink-0" />
                          Sales Leads
                        </div>
                      }>
                        <LeadFunnelNavGroup
                          funnelKey="sales_leads"
                          label="Sales Leads"
                          icon={Target}
                          lists={salesLists}
                          onNavigate={() => setMobileOpen(false)}
                          isAdmin={isAdminUser}
                        />
                      </Suspense>
                      {ungroupedLists.length > 0 && (
                        <Suspense key="lead-lists-nav" fallback={
                          <div className="w-full flex items-center gap-3 px-3 py-1.5 rounded-md text-[13px] leading-5 font-medium text-[#0f172a]">
                            <Users className="w-[18px] h-[18px] shrink-0" />
                            All Leads
                          </div>
                        }>
                          <LeadListsNavGroup
                            lists={ungroupedLists}
                            onNavigate={() => setMobileOpen(false)}
                            isAdmin={isAdminUser}
                          />
                        </Suspense>
                      )}
                    </>
                  );
                })()}
                {archiveLists.length > 0 && (
                  <ArchiveNavLinks lists={archiveLists} onNavigate={() => setMobileOpen(false)} />
                )}
                {navAllowed("/pipeline") && renderNavItem({ href: "/pipeline", label: "Pipeline", icon: Kanban })}

                {/* Revenue */}
                <NavSectionHeader label="Revenue" />
                {itItem("/proposals") && renderIndustryEntry(itItem("/proposals")!)}
                {itItem("/deals") && renderIndustryEntry(itItem("/deals")!)}
                {itItem("/services") && renderIndustryEntry(itItem("/services")!)}

                {/* Clients */}
                <NavSectionHeader label="Clients" />
                {itItem("/accounts") && renderIndustryEntry(itItem("/accounts")!)}
                {itItem("/contacts") && renderIndustryEntry(itItem("/contacts")!)}

                {/* Delivery */}
                <NavSectionHeader label="Delivery" />
                {itItem("/projects") && renderIndustryEntry(itItem("/projects")!)}
                {itItem("/tasks") && renderIndustryEntry(itItem("/tasks")!)}
                {itItem("/time-tracking") && renderIndustryEntry(itItem("/time-tracking")!)}
                {itItem("/approvals") && renderIndustryEntry(itItem("/approvals")!)}

                {/* Communication */}
                <NavSectionHeader label="Communication" />
                {navAllowed("/inbox") && renderNavItem({ href: "/inbox", label: "Inbox", icon: MessageSquare })}

                {/* Organization */}
                <NavSectionHeader label="Organization" />
                {navAllowed("/team") && renderNavItem({ href: "/team", label: "Org Structure", icon: Network })}
                {navAllowed("/people") && renderNavItem({ href: "/people", label: "People", icon: UsersRound })}
                {navAllowed("/leave") && renderNavItem({ href: "/leave", label: "Leave", icon: CalendarClock })}
                {navAllowed("/attendance") && renderNavItem({ href: "/attendance", label: "Attendance", icon: CalendarCheck })}
                {itItem("/resourcing") && renderIndustryEntry(itItem("/resourcing")!)}
                {itItem("/resourcing/utilization") && renderIndustryEntry(itItem("/resourcing/utilization")!)}
              </>
            );
          })() : isRealEstate ? (() => {
            // real_estate (CRE capital-raise): departmental sidebar mirroring the
            // it_agency branch. Investors ride the universal /leads spine (relabeled);
            // Offerings + Data Room come from the industry manifest via reItem().
            const reItem = (href: string) =>
              industrySidebarItems.find(
                (e): e is SidebarItem => !("children" in e) && (e as SidebarItem).href === href
              );
            return (
              <>
                {/* Home — standalone, no section header */}
                {navAllowed("/home") && renderNavItem({ href: "/home", label: "Home", icon: House })}

                {/* Intelligence */}
                <NavSectionHeader label="Intelligence" />
                {navAllowed("/dashboard") && renderNavItem({ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard })}
                {navAllowed("/knowledge-bases") && renderNavItem({ href: "/knowledge-bases", label: "Company Knowledge", icon: Library })}

                {/* Capital Raise */}
                <NavSectionHeader label="Capital Raise" />
                {navAllowed("/leads") && renderNavItem({ href: "/leads", label: "Investors", icon: UsersRound, badge: counts.unread_leads || undefined })}
                {reItem("/offerings") && renderIndustryEntry(reItem("/offerings")!)}
                {navAllowed("/pipeline") && renderNavItem({ href: "/pipeline", label: "Pipeline", icon: Kanban })}
                {reItem("/data-room") && renderIndustryEntry(reItem("/data-room")!)}

                {/* Investor Relations — header omitted until Distributions/Statements
                    land (avoids an empty-section header). Add it here when they do. */}

                {/* People */}
                <NavSectionHeader label="People" />
                {navAllowed("/team") && renderNavItem({ href: "/team", label: "Org Structure", icon: Network })}
                {navAllowed("/leave") && renderNavItem({ href: "/leave", label: "Leave", icon: CalendarClock })}
                {navAllowed("/attendance") && renderNavItem({ href: "/attendance", label: "Attendance", icon: CalendarCheck })}

                {/* Comms */}
                <NavSectionHeader label="Comms" />
                {navAllowed("/inbox") && renderNavItem({ href: "/inbox", label: "Inbox", icon: MessageSquare })}
              </>
            );
          })() : (
          <>
            {stagingLists.length > 0 && navAllowed("/leads-organise") && (
              <Suspense key="leads-organise-nav" fallback={
                <div className="w-full flex items-center gap-3 px-3 py-1.5 rounded-md text-[13px] leading-5 font-medium text-[#0f172a]">
                  <span className="w-[18px] h-[18px] shrink-0" />
                  Leads Organise
                </div>
              }>
                <LeadsOrganiseNavGroup
                  lists={stagingLists}
                  onNavigate={() => setMobileOpen(false)}
                />
              </Suspense>
            )}
            {UNIVERSAL_NAV_TOP
              .filter((i) => navAllowed(i.href))
              .flatMap((item) => {
                // Tenants with lead lists: replace flat "All Leads" with the dynamic group
                if (item.href === "/leads" && leadLists.length > 0) {
                  return [
                    <Suspense key="lead-lists-nav" fallback={
                      <div className="w-full flex items-center gap-3 px-3 py-1.5 rounded-md text-[13px] leading-5 font-medium text-[#0f172a]">
                        <Users className="w-[18px] h-[18px] shrink-0" />
                        All Leads
                      </div>
                    }>
                      <LeadListsNavGroup
                        lists={leadLists}
                        onNavigate={() => setMobileOpen(false)}
                        isAdmin={role === "owner" || role === "admin"}
                      />
                    </Suspense>,
                  ];
                }
                const node = renderNavItem(
                  item.href === "/leads"
                    ? { ...item, label: isRealEstate ? "Investors" : item.label, badge: counts.unread_leads || undefined }
                    : item
                );
                if (item.href === "/home") {
                  return [node, ...industryAfterHome.map(renderIndustryEntry)];
                }
                return [node];
              })}
            {industryBefore.map(renderIndustryEntry)}
            {UNIVERSAL_NAV_MIDDLE.filter((i) => navAllowed(i.href)).map(renderNavItem)}
            {archiveLists.length > 0 && (
              <ArchiveNavLinks lists={archiveLists} onNavigate={() => setMobileOpen(false)} />
            )}
            {industryAfter.map(renderIndustryEntry)}
            {UNIVERSAL_NAV_BOTTOM.filter(
              (i) => navAllowed(i.href) && i.href !== "/settings",
            ).map(renderNavItem)}
          </>
          )
        ) : (
          <>
            {ORCA_NAV.map(renderNavItem)}
          </>
        )}
      </nav>

      {/* Account — pinned to the bottom of the sidebar; menu opens upward */}
      <div className="border-t border-gray-200 p-3 relative">
        <button
          onClick={() => setShowAccountDropdown(!showAccountDropdown)}
          className="w-full flex items-center gap-3 px-2 py-2 rounded-md transition-colors hover:bg-[#ebebeb]"
        >
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-medium shrink-0"
            style={{ backgroundColor: tenant.primary_color || "#2272B4" }}
          >
            {tenant.name.charAt(0)}
          </div>
          <div className="flex-1 min-w-0 text-left">
            <p className="text-sm font-medium text-gray-900 truncate">{userName}</p>
            <p className="text-xs text-gray-500 truncate">{user.email}</p>
          </div>
          <ChevronDown className={`w-4 h-4 text-gray-500 shrink-0 transition-transform ${showAccountDropdown ? "rotate-180" : ""}`} />
        </button>

        {showAccountDropdown && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowAccountDropdown(false)} />
            <div className="absolute left-3 right-3 bottom-full mb-2 bg-white rounded-xl shadow-lg border border-gray-200 py-2 z-50">
              {/* User info */}
              <div className="px-4 py-3 border-b border-gray-100">
                <p className="text-sm font-semibold text-gray-900 truncate">
                  {userName}
                </p>
                <p className="text-xs text-gray-500 truncate">{user.email}</p>
                <span className="inline-block mt-1 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium capitalize">
                  {positionName ?? role}
                </span>
              </div>

              {/* Settings (ops mode only) — owner/admin only; route + bootstrap API also hard-gate to these roles */}
              {navMode === "ops" && (role === "owner" || role === "admin") && (
                <div className="py-1">
                  <button
                    type="button"
                    onClick={() => { setShowAccountDropdown(false); openSettings(); }}
                    className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    <Settings className="w-4 h-4 text-gray-500" />
                    <span>Settings</span>
                  </button>
                </div>
              )}

              {/* Logout */}
              <div className="border-t border-gray-100 pt-1">
                <button
                  onClick={() => { setShowAccountDropdown(false); handleLogout(); }}
                  className="w-full flex items-center gap-3 px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Logout</span>
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-sidebar-bg">
      {/* Desktop sidebar - Zunkireelabs style */}
      <aside className="hidden md:flex w-60 flex-shrink-0 flex-col h-full bg-sidebar-bg print:hidden">
        {sidebarContent}
      </aside>

      {/* Main content area with header */}
      <div className="flex flex-col flex-1 min-w-0 h-full bg-sidebar-bg">
        {/* Top Header Bar - Zunkireelabs style */}
        <header className="bg-sidebar-bg px-6 py-3 h-[52px] flex items-center gap-4 w-full print:hidden">
          {/* Mobile menu button */}
          <div className="md:hidden">
            {mounted ? (
              <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                <SheetTrigger asChild>
                  <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                    <Menu className="h-5 w-5 text-gray-600" />
                  </button>
                </SheetTrigger>
                <SheetContent side="left" className="w-60 p-0">
                  {sidebarContent}
                </SheetContent>
              </Sheet>
            ) : (
              <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                <Menu className="h-5 w-5 text-gray-600" />
              </button>
            )}
          </div>

          {/* Spacer — keeps the right section right-aligned */}
          <div className="flex-1" />

          {/* Right Section - Assistant, Notifications & Tenant Dropdown */}
          <div className="flex items-center gap-3">
            {/* AI Assistant Button — hidden entirely (not just its requests 404) when disabled */}
            {aiAssistantEnabled && (
              <button
                onClick={toggleAssistant}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-all ${
                  isAssistantOpen
                    ? "bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-md"
                    : "hover:bg-gray-100 text-gray-700"
                }`}
              >
                <Sparkles className={`w-4 h-4 ${isAssistantOpen ? "text-white" : "text-purple-500"}`} />
                <span className="text-sm font-medium hidden sm:inline">Assistant</span>
              </button>
            )}

            {/* Branch Switcher — Enterprise only; admin gets dropdown, branch-scoped gets static badge */}
            <BranchSwitcher
              branches={branches}
              maxBranches={maxBranches}
              userBranchId={userBranchId}
              leadScope={leadScope}
              selectedBranchId={selectedBranchId}
            />

            {/* Notifications Dropdown */}
            <NotificationsDropdown />

            {/* Account menu moved to the sidebar footer (bottom-left) */}
          </div>
        </header>

        {/* Content container with AI Panel - flex layout */}
        <div className="flex-1 min-w-0 overflow-hidden flex">
          {/* Main content - shrinks when AI panel opens */}
          <main
            className="flex-1 min-h-0 overflow-auto p-4 mr-4 mb-4 bg-content-bg transition-all duration-500 ease-out print:overflow-visible print:h-auto print:p-0 print:m-0 print:border-0 print:rounded-none"
            style={{
              borderRadius: '8px',
              border: '1px solid #00001d13'
            }}
          >
            {children}
          </main>

          {/* AI Assistant Panel — not mounted at all when disabled, so a disabled
              tenant has no path to open it (button hidden above; this is belt-and-braces). */}
          {aiAssistantEnabled && (
            <div className="print:hidden">
              <AIAssistantPanel userFirstName={userName.split(" ")[0]} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
