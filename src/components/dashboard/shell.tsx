"use client";

import { useState, useEffect, useRef, Fragment, Suspense } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Tenant, Branch } from "@/types/database";
import type { CachedUser } from "@/lib/supabase/server";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Button } from "@/components/ui/button";
import { useAIAssistant } from "@/contexts/ai-assistant-context";
import { useSettingsModal } from "@/contexts/settings-modal-context";
import { useGlobalSearch } from "@/contexts/global-search-context";
import { AIAssistantPanel } from "./ai-assistant-panel";
import { NotificationsDropdown } from "./notifications-dropdown";
import { BranchSwitcher } from "./branch-switcher";
import { RunningTimerChip } from "./running-timer-chip";
import { useBadgeCounts } from "@/hooks/use-badge-counts";
import { useTrackPreviousPage } from "@/hooks/use-track-previous-page";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarTip } from "@/components/dashboard/sidebar-tooltip";
import type { SidebarEntry, SidebarGroup, SidebarItem } from "@/industries/_types";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import type { LeadList } from "@/types/database";
import { LeadListsNavGroup } from "@/components/dashboard/lead-lists-nav-group";
import { LeadFunnelNavGroup } from "@/components/dashboard/lead-funnel-nav-group";
import { LeadsOrganiseNavGroup } from "@/components/dashboard/leads-organise-nav-group";
import { ArchiveNavLinks } from "@/components/dashboard/archive-nav-links";
import { ReviewNavBadge } from "@/components/dashboard/orca/review-nav-badge";
import { requireOrcaAccess } from "@/lib/ai/orca-access";
import { IT_AGENCY_NAV_LAYOUT, type ItAgencyNavEntryKey } from "@/industries/it-agency/nav-layout";
import {
  EDUCATION_NAV_LAYOUT,
  EDUCATION_NAV_LABELS,
  type EducationNavEntryKey,
} from "@/industries/education-consultancy/nav-layout";
import { resolveNavSections } from "@/industries/_nav-sections";
import {
  NAV_ROW,
  NAV_ROW_COLLAPSED,
  NAV_ROW_IDLE,
  navRowTone,
  NavExpandable,
  NavGroup,
  NavIcon,
} from "@/components/dashboard/nav-primitives";
import {
  ArchiveIcon,
  GearIcon,
  KnowledgeBaseIcon,
  MenuIcon,
  RobotIcon,
  SearchIcon,
  SidebarToggleIcon,
  SparkleIcon,
  OpsIcon,
  shellIcon,
  type Icon,
} from "@/components/dashboard/shell-icons";
import {
  activeSectionId,
  groupOpenState,
  serializeGroupsCookie,
  pathMatches,
} from "@/components/dashboard/nav-groups";
import { useUsageSummary } from "@/components/dashboard/use-usage-summary";
import { UserMenu } from "@/components/dashboard/user-menu";
import { cn } from "@/lib/utils";

// Universal nav items — every tenant sees these regardless of industry.
// Industry-scoped items (e.g. Check-In, Forms) come from the tenant's
// industry manifest via `industrySidebarItems` prop and are inserted
// between the "top" and "bottom" universal sections.
const UNIVERSAL_NAV_TOP: Array<{ href: string; label: string; icon: Icon }> = [
  { href: "/home", label: "Home", icon: shellIcon("House") },
  { href: "/dashboard", label: "Dashboard", icon: shellIcon("LayoutDashboard") },
  { href: "/knowledge-bases", label: "Knowledge Bases", icon: shellIcon("Library") },
  { href: "/leads", label: "All Leads", icon: shellIcon("Users") },
];

const UNIVERSAL_NAV_MIDDLE: Array<{ href: string; label: string; icon: Icon }> = [
  { href: "/pipeline", label: "Pipeline", icon: shellIcon("Kanban") },
  { href: "/inbox", label: "Inbox", icon: shellIcon("Inbox", "/inbox") },
];

const UNIVERSAL_NAV_BOTTOM: Array<{ href: string; label: string; icon: Icon }> = [
  { href: "/team", label: "Org Structure", icon: shellIcon("Network") },
  { href: "/leave", label: "Leave", icon: shellIcon("CalendarClock") },
  { href: "/attendance", label: "Attendance", icon: shellIcon("CalendarCheck") },
  { href: "/settings", label: "Settings", icon: shellIcon("Settings") },
];

const ORCA_NAV: Array<{ href: string; label: string; icon: Icon; adminOnly?: boolean }> = [
  { href: "/orca", label: "Overview", icon: shellIcon("LayoutDashboard") },
  { href: "/orca/activity", label: "Ask Orca", icon: shellIcon("MessageSquare") },
  { href: "/orca/structure", label: "Org Structure", icon: shellIcon("Network") },
  { href: "/orca/tasks", label: "Tasks", icon: shellIcon("ListChecks") },
  { href: "/orca/agents", label: "Agents", icon: shellIcon("Bot") },
  { href: "/orca/review", label: "Review", icon: shellIcon("Inbox", "/inbox"), adminOnly: true },
];

/** Placeholder row while a Suspense-wrapped nav slot loads (same size as the real row, so nothing jumps). */
function NavFallback({ icon, label }: { icon?: Icon; label: string }) {
  return (
    <div className={cn(NAV_ROW, "text-ds-muted")}>
      {icon ? <NavIcon icon={icon} /> : <span className="size-[18px] shrink-0" />}
      {label}
    </div>
  );
}

