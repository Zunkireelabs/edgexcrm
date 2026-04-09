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
  Bell,
  Sparkles,
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
    <div className="flex flex-col h-full bg-[#f7f7f7]">
      {/* Logo and Tenant Info - edge-flow style */}
      <div className="px-5 py-4 border-b border-gray-100 h-[60px] flex items-center gap-3">
        <div
          className="w-8 h-8 rounded-md flex items-center justify-center text-white font-semibold text-base"
          style={{ backgroundColor: tenant.primary_color || "#2272B4" }}
        >
          {tenant.name.charAt(0)}
        </div>
        <span className="text-lg font-semibold text-gray-900">{tenant.name}</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== "/dashboard" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-md transition-colors group ${
                isActive
                  ? "bg-blue-50 text-blue-600"
                  : "text-gray-600 hover:bg-blue-50 hover:text-gray-900"
              }`}
            >
              <span className="flex items-center gap-2.5">
                <item.icon className="w-[18px] h-[18px]" />
                <span className={`text-sm ${isActive ? "font-medium" : "font-normal"}`}>
                  {item.label}
                </span>
              </span>
            </Link>
          );
        })}

        {/* Public Forms Section */}
        {hasManyForms ? (
          <div>
            <button
              onClick={() => setFormsExpanded(!formsExpanded)}
              className="w-full flex items-center justify-between px-3 py-2 rounded-md transition-colors text-gray-600 hover:bg-blue-50 hover:text-gray-900"
            >
              <span className="flex items-center gap-2.5">
                <FileText className="w-[18px] h-[18px]" />
                <span className="text-sm font-normal">Public Forms</span>
              </span>
              <ChevronDown
                className={`w-4 h-4 text-gray-400 transition-transform ${formsExpanded ? "rotate-180" : ""}`}
              />
            </button>
            {formsExpanded && (
              <div className="ml-7 pl-3 border-l border-gray-200 space-y-0.5 mt-1">
                {formConfigs.map((form) => (
                  <a
                    key={form.slug}
                    href={`/form/${tenant.slug}/${form.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setMobileOpen(false)}
                    className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-blue-50 hover:text-gray-900 transition-colors"
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
            className="w-full flex items-center justify-between px-3 py-2 rounded-md transition-colors text-gray-600 hover:bg-blue-50 hover:text-gray-900"
          >
            <span className="flex items-center gap-2.5">
              <FileText className="w-[18px] h-[18px]" />
              <span className="text-sm font-normal">View Public Form</span>
            </span>
            <ExternalLink className="h-4 w-4 text-gray-400" />
          </a>
        )}
      </nav>

      {/* User Profile - edge-flow style */}
      <div className="border-t border-gray-100 p-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
            <UserIcon className="w-4 h-4 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">
              {user.email?.split("@")[0] || "User"}
            </p>
            <p className="text-xs text-gray-500 capitalize">{role}</p>
          </div>
          <button
            onClick={handleLogout}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-500 hover:text-gray-700"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-[#f7f7f7]">
      {/* Desktop sidebar - edge-flow style */}
      <aside className="hidden md:flex w-60 flex-col h-full bg-[#f7f7f7]">
        {sidebarContent}
      </aside>

      {/* Main content area with header */}
      <div className="flex flex-col flex-1 min-w-0 h-full bg-[#f7f7f7] md:pl-2">
        {/* Top Header Bar - edge-flow style */}
        <header className="bg-[#f7f7f7] px-6 py-3 relative h-[60px] flex items-center gap-4 w-full">
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

          {/* Search Bar - Centered, edge-flow style */}
          <div className="relative w-full max-w-[500px]">
            <div className="flex items-center bg-white rounded-xl px-4 py-2 border border-gray-300 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100 transition-all">
              <Search className="w-4 h-4 text-gray-500 mr-3" />
              <input
                type="text"
                placeholder="Search leads, team members, and more..."
                className="bg-transparent w-full text-sm outline-none text-gray-700 placeholder-gray-500"
              />
              <span className="text-xs text-gray-500 ml-2 whitespace-nowrap">CTRL + K</span>
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

            {/* Tenant Dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowAccountDropdown(!showAccountDropdown)}
                className="flex items-center gap-2 hover:bg-gray-100 text-gray-700 px-3 py-2 rounded-lg transition-colors"
              >
                <div
                  className="w-6 h-6 rounded flex items-center justify-center text-white font-semibold text-xs"
                  style={{ backgroundColor: tenant.primary_color || "#2272B4" }}
                >
                  {tenant.name.charAt(0)}
                </div>
                <span className="text-sm font-medium hidden sm:inline">{tenant.name}</span>
                <ChevronDown
                  className={`w-4 h-4 text-gray-500 transition-transform ${showAccountDropdown ? "rotate-180" : ""}`}
                />
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
        <div className="flex-1 min-w-0 overflow-hidden flex gap-3">
          {/* Main content - shrinks when AI panel opens */}
          <main className="min-w-0 overflow-hidden transition-all duration-500 ease-out flex-1">
            <div
              className={`bg-white h-full border border-gray-200 overflow-hidden flex flex-col transition-[border-radius] duration-500 ease-out ${
                isAssistantOpen ? "rounded-xl" : "rounded-l-xl"
              }`}
            >
              <div className="flex-1 min-h-0 p-6 pr-6 overflow-hidden">
                {children}
              </div>
            </div>
          </main>

          {/* AI Assistant Panel */}
          <AIAssistantPanel />
        </div>
      </div>
    </div>
  );
}
