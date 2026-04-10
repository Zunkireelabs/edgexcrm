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
  LayoutDashboard,
  Users,
  Settings,
  LogOut,
  Menu,
  FileText,
  Kanban,
  UsersRound,
  ChevronDown,
  ExternalLink,
  User as UserIcon,
  Search,
  Sparkles,
  Brain,
} from "lucide-react";
import { useAIAssistant } from "@/contexts/ai-assistant-context";
import { AIAssistantPanel } from "./ai-assistant-panel";
import { NotificationsDropdown } from "./notifications-dropdown";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/pipeline", label: "Pipeline", icon: Kanban },
  { href: "/leads", label: "All Leads", icon: Users },
  { href: "/team", label: "Team", icon: UsersRound },
  { href: "/settings", label: "Settings", icon: Settings },
];

interface FormSummary {
  name: string;
  slug: string;
}

interface DashboardShellProps {
  user: User;
  tenant: Tenant;
  role: string;
  formConfigs?: FormSummary[];
  children: React.ReactNode;
}

export function DashboardShell({
  user,
  tenant,
  role,
  formConfigs = [],
  children,
}: DashboardShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [formsExpanded, setFormsExpanded] = useState(false);
  const [showAccountDropdown, setShowAccountDropdown] = useState(false);
  const [orcaExpanded, setOrcaExpanded] = useState(true);

  // Orca sub-navigation items
  const orcaSubItems = [
    { href: "/orca", label: "Overview" },
    { href: "/orca/structure", label: "Org. Structure" },
    { href: "/orca/roles", label: "Roles" },
    { href: "/orca/tasks", label: "Tasks" },
    { href: "/orca/agents", label: "Agents" },
    { href: "/orca/compare", label: "Compare" },
  ];
  const { isOpen: isAssistantOpen, toggleAssistant } = useAIAssistant();

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

  const hasManyForms = formConfigs.length > 1;

  const sidebarContent = (
    <div className="flex flex-col h-full bg-[#ebebeb]">
      {/* Logo and Tenant Info - Zunkireelabs style */}
      <div className="px-5 py-3 h-[52px] flex items-center gap-3">
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-white font-semibold text-base"
          style={{ backgroundColor: tenant.primary_color || "#2272B4" }}
        >
          {tenant.name.charAt(0)}
        </div>
        <span className="text-lg font-semibold text-gray-900">{tenant.name}</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
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
                  ? "bg-[#fafafa] text-gray-900"
                  : "text-gray-500 hover:bg-[#fafafa] hover:text-gray-900"
              }`}
            >
              <item.icon className="w-[18px] h-[18px]" />
              {item.label}
            </Link>
          );
        })}

        {/* Orca AI Orchestration - Expandable */}
        <div className="mt-2">
          {/* Parent button */}
          <button
            onClick={() => setOrcaExpanded(!orcaExpanded)}
            className="cta-shimmer w-full flex items-center justify-between px-3 py-2 rounded-md bg-[#eb1600] hover:bg-[#cc1300] text-white transition-colors"
          >
            <div className="flex items-center gap-2">
              <Brain className="w-[18px] h-[18px]" />
              <span className="flex items-baseline gap-1.5">
                <span className="text-sm font-semibold">Orca</span>
                <span className="text-[11px] font-normal opacity-80">(AI Orchestration)</span>
              </span>
            </div>
            <ChevronDown
              className={`w-4 h-4 transition-transform ${orcaExpanded ? "rotate-180" : ""}`}
            />
          </button>

          {/* Sub-items with curved connector */}
          {orcaExpanded && (() => {
            const activeIndex = orcaSubItems.findIndex(
              (item) => pathname === item.href ||
                (item.href !== "/orca" && pathname.startsWith(item.href))
            );
            // If on /orca exactly, activeIndex should be 0
            const effectiveActiveIndex = pathname === "/orca" ? 0 : activeIndex;

            return (
              <div className="relative mt-1">
                {/* Vertical line - from parent to top of active row */}
                {effectiveActiveIndex >= 0 && (
                  <div
                    className="absolute bg-gray-300"
                    style={{
                      left: '20px',
                      top: '-4px',
                      width: '1.5px',
                      height: `calc(${effectiveActiveIndex} * 32px + 4px)`
                    }}
                  />
                )}

                {orcaSubItems.map((item, index) => {
                  const isChildActive = index === effectiveActiveIndex;

                  return (
                    <div key={item.href} className="relative flex items-center pl-3 h-[32px]">
                      {/* Curved corner connector - for active item */}
                      {isChildActive && (
                        <>
                          {/* Curved corner using borders */}
                          <div
                            className="absolute"
                            style={{
                              left: '19.25px',
                              top: 0,
                              height: 'calc(50% + 1px)',
                              width: '12px',
                              borderLeft: '1.5px solid #d1d5db',
                              borderBottom: '1.5px solid #d1d5db',
                              borderBottomLeftRadius: '6px'
                            }}
                          />
                          {/* Arrow */}
                          <div
                            className="absolute text-gray-300 text-xs"
                            style={{
                              left: '30px',
                              top: '50%',
                              transform: 'translateY(-50%)'
                            }}
                          >
                            →
                          </div>
                        </>
                      )}

                      {/* Spacer to align text */}
                      <div className="w-[38px] shrink-0" />

                      <Link
                        href={item.href}
                        onClick={() => setMobileOpen(false)}
                        className={`flex-1 px-2 py-1.5 rounded-md text-sm transition-colors ${
                          isChildActive
                            ? "text-gray-900 font-medium bg-[#fafafa]"
                            : "text-gray-500 hover:text-gray-900"
                        }`}
                      >
                        {item.label}
                      </Link>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>

        {/* Public Forms Section */}
        {hasManyForms ? (
          <div>
            <button
              onClick={() => setFormsExpanded(!formsExpanded)}
              className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors text-gray-500 hover:bg-[#fafafa] hover:text-gray-900"
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
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-gray-500 hover:bg-[#fafafa] hover:text-gray-900 transition-colors"
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
            className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors text-gray-500 hover:bg-[#fafafa] hover:text-gray-900"
          >
            <div className="flex items-center gap-3">
              <FileText className="w-[18px] h-[18px]" />
              View Public Form
            </div>
            <ExternalLink className="h-4 w-4" />
          </a>
        )}
      </nav>
    </div>
  );

  return (
    <div className="flex h-screen bg-[#f1f1f1]">
      {/* Desktop sidebar - Zunkireelabs style */}
      <aside className="hidden md:flex w-60 flex-shrink-0 flex-col h-full bg-[#ebebeb]">
        {sidebarContent}
      </aside>

      {/* Main content area with header */}
      <div className="flex flex-col flex-1 min-w-0 h-full bg-[#ebebeb]">
        {/* Top Header Bar - Zunkireelabs style */}
        <header className="bg-[#ebebeb] px-6 py-3 h-[52px] flex items-center gap-4 w-full">
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
            className="flex-1 min-h-0 overflow-auto p-4 bg-[#f1f1f1] transition-all duration-500 ease-out"
            style={{
              borderRadius: isAssistantOpen ? '16px' : '16px 0 0 16px',
              borderLeft: '1px solid #e5e7eb'
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