function SidebarGroupRender({
  group,
  pathname,
  onNavigate,
  collapsed,
}: {
  group: SidebarGroup;
  pathname: string;
  onNavigate: () => void;
  collapsed?: boolean;
}) {
  const isChildActive = (item: SidebarItem) =>
    pathname === item.href ||
    (item.href !== "/dashboard" && pathname.startsWith(item.href));

  return (
    <NavExpandable
      icon={shellIcon(group.icon)}
      label={group.label}
      collapsed={collapsed}
      onNavigate={onNavigate}
      hasActiveChild={group.children.some(isChildActive)}
      links={group.children.map((child) => ({
        key: child.href,
        href: child.href,
        label: child.label,
        active: isChildActive(child),
      }))}
    />
  );
}

interface FormSummary {
  name: string;
  slug: string;
}

interface DashboardShellProps {
  user: CachedUser;
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
  leadLists?: Pick<LeadList, "id" | "name" | "slug" | "sort_order" | "funnel_key">[];
  stagingLists?: Pick<LeadList, "id" | "name" | "slug">[];
  archiveLists?: Pick<LeadList, "id" | "name" | "slug">[];
  /** Env flag AND tenants.ai_enabled (migration 174) — see src/lib/ai/flag.ts. */
  aiAssistantEnabled?: boolean;
  /** FEATURES.TIME_TRACKING for the tenant — gates the global running-timer chip. See running-timer-chip.tsx. */
  timeTrackingEnabled?: boolean;
  /** Fold state from the nav-groups cookie, read by the server layout so first paint is right. */
  initialNavGroups?: Record<string, boolean> | null;
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
  aiAssistantEnabled: aiAssistantEnabledProp = false,
  timeTrackingEnabled = false,
  initialNavGroups = null,
  children,
}: DashboardShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  // Remembers the last non-lead-detail page visited, so the Lead Detail
  // page's back button can return to the actual origin instead of a blind
  // router.back() — see src/hooks/use-track-previous-page.ts.
  useTrackPreviousPage();
  // Interim Orca access gate: the entire Orca surface (mode switcher, nav,
  // Ask-Orca assistant panel) is OWNER ONLY until per-user AI access levels
  // ship (first Admizz prod exposure — admin excluded). The matching /orca/*
  // layout and AI API routes enforce the same rule server-side — this just
  // keeps the UI consistent.
  const aiAssistantEnabled = aiAssistantEnabledProp && requireOrcaAccess(role);
  // AI-disabled tenants never get the Orca nav mode, even mid-navigation to a
  // /orca/* URL that the orca layout gate is about to 404 — keeps the sidebar
  // consistent with the (hidden) mode-switcher tab above.
  const isOrcaRoute = aiAssistantEnabled && (pathname === "/orca" || pathname.startsWith("/orca/"));
  const navMode = isOrcaRoute ? "orca" : "ops";
  const isLeadsFullBleed = pathname === "/leads";
  const [mounted, setMounted] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [navScrolled, setNavScrolled] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const { isOpen: isAssistantOpen, toggleAssistant } = useAIAssistant();
  const { openSettings } = useSettingsModal();
  const { open: openSearch, shortcutLabel } = useGlobalSearch();
  const { counts } = useBadgeCounts();

  // Logged-in user's display name (shown in the header avatar button and the menu).
  const userMeta = user.user_metadata as { name?: string; full_name?: string } | undefined;
  const userName =
    userMeta?.name?.trim() ||
    userMeta?.full_name?.trim() ||
    user.email?.split("@")[0] ||
    "User";

  const navAllowed = (href: string) => href === "/home" || allowedNavKeys === null || allowedNavKeys.includes(href);
  const isEducation = tenant.industry_id === "education_consultancy";
  const isItAgency = tenant.industry_id === "it_agency";
  const isAdminUser = role === "owner" || role === "admin";
  // Offerings-industry tenants (real_estate, home_moving — see FEATURES.OFFERINGS
  // in each manifest): renders the generic sidebar branch, but the universal
  // "All Leads" nav item is relabeled "Investors" (investors ride the leads
  // spine). Gated on feature access, not a hardcoded industry list, so a future
  // third industry opting into Offerings picks this up automatically.
  const isRealEstate = getFeatureAccess(tenant.industry_id, FEATURES.OFFERINGS);

  // Industry suffix appended to the EdgeX wordmark (empty = plain "EdgeX").
  const brandSuffix =
    ({
      education_consultancy: "edu",
      travel_agency: "travel",
      it_agency: "agency",
      real_estate: "capital",
    } as Record<string, string>)[tenant.industry_id ?? ""] ?? "";

  // ── Foldable groups (EDGEX-86 §3) ────────────────────────────────────────
  // Remembered per browser per tenant in a cookie the server layout reads, so SSR renders the stored state.
  const [storedGroups, setStoredGroups] = useState<Record<string, boolean> | null>(initialNavGroups);

  function groupState(id: string, defaultOpen: boolean, containsRoute: boolean) {
    const open = groupOpenState(storedGroups, { [id]: defaultOpen }, containsRoute ? id : null)[id];
    return {
      open,
      onToggle: () => {
        const next = { ...(storedGroups ?? {}), [id]: !open };
        setStoredGroups(next);
        try {
          document.cookie = serializeGroupsCookie(tenant.id, next);
        } catch {
          // ignore — the fold still works for this page view
        }
      },
    };
  }

  // Fix hydration mismatch: wait until client-side before rendering Radix UI components
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
    if (localStorage.getItem("sidebar-collapsed") === "true") setSidebarCollapsed(true);
  }, []);

  // Persist the collapse preference once mounted (avoids clobbering it before the initial read above).
  useEffect(() => {
    if (mounted) localStorage.setItem("sidebar-collapsed", String(sidebarCollapsed));
  }, [sidebarCollapsed, mounted]);

  // Suspended-account watchdog. Suspension (migration 220) is already
  // enforced server-side on every API call and every server-rendered
  // navigation (buildUserAuthContext/getCurrentUserTenant both fail-closed) —
  // but someone sitting on an already-loaded dashboard tab with no further
  // navigation or fetch never hits either checkpoint, so they'd keep full
  // access until they happened to click something. Poll the same
  // /api/v1/auth/status endpoint the login page uses so a suspension takes
  // effect within one interval even with zero interaction. Not instant
  // (~15s worst case) — the server-side checks remain the actual security
  // boundary; this only closes the stale-open-tab UX gap.
  useEffect(() => {
    let cancelled = false;
    async function checkSuspended() {
      try {
        const res = await fetch("/api/v1/auth/status");
        if (!res.ok || cancelled) return;
        const { data } = await res.json();
        if (cancelled || !data?.blocked) return;
        const supabase = createClient();
        await supabase.auth.signOut();
        router.push("/login?error=suspended");
      } catch {
        // Network hiccup — the next interval tick retries; server-side
        // enforcement still applies to any real request in the meantime.
      }
    }
    const intervalId = setInterval(checkSuspended, 15000);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [router]);

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

  // ── Usage ring + credit cards (EDGEX-86 §6–§7). Owner/admin only. ────────
  // The workspace-level AI state (env flag AND tenants.ai_enabled), not the owner-only Orca UI gate.
  const smsEligible = industrySidebarItems.some((e) =>
    e.kind === "group" ? e.children.some((c) => c.href === "/sms") : e.href === "/sms",
  );
  const usage = useUsageSummary({ isAdmin: isAdminUser, aiOn: aiAssistantEnabledProp, smsEligible });
  const branchLabel = userBranchId
    ? (branches.find((b) => b.id === userBranchId)?.name ?? "All branches")
    : "All branches";

  const industryAfterHome = industrySidebarItems.filter(
    (e) => e.position === "after-home",
  );
  const industryBefore = industrySidebarItems.filter(
    (e) => (e.position ?? "before-pipeline") === "before-pipeline",
  );
  const industryAfter = industrySidebarItems.filter(
    (e) => e.position === "after-pipeline",
  );

  const closeMobile = () => setMobileOpen(false);

  // Everything that renders nav rows depends on whether the sidebar is the icon-only rail. The mobile
  // drawer is never a rail (EDGEX-86 round 1), whatever the desktop collapsed preference is, so the
  // builders are made per sidebar instance.
  const makeNav = (rail: boolean) => {
  function renderNavItem(item: { href: string; label: string; icon: Icon; badge?: number; badgeSlot?: React.ReactNode; onClick?: () => void }) {
    const isActive =
      pathname === item.href ||
      (item.href !== "/dashboard" && item.href !== "/orca" && pathname.startsWith(item.href));
    const handleClick = item.onClick
      ? () => { item.onClick!(); setMobileOpen(false); }
      : () => setMobileOpen(false);
    return (
      <SidebarTip key={item.href} label={item.label} enabled={rail}>
      <Link
        href={item.href}
        onClick={handleClick}
        aria-label={rail ? item.label : undefined}
        className={cn("relative", NAV_ROW, rail && NAV_ROW_COLLAPSED, navRowTone(isActive))}
      >
        <NavIcon icon={item.icon} active={isActive} />
        {!rail && (
          <>
            <span className="flex-1 truncate text-left">{item.label}</span>
            {item.badgeSlot !== undefined
              ? item.badgeSlot
              : item.badge
                ? (
                    <span className="ml-auto text-[11.5px] font-normal tabular-nums text-ds-muted">
                      {item.badge > 9 ? "9+" : item.badge}
                    </span>
                  )
                : null}
          </>
        )}
        {rail && item.badge ? (
          <span className="absolute right-1.5 top-1 size-2 rounded-full bg-ds-bad" />
        ) : null}
      </Link>
      </SidebarTip>
    );
  }

  function renderIndustryEntry(entry: SidebarEntry, labelOverride?: string) {
    if (entry.kind === "group") {
      return (
        <SidebarGroupRender
          key={entry.id}
          group={entry}
          pathname={pathname}
          onNavigate={() => setMobileOpen(false)}
          collapsed={rail}
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
      label: labelOverride ?? entry.label,
      icon: shellIcon(entry.icon, entry.href),
      badge: entry.href === "/outreach" ? counts.outreach_due || undefined : undefined,
    });
  }

  /** Renders a declarative NavSection layout (education, it_agency): an empty group drops its header; groups fold. */
  function renderLayout<K extends string>(
    layout: readonly { id: string; label?: string; defaultFolded?: boolean; entries: readonly K[] }[],
    resolve: (key: K) => React.ReactNode | null,
  ) {
    const activeId = activeSectionId(layout, pathname);
    return resolveNavSections(layout, resolve).map((section) => {
      const items = section.items.map(({ key, node }) => <Fragment key={key}>{node}</Fragment>);
      if (!section.label) return <Fragment key={section.id}>{items}</Fragment>;
      const defaultFolded = layout.find((s) => s.id === section.id)?.defaultFolded ?? false;
      const g = groupState(section.id, !defaultFolded, activeId === section.id);
      return (
        <NavGroup key={section.id} label={section.label} open={g.open} onToggle={g.onToggle} collapsed={rail}>
          {items}
        </NavGroup>
      );
    });
  }

  /** A hand-written group (real_estate): same fold behaviour, "contains the route" from its hrefs. */
  function renderFoldGroup(id: string, label: string, hrefs: string[], children: React.ReactNode) {
    const g = groupState(id, true, hrefs.some((h) => pathMatches(pathname, h)));
    return (
      <NavGroup key={id} label={label} open={g.open} onToggle={g.onToggle} collapsed={rail}>
        {children}
      </NavGroup>
    );
  }


  // ── Education (EDGEX-86 §2): data-driven, gating byte-for-byte what the JSX used before ──
  function renderEducationNav() {
    // Finds a flat industry item by href (all education items are flat after manifest refactor)
    const eduItem = (href: string) =>
      industrySidebarItems.find(
        (e): e is SidebarItem => !("children" in e) && (e as SidebarItem).href === href
      );

    function resolveEntry(key: EducationNavEntryKey): React.ReactNode {
      switch (key) {
        case "universal:/home":
          return navAllowed("/home") ? renderNavItem({ href: "/home", label: "Home", icon: shellIcon("House") }) : null;
        case "universal:/inbox":
          return navAllowed("/inbox") ? renderNavItem({ href: "/inbox", label: "Inbox", icon: shellIcon("Inbox", "/inbox") }) : null;
        case "universal:/knowledge-bases":
          return navAllowed("/knowledge-bases")
            ? renderNavItem({ href: "/knowledge-bases", label: EDUCATION_NAV_LABELS[key]!, icon: KnowledgeBaseIcon })
            : null;
        case "slot:lead-lists":
          return (
            <Suspense key="lead-lists-nav" fallback={<NavFallback icon={shellIcon("Users")} label="All leads" />}>
              <LeadListsNavGroup
                lists={leadLists}
                onNavigate={closeMobile}
                collapsed={rail}
                isAdmin={isAdminUser}
                label="All leads"
              />
            </Suspense>
          );
        case "universal:/pipeline":
          return navAllowed("/pipeline") ? renderNavItem({ href: "/pipeline", label: "Pipeline", icon: shellIcon("Kanban") }) : null;
        case "slot:leads-organise":
          return stagingLists.length > 0 && navAllowed("/leads-organise") ? (
            <Suspense key="leads-organise-nav" fallback={<NavFallback label="Organise" />}>
              <LeadsOrganiseNavGroup lists={stagingLists} onNavigate={closeMobile} collapsed={rail} label="Organise" />
            </Suspense>
          ) : null;
        case "universal:/contacts":
          return navAllowed("/contacts") ? renderNavItem({ href: "/contacts", label: "Contacts", icon: shellIcon("Contact") }) : null;
        case "universal:/team":
          return navAllowed("/team") ? renderNavItem({ href: "/team", label: EDUCATION_NAV_LABELS[key]!, icon: shellIcon("Network") }) : null;
        case "universal:/leave":
          return navAllowed("/leave") ? renderNavItem({ href: "/leave", label: "Leave", icon: shellIcon("CalendarClock") }) : null;
        case "universal:/attendance":
          return navAllowed("/attendance") ? renderNavItem({ href: "/attendance", label: "Attendance", icon: shellIcon("CalendarCheck") }) : null;
        default: {
          // Remaining keys are industry hrefs resolved from the (permission-filtered) manifest.
          const entry = eduItem(key);
          return entry ? renderIndustryEntry(entry, EDUCATION_NAV_LABELS[key]) : null;
        }
      }
    }

    return <>{renderLayout(EDUCATION_NAV_LAYOUT, resolveEntry)}</>;
  }

  function renderItAgencyNav() {
    // Finds a flat industry item by href (Deals/Services/Proposals/Accounts/Contacts are flat)
    const itItem = (href: string) =>
      industrySidebarItems.find(
        (e): e is SidebarItem => !("children" in e) && (e as SidebarItem).href === href
      );

    function renderLeadsOrganiseSlot(): React.ReactNode {
      if (!(stagingLists.length > 0 && navAllowed("/leads-organise"))) return null;
      return (
        <Suspense fallback={<NavFallback label="Leads Organise" />}>
          <LeadsOrganiseNavGroup lists={stagingLists} onNavigate={closeMobile} collapsed={rail} />
        </Suspense>
      );
    }

    function renderLeadsFunnelsSlot(): React.ReactNode {
      if (!navAllowed("/leads")) return null;
      const processingLists = leadLists
        .filter((l) => l.funnel_key === "lead_processing")
        .sort((a, b) => a.sort_order - b.sort_order);
      const salesLists = leadLists
        .filter((l) => l.funnel_key === "sales_leads")
        .sort((a, b) => a.sort_order - b.sort_order);
      const ungroupedLists = leadLists.filter((l) => l.funnel_key == null);

      if (processingLists.length === 0 && salesLists.length === 0) {
        return ungroupedLists.length > 0 ? (
          <Suspense fallback={<NavFallback icon={shellIcon("Users")} label="All Leads" />}>
            <LeadListsNavGroup
              lists={ungroupedLists}
              onNavigate={closeMobile}
              collapsed={rail}
              isAdmin={isAdminUser}
            />
          </Suspense>
        ) : (
          renderNavItem({ href: "/leads", label: "All Leads", icon: shellIcon("Users"), badge: counts.unread_leads || undefined })
        );
      }

      return (
        <>
          <Suspense key="lead-processing-nav" fallback={<NavFallback icon={shellIcon("Workflow")} label="Lead Processing" />}>
            <LeadFunnelNavGroup
              funnelKey="lead_processing"
              label="Lead Processing"
              icon={shellIcon("Workflow")}
              lists={processingLists}
              onNavigate={closeMobile}
              collapsed={rail}
              isAdmin={isAdminUser}
            />
          </Suspense>
          <Suspense key="sales-leads-nav" fallback={<NavFallback icon={shellIcon("Users")} label="Sales Leads" />}>
            <LeadFunnelNavGroup
              funnelKey="sales_leads"
              label="Sales Leads"
              icon={shellIcon("Users")}
              lists={salesLists}
              onNavigate={closeMobile}
              collapsed={rail}
              isAdmin={isAdminUser}
            />
          </Suspense>
          {ungroupedLists.length > 0 && (
            <Suspense key="lead-lists-nav" fallback={<NavFallback icon={shellIcon("Users")} label="All Leads" />}>
              <LeadListsNavGroup
                lists={ungroupedLists}
                onNavigate={closeMobile}
                collapsed={rail}
                isAdmin={isAdminUser}
              />
            </Suspense>
          )}
        </>
      );
    }

    // Resolves one entry key to its rendered node (or null — a
    // section whose entries all resolve to null renders no header).
    function resolveEntry(key: ItAgencyNavEntryKey): React.ReactNode {
      if (key.startsWith("universal:")) {
        switch (key) {
          case "universal:/home":
            return navAllowed("/home") ? renderNavItem({ href: "/home", label: "Home", icon: shellIcon("House") }) : null;
          case "universal:/dashboard":
            return navAllowed("/dashboard") ? renderNavItem({ href: "/dashboard", label: "Dashboard", icon: shellIcon("LayoutDashboard") }) : null;
          case "universal:/knowledge-bases":
            return navAllowed("/knowledge-bases") ? renderNavItem({ href: "/knowledge-bases", label: "Company Knowledge", icon: shellIcon("Library") }) : null;
          case "universal:/pipeline":
            return navAllowed("/pipeline") ? renderNavItem({ href: "/pipeline", label: "Pipeline", icon: shellIcon("Kanban") }) : null;
          case "universal:/inbox":
            return navAllowed("/inbox") ? renderNavItem({ href: "/inbox", label: "Inbox", icon: shellIcon("Inbox", "/inbox") }) : null;
          case "universal:/team":
            return navAllowed("/team") ? renderNavItem({ href: "/team", label: "Org Structure", icon: shellIcon("Network") }) : null;
          case "universal:/people":
            return navAllowed("/people") ? renderNavItem({ href: "/people", label: "People", icon: shellIcon("UsersRound", "/people") }) : null;
          case "universal:/leave":
            return navAllowed("/leave") ? renderNavItem({ href: "/leave", label: "Leave", icon: shellIcon("CalendarClock") }) : null;
          case "universal:/attendance":
            return navAllowed("/attendance") ? renderNavItem({ href: "/attendance", label: "Attendance", icon: shellIcon("CalendarCheck") }) : null;
          default:
            return null;
        }
      }
      if (key === "slot:leads-organise") return renderLeadsOrganiseSlot();
      if (key === "slot:leads-funnels") return renderLeadsFunnelsSlot();
      // Remaining keys are industry hrefs resolved from the manifest.
      const entry = itItem(key);
      return entry ? renderIndustryEntry(entry) : null;
    }

    return <>{renderLayout(IT_AGENCY_NAV_LAYOUT, resolveEntry)}</>;
  }

  function renderRealEstateNav() {
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
        {navAllowed("/home") && renderNavItem({ href: "/home", label: "Home", icon: shellIcon("House") })}

        {renderFoldGroup("intelligence", "Intelligence", ["/dashboard", "/knowledge-bases"], (
          <>
            {navAllowed("/dashboard") && renderNavItem({ href: "/dashboard", label: "Dashboard", icon: shellIcon("LayoutDashboard") })}
            {navAllowed("/knowledge-bases") && renderNavItem({ href: "/knowledge-bases", label: "Company Knowledge", icon: shellIcon("Library") })}
          </>
        ))}

        {renderFoldGroup("capital-raise", "Capital Raise", ["/leads", "/forms", "/offerings", "/pipeline", "/data-room"], (
          <>
            {navAllowed("/leads") && renderNavItem({ href: "/leads", label: "Investors", icon: shellIcon("UsersRound"), badge: counts.unread_leads || undefined })}
            {/* /forms only resolves for tenants whose manifest registers FORM_BUILDER
                (currently home_moving, not real_estate) — reItem() returns undefined
                otherwise, so this is a no-op for real_estate tenants. */}
            {reItem("/forms") && renderIndustryEntry(reItem("/forms")!)}
            {reItem("/offerings") && renderIndustryEntry(reItem("/offerings")!)}
            {navAllowed("/pipeline") && renderNavItem({ href: "/pipeline", label: "Pipeline", icon: shellIcon("Kanban") })}
            {reItem("/data-room") && renderIndustryEntry(reItem("/data-room")!)}
          </>
        ))}

        {/* Investor Relations — header omitted until Distributions/Statements
            land (avoids an empty-section header). Add it here when they do. */}

        {renderFoldGroup("people", "People", ["/team", "/leave", "/attendance"], (
          <>
            {navAllowed("/team") && renderNavItem({ href: "/team", label: "Org Structure", icon: shellIcon("Network") })}
            {navAllowed("/leave") && renderNavItem({ href: "/leave", label: "Leave", icon: shellIcon("CalendarClock") })}
            {navAllowed("/attendance") && renderNavItem({ href: "/attendance", label: "Attendance", icon: shellIcon("CalendarCheck") })}
          </>
        ))}

        {renderFoldGroup("comms", "Comms", ["/inbox"], (
          <>
            {navAllowed("/inbox") && renderNavItem({ href: "/inbox", label: "Inbox", icon: shellIcon("Inbox", "/inbox") })}
          </>
        ))}
      </>
    );
  }

  function renderGenericNav() {
    return (
      <>
        {stagingLists.length > 0 && navAllowed("/leads-organise") && (
          <Suspense key="leads-organise-nav" fallback={<NavFallback label="Leads Organise" />}>
            <LeadsOrganiseNavGroup lists={stagingLists} onNavigate={closeMobile} collapsed={rail} />
          </Suspense>
        )}
        {UNIVERSAL_NAV_TOP
          .filter((i) => navAllowed(i.href))
          .flatMap((item) => {
            // Tenants with lead lists: replace flat "All Leads" with the dynamic group
            if (item.href === "/leads" && leadLists.length > 0) {
              return [
                <Suspense key="lead-lists-nav" fallback={<NavFallback icon={shellIcon("Users")} label="All Leads" />}>
                  <LeadListsNavGroup
                    lists={leadLists}
                    onNavigate={closeMobile}
                    collapsed={rail}
                    isAdmin={isAdminUser}
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
              return [node, ...industryAfterHome.map((e) => renderIndustryEntry(e))];
            }
            return [node];
          })}
        {industryBefore.map((e) => renderIndustryEntry(e))}
        {UNIVERSAL_NAV_MIDDLE.filter((i) => navAllowed(i.href)).map(renderNavItem)}
        {industryAfter.map((e) => renderIndustryEntry(e))}
        {UNIVERSAL_NAV_BOTTOM.filter(
          (i) => navAllowed(i.href) && i.href !== "/settings",
        ).map(renderNavItem)}
      </>
    );
  }

  return { renderNavItem, renderEducationNav, renderItAgencyNav, renderRealEstateNav, renderGenericNav };
  };

  // Archive + Settings, pinned under the scrolling nav (EDGEX-86 §4). Ops mode only, as before.
  // real_estate never rendered archive lists in its sidebar, so it keeps not showing them.
  const showFooterArchive = navMode === "ops" && archiveLists.length > 0 && !isRealEstate;
  const showFooterSettings = navMode === "ops" && isAdminUser;

  const renderSidebar = (inDrawer: boolean) => {
    const rail = !inDrawer && sidebarCollapsed;
    const nav = makeNav(rail);
    return (
    <TooltipProvider delayDuration={0} skipDelayDuration={300}>
    <div className="flex flex-col h-full bg-sidebar-bg">
      {/* EdgeX product brand wordmark + sidebar collapse toggle, same row */}
      <div
        className={`h-[38px] flex items-center py-0 ${
          rail ? "justify-center px-2" : "justify-between px-5"
        }`}
      >
        {!rail && (
          <span className="text-[15px] font-semibold tracking-tight text-ds-ink truncate">
            EdgeX
            {brandSuffix && (
              <span className="font-normal text-ds-accent">{brandSuffix}</span>
            )}
          </span>
        )}
        {!inDrawer && (
        <SidebarTip label={rail ? "Expand sidebar" : "Collapse sidebar"}>
        <button
          type="button"
          onClick={() => setSidebarCollapsed((v) => !v)}
          aria-label={rail ? "Expand sidebar" : "Collapse sidebar"}
          className="p-1.5 rounded-ds-sm text-ds-faint hover:bg-ds-hover hover:text-ds-ink transition-colors shrink-0"
        >
          <SidebarToggleIcon size={18} weight="regular" aria-hidden />
        </button>
        </SidebarTip>
        )}
      </div>

      {/* Branch picker lives in the mobile drawer on small screens (the header strip drops it). */}
      {inDrawer && (
        <div className="px-3 pb-2">
          <BranchSwitcher
            branches={branches}
            maxBranches={maxBranches}
            userBranchId={userBranchId}
            leadScope={leadScope}
            selectedBranchId={selectedBranchId}
          />
        </div>
      )}

      {/* Mode switcher — Orca tab hidden entirely for AI-disabled tenants (env flag AND tenants.ai_enabled); also hidden while collapsed (no room for labeled tabs) */}
      {aiAssistantEnabled && !rail && (
        <div className="px-3 pb-2">
          <SegmentedControl
            aria-label="Workspace mode"
            value={navMode}
            onValueChange={handleNavModeChange}
            className="w-full rounded-[10px] [&>button]:flex-1"
            items={[
              {
                value: "ops",
                label: (
                  <span className="inline-flex items-center justify-center gap-1.5">
                    <OpsIcon size={14} aria-hidden />
                    Ops
                  </span>
                ),
              },
              {
                value: "orca",
                label: (
                  <span className="inline-flex items-center justify-center gap-1.5">
                    <RobotIcon size={14} aria-hidden />
                    Orca
                  </span>
                ),
              },
            ]}
          />
        </div>
      )}

      {/* Search row — top of nav, opens command palette */}
      <div className="px-3 pt-2 pb-1">
        <SidebarTip label="Search" enabled={rail}>
        <button
          type="button"
          onClick={() => { openSearch(); setMobileOpen(false); }}
          aria-label={rail ? "Search" : undefined}
          className={cn(
            "flex h-8 w-full items-center gap-2 rounded-ds-sm border border-ds-border bg-ds-surface text-[13px] text-ds-muted transition-colors hover:bg-ds-hover",
            rail ? "justify-center px-0" : "pl-2.5 pr-2",
          )}
        >
          <SearchIcon size={16} weight="regular" aria-hidden className="shrink-0 text-ds-faint" />
          {!rail && (
            <>
              <span className="flex-1 text-left">Search</span>
              <kbd className="grid h-[18px] place-items-center rounded-[5px] border border-ds-border bg-ds-sunken px-[5px] text-[11px] font-medium text-ds-faint">
                {shortcutLabel}
              </kbd>
            </>
          )}
        </button>
        </SidebarTip>
      </div>

      {/* Navigation */}
      <div className="relative flex-1 min-h-0">
        {/* Scroll-fade/blur mask — signals more nav items above once scrolled down */}
        <div
          aria-hidden
          className={`pointer-events-none absolute top-0 left-0 right-0 h-6 z-10 transition-opacity duration-200 ${
            navScrolled ? "opacity-100" : "opacity-0"
          }`}
          style={{
            background: "linear-gradient(to bottom, var(--sidebar-bg) 0%, transparent 100%)",
            backdropFilter: "blur(4px)",
            WebkitBackdropFilter: "blur(4px)",
            maskImage: "linear-gradient(to bottom, black, transparent)",
            WebkitMaskImage: "linear-gradient(to bottom, black, transparent)",
          }}
        />
        <nav
          ref={navRef}
          onScroll={(e) => setNavScrolled(e.currentTarget.scrollTop > 4)}
          className="flex h-full flex-col gap-px overflow-y-auto overflow-x-hidden px-3 pb-3 pt-1 no-scrollbar [&>*]:shrink-0"
        >
        {navMode === "ops" ? (
          isEducation ? nav.renderEducationNav()
          : isItAgency ? nav.renderItAgencyNav()
          : isRealEstate ? nav.renderRealEstateNav()
          : nav.renderGenericNav()
        ) : (
          <>
            {ORCA_NAV.filter((item) => !item.adminOnly || requireOrcaAccess(role)).map((item) =>
              item.href === "/orca/review"
                ? nav.renderNavItem({ ...item, badgeSlot: <ReviewNavBadge /> })
                : nav.renderNavItem(item),
            )}
          </>
        )}
      </nav>
      </div>

      {/* Footer — Archive + Settings, pinned under the nav. The account button moved to the header (EDGEX-86 §5). */}
      {(showFooterArchive || showFooterSettings) && (
        <div className="flex shrink-0 flex-col gap-px border-t border-ds-border px-3 py-2">
          {showFooterArchive && (
            <Suspense fallback={<NavFallback icon={ArchiveIcon} label="Archive" />}>
              <ArchiveNavLinks lists={archiveLists} onNavigate={closeMobile} collapsed={rail} />
            </Suspense>
          )}
          {/* Settings — owner/admin only; route + bootstrap API also hard-gate to these roles */}
          {showFooterSettings && (
            <SidebarTip label="Settings" enabled={rail}>
              <button
                type="button"
                onClick={() => { closeMobile(); openSettings(); }}
                aria-label={rail ? "Settings" : undefined}
                className={cn(NAV_ROW, NAV_ROW_IDLE, rail && NAV_ROW_COLLAPSED)}
              >
                <NavIcon icon={GearIcon} />
                {!rail && <span className="flex-1 truncate text-left">Settings</span>}
              </button>
            </SidebarTip>
          )}
        </div>
      )}
    </div>
    </TooltipProvider>
  );
  };

  const headerIconButton =
    "inline-grid h-[30px] w-[30px] place-items-center rounded-ds-sm border border-ds-border bg-ds-surface text-ds-muted outline-none transition-colors hover:bg-ds-hover hover:text-ds-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ds-accent";

  return (
    <div
      className={`flex h-screen transition-all duration-500 ease-out ${
        aiAssistantEnabled && isAssistantOpen
          ? "bg-page-bg md:p-2 md:gap-2"
          : "bg-sidebar-bg"
      }`}
    >
      {/* App card — the whole CRM as one floating rounded object (framed only when AI is on) */}
      <div
        className={`flex flex-1 min-w-0 md:overflow-hidden bg-sidebar-bg transition-all duration-500 ease-out ${
          aiAssistantEnabled && isAssistantOpen
            ? "md:rounded-2xl md:shadow-[0_0_0_1px_#00001d13,0_6px_20px_rgba(0,0,0,0.06)]"
            : "md:rounded-none md:shadow-none"
        }`}
      >
        {/* Desktop sidebar - Zunkireelabs style */}
        <aside
          className={`hidden md:flex flex-shrink-0 flex-col h-full bg-sidebar-bg transition-[width] duration-200 ease-out print:hidden ${
            sidebarCollapsed ? "w-[68px]" : "w-60"
          }`}
        >
          {renderSidebar(false)}
        </aside>

        {/* Main content area with header */}
        <div className="flex flex-col flex-1 min-w-0 h-full bg-sidebar-bg">
          {/* Header strip — 44px on the canvas, outside the white frame (EDGEX-86 §5). Controls are 30px. */}
          <header className="flex h-11 w-full shrink-0 items-center justify-end gap-2 bg-sidebar-bg pl-3 pr-2 print:hidden">
            {/* Mobile menu button */}
            <div className="md:hidden">
              {mounted ? (
                <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                  <SheetTrigger asChild>
                    <button type="button" aria-label="Open menu" className={headerIconButton}>
                      <MenuIcon size={18} weight="regular" aria-hidden />
                    </button>
                  </SheetTrigger>
                  <SheetContent side="left" className="w-60 p-0">
                    {renderSidebar(true)}
                  </SheetContent>
                </Sheet>
              ) : (
                <button type="button" aria-label="Open menu" className={headerIconButton}>
                  <MenuIcon size={18} weight="regular" aria-hidden />
                </button>
              )}
            </div>

            {/* Spacer — keeps the right section right-aligned */}
            <div className="flex-1" />

            {/* AI Assistant Button — hidden entirely (not just its requests 404) when disabled */}
            {aiAssistantEnabled && (
              <Button
                look="v2"
                variant="secondary"
                onClick={toggleAssistant}
                aria-pressed={isAssistantOpen}
                className={cn("border-ds-ai-line max-sm:w-[30px] max-sm:px-0", isAssistantOpen && "bg-ds-hover")}
              >
                <SparkleIcon size={16} weight="regular" aria-hidden className="text-ds-ai" />
                <span className="max-sm:hidden">Ask Orca</span>
              </Button>
            )}

            {/* Running-timer chip — hidden entirely (not just its requests 404) when the
                tenant doesn't have time-tracking. See running-timer-chip.tsx. */}
            {timeTrackingEnabled && <RunningTimerChip />}

            {/* Branch Switcher — Enterprise only; admin gets dropdown, branch-scoped gets static badge.
                On phones it moves into the drawer. */}
            <BranchSwitcher
              className="max-md:hidden"
              branches={branches}
              maxBranches={maxBranches}
              userBranchId={userBranchId}
              leadScope={leadScope}
              selectedBranchId={selectedBranchId}
            />

            {/* Notifications Dropdown */}
            <NotificationsDropdown />

            {/* Your menu — avatar button with the usage ring */}
            <UserMenu
              userName={userName}
              email={user.email ?? ""}
              roleLabel={positionName ?? role}
              branchLabel={branchLabel}
              tenantName={tenant.name}
              plan={tenant.plan}
              isAdmin={isAdminUser}
              aiOn={aiAssistantEnabledProp}
              ai={usage.ai}
              aiPct={usage.aiPct}
              sms={usage.sms}
              smsPct={usage.smsPct}
              ring={usage.ring}
              shortcutLabel={shortcutLabel}
              onOpen={() => void usage.refresh()}
              onOpenSettings={() => openSettings()}
              onOpenSearch={openSearch}
              onLogout={handleLogout}
            />
          </header>

          {/* Content container - flex layout */}
          <div className="flex-1 min-w-0 overflow-hidden flex">
            {/* Main content - shrinks when AI panel opens */}
            <main
              className={`flex-1 min-h-0 overflow-y-scroll overflow-x-hidden [scrollbar-gutter:stable] bg-content-bg transition-all duration-500 ease-out print:overflow-visible print:h-auto print:p-0 print:m-0 print:border-0 print:rounded-none ${
                isLeadsFullBleed ? "mr-3 mb-3" : "p-4 mr-3 mb-3"
              }`}
              style={{ borderRadius: "var(--radius-lg)", border: "2px solid #00001d13" }}
            >
              {children}
            </main>
          </div>
        </div>
      </div>

      {/* AI Assistant Panel — now OUTSIDE the app card, in the right gutter on the page bg.
          Not mounted at all when disabled, so a disabled tenant has no path to open it
          (button hidden above; this is belt-and-braces). */}
      {aiAssistantEnabled && (
        <div className="print:hidden">
          <AIAssistantPanel userFirstName={userName.split(" ")[0]} />
        </div>
      )}
    </div>
  );
}
