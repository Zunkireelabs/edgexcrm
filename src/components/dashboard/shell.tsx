"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Tenant } from "@/types/database";
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
  LayoutDashboard,
  LayoutGrid,
  Users,
  Settings,
  LogOut,
  Menu,
  FileText,
  Kanban,
  UsersRound,
  UserCheck,
  Clock,
  ChevronDown,
  ExternalLink,
  User as UserIcon,
  Search,
  Sparkles,
  Stamp,
  type LucideIcon,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAIAssistant } from "@/contexts/ai-assistant-context";
import { AIAssistantPanel } from "./ai-assistant-panel";
import { NotificationsDropdown } from "./notifications-dropdown";
import type { SidebarEntry, SidebarGroup, SidebarItem } from "@/industries/_types";

// Universal nav items — every tenant sees these regardless of industry.
// Industry-scoped items (e.g. Check-In, Forms) come from the tenant's
// industry manifest via `industrySidebarItems` prop and are inserted
// between the "top" and "bottom" universal sections.
const UNIVERSAL_NAV_TOP = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/leads", label: "All Leads", icon: Users },
];

const UNIVERSAL_NAV_MIDDLE = [
  { href: "/pipeline", label: "Pipeline", icon: Kanban },
];

const UNIVERSAL_NAV_BOTTOM = [
  { href: "/team", label: "Team", icon: UsersRound },
  { href: "/settings", label: "Settings", icon: Settings },
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
  Stamp,
  Users,
  UsersRound,
  Settings,
  Building2,
};

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
  const [expanded, setExpanded] = useState(true);

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
        className={`w-full flex items-center justify-between gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
          hasActiveChild
            ? "bg-[#ebebeb] text-gray-900"
            : "text-gray-500 hover:bg-[#ebebeb] hover:text-gray-900"
        }`}
      >
        <div className="flex items-center gap-3">
          <ParentIcon className="w-[18px] h-[18px]" />
          {group.label}
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
                className={`w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
                  active
                    ? "bg-[#ebebeb] text-gray-900 font-medium"
                    : "text-gray-500 hover:bg-[#ebebeb] hover:text-gray-900"
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
  formConfigs?: FormSummary[];
  industrySidebarItems?: readonly SidebarEntry[];
  children: React.ReactNode;
}

export function DashboardShell({
  user,
  tenant,
  role,
  formConfigs = [],
  industrySidebarItems = [],
  children,
}: DashboardShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [navMode, setNavMode] = useState<"ops" | "orca">("ops");
  const [formsExpanded, setFormsExpanded] = useState(false);
  const [showAccountDropdown, setShowAccountDropdown] = useState(false);
  const { isOpen: isAssistantOpen, toggleAssistant } = useAIAssistant();

  // Fix hydration mismatch: wait until client-side before rendering Radix UI components
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  useEffect(() => {
    const stored = typeof window !== "undefined"
      ? window.localStorage.getItem("dashboard-nav-mode")
      : null;
    if (stored === "orca" || stored === "ops") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNavMode(stored);
    }
  }, []);

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  function handleNavModeChange(value: string) {
    if (value === "ops" || value === "orca") {
      setNavMode(value);
      if (typeof window !== "undefined") {
        window.localStorage.setItem("dashboard-nav-mode", value);
      }
    }
  }

  const industryBefore = industrySidebarItems.filter(
    (e) => (e.position ?? "before-pipeline") === "before-pipeline",
  );
  const industryAfter = industrySidebarItems.filter(
    (e) => e.position === "after-pipeline",
  );

  function renderNavItem(item: { href: string; label: string; icon: LucideIcon }) {
    const isActive =
      pathname === item.href ||
      (item.href !== "/dashboard" && pathname.startsWith(item.href));
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={() => setMobileOpen(false)}
        className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
          isActive
            ? "bg-[#ebebeb] text-gray-900"
            : "text-gray-500 hover:bg-[#ebebeb] hover:text-gray-900"
        }`}
      >
        <item.icon className="w-[18px] h-[18px]" />
        {item.label}
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
    return renderNavItem({
      href: entry.href,
      label: entry.label,
      icon: INDUSTRY_ICONS[entry.icon] ?? FileText,
    });
  }

  const hasManyForms = formConfigs.length > 1;

  const sidebarContent = (
    <div className="flex flex-col h-full bg-[#fafafa]">
      {/* EdgeX product brand wordmark */}
      <div className="px-5 py-3 h-[52px] flex items-center">
        <span className="text-lg font-semibold text-gray-900 tracking-tight">EdgeX</span>
      </div>

      {/* Mode switcher */}
      <div className="px-3 pb-2">
        <Tabs value={navMode} onValueChange={handleNavModeChange}>
          <TabsList className="grid w-full grid-cols-2 h-8 border border-[#00001d13]">
            <TabsTrigger value="ops" className="text-xs gap-1.5 data-[state=active]:bg-white">
              <LayoutGrid className="w-3.5 h-3.5" />
              Ops
            </TabsTrigger>
            <TabsTrigger value="orca" className="text-xs gap-1.5 data-[state=active]:bg-white">
              <Bot className="w-3.5 h-3.5" />
              Orca
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {navMode === "ops" ? (
          <>
            {UNIVERSAL_NAV_TOP.map(renderNavItem)}
            {industryBefore.map(renderIndustryEntry)}
            {UNIVERSAL_NAV_MIDDLE.map(renderNavItem)}
            {industryAfter.map(renderIndustryEntry)}
            {UNIVERSAL_NAV_BOTTOM.map(renderNavItem)}

            {/* Public Forms Section */}
            {hasManyForms ? (
              <div>
                <button
                  onClick={() => setFormsExpanded(!formsExpanded)}
                  className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors text-gray-500 hover:bg-[#ebebeb] hover:text-gray-900"
                >
                  <div className="flex items-center gap-3">
                    <FileText className="w-[18px] h-[18px]" />
                    Public Forms
                  </div>
                  <ChevronDown
                    className={`w-4 h-4 transition-transform ${formsExpanded ? "rotate-180" : ""}`}
                  />
                </button>
                {formsExpanded && (
                  <div className="relative mt-1 ml-[20px] pl-[18px] border-l border-gray-300">
                    {formConfigs.map((form) => (
                      <a
                        key={form.slug}
                        href={`/form/${tenant.slug}/${form.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => setMobileOpen(false)}
                        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-gray-500 hover:bg-[#ebebeb] hover:text-gray-900 transition-colors"
                      >
                        <span className="flex-1 truncate">{form.name}</span>
                        <ExternalLink className="h-3 w-3 shrink-0 opacity-50" />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <a
                href={`/form/${tenant.slug}${formConfigs[0] ? `/${formConfigs[0].slug}` : ""}`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors text-gray-500 hover:bg-[#ebebeb] hover:text-gray-900"
              >
                <div className="flex items-center gap-3">
                  <FileText className="w-[18px] h-[18px]" />
                  View Public Form
                </div>
                <ExternalLink className="h-4 w-4" />
              </a>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center text-center px-4 py-12 gap-2">
            <Bot className="w-6 h-6 text-muted-foreground/40" />
            <p className="text-xs font-medium text-gray-700">Orca coming soon</p>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              AI agents and orchestrations will live here.
            </p>
          </div>
        )}
      </nav>
    </div>
  );

  return (
    <div className="flex h-screen bg-[#fafafa]">
      {/* Desktop sidebar - Zunkireelabs style */}
      <aside className="hidden md:flex w-60 flex-shrink-0 flex-col h-full bg-[#fafafa]">
        {sidebarContent}
      </aside>

      {/* Main content area with header */}
      <div className="flex flex-col flex-1 min-w-0 h-full bg-[#fafafa]">
        {/* Top Header Bar - Zunkireelabs style */}
        <header className="bg-[#fafafa] px-6 py-3 h-[52px] flex items-center gap-4 w-full">
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

          {/* Spacer for centering */}
          <div className="flex-1"></div>

          {/* Search Bar - Centered, Zunkireelabs style */}
          <div className="w-full max-w-lg">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                type="text"
                placeholder="Search..."
                className="w-full h-10 pl-9 pr-12 rounded-xl border border-gray-300 bg-white text-sm placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
              <kbd className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                ⌘K
              </kbd>
            </div>
          </div>

          {/* Spacer for centering */}
          <div className="flex-1"></div>

          {/* Right Section - Assistant, Notifications & Tenant Dropdown */}
          <div className="flex items-center gap-3">
            {/* AI Assistant Button */}
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

            {/* Notifications Dropdown */}
            <NotificationsDropdown />

            {/* User/Tenant Dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowAccountDropdown(!showAccountDropdown)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-medium"
                  style={{ backgroundColor: tenant.primary_color || "#2272B4" }}
                >
                  {tenant.name.charAt(0)}
                </div>
                <span className="text-sm font-medium text-gray-900 hidden sm:inline">{tenant.name}</span>
                <ChevronDown className={`w-4 h-4 text-gray-500 hidden sm:inline transition-transform ${showAccountDropdown ? "rotate-180" : ""}`} />
              </button>

              {/* Account Dropdown */}
              {showAccountDropdown && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowAccountDropdown(false)} />
                  <div className="absolute right-0 top-full mt-2 w-64 bg-white rounded-xl shadow-lg border border-gray-200 py-2 z-50">
                    {/* User Info Section */}
                    <div className="px-4 py-3 border-b border-gray-100">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center">
                          <UserIcon className="w-5 h-5 text-white" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900 truncate">
                            {user.email?.split("@")[0] || "User"}
                          </p>
                          <p className="text-xs text-gray-500 truncate">{user.email}</p>
                          <span className="inline-block mt-1 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium capitalize">
                            {role}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Menu Items */}
                    <div className="py-1">
                      <Link
                        href="/settings"
                        onClick={() => setShowAccountDropdown(false)}
                        className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                      >
                        <Settings className="w-4 h-4 text-gray-500" />
                        <span>Settings</span>
                      </Link>
                    </div>

                    {/* Logout */}
                    <div className="border-t border-gray-100 pt-1">
                      <button
                        onClick={() => {
                          setShowAccountDropdown(false);
                          handleLogout();
                        }}
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
        </header>

        {/* Content container with AI Panel - flex layout */}
        <div className="flex-1 min-w-0 overflow-hidden flex">
          {/* Main content - shrinks when AI panel opens */}
          <main
            className="flex-1 min-h-0 overflow-auto p-4 mr-4 mb-4 bg-white transition-all duration-500 ease-out"
            style={{
              borderRadius: '8px',
              border: '1px solid #00001d13'
            }}
          >
            {children}
          </main>

          {/* AI Assistant Panel */}
          <AIAssistantPanel />
        </div>
      </div>
    </div>
  );
}
